import React, { useEffect, useState } from 'react';
import { iso } from '../data.js';
import { WEEK, areaVar, useCtx } from '../shared.jsx';
import CardScan, { GROUPS, shrinkImage } from './CardScan.jsx';
import ContactImport, { undoImport } from './ContactImport.jsx';
import { toTrash } from '../schema.js';

/* 개인 › 인맥 관리 전용 화면: 명함 촬영(AI 분석 · 온보딩) · 영역(개인·근로·사업, 여러 개 가능) · 생일/기념일 · 명함
   people: [{ id, name, group, phone, company, title, email, address, birthday('YYYY-MM-DD'), annivName, annivDate,
              card(명함 이미지 data URL),
              areas: ['P','W','B'] 중 여러 개 (없으면 관계가 업무이거나 엑셀로 가져온 사람은 근로, 나머지는 개인),
              엑셀로 가져온 사람은 dept(소속), phone2, tel(회사 전화), fax, email2, note(비고), check(번호 확인 필요), src(시트), importId 도 가짐 }]  (예전 memo · notes 는 쓰지 않음) */
export { GROUPS };
const uid = () => Math.random().toString(36).slice(2, 10);
export const AREA_KEYS = [['P', '개인'], ['W', '근로'], ['B', '사업']];
const AREA_NAME = Object.fromEntries(AREA_KEYS);
/** 사람의 영역 (저장된 값이 없으면 관계로 추정) */
export const areasOf = p => (Array.isArray(p.areas) ? p.areas : p.group === '업무' || p.importId ? ['W'] : ['P']);

/** 다음 생일·기념일 (올해 지났으면 내년) */
function nextDay(dateStr, today) {
  if (!dateStr) return null;
  const [, m, d] = dateStr.split('-').map(Number);
  const t = new Date(today + 'T00:00:00');
  let n = new Date(t.getFullYear(), m - 1, d);
  if (n < t) n = new Date(t.getFullYear() + 1, m - 1, d);
  return { date: n, dday: Math.round((n - t) / 864e5) };
}
const fmt = d => `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`;
const dd = n => (n === 0 ? '오늘' : `D-${n}`);

/** 예시용 명함 이미지 (SVG) */
export function sampleCard(p, hue = 210) {
  const esc = s => String(s || '').replace(/[<&>"]/g, c => ({ '<': '&lt;', '&': '&amp;', '>': '&gt;', '"': '&quot;' }[c]));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="520" viewBox="0 0 900 520">
<rect width="900" height="520" rx="18" fill="#ffffff"/><rect width="900" height="520" rx="18" fill="none" stroke="#d6dde3" stroke-width="3"/>
<rect x="0" y="0" width="22" height="520" rx="6" fill="hsl(${hue},55%,42%)"/>
<text x="70" y="110" font-family="sans-serif" font-size="34" fill="hsl(${hue},55%,35%)" font-weight="700">${esc(p.company || '예시 회사')}</text>
<text x="70" y="250" font-family="sans-serif" font-size="64" fill="#16202a" font-weight="700">${esc(p.name.replace(' (예시)', ''))}</text>
<text x="70" y="300" font-family="sans-serif" font-size="30" fill="#4b5966">${esc(p.title || '')}</text>
<line x1="70" y1="350" x2="830" y2="350" stroke="#e7ecf0" stroke-width="2"/>
<text x="70" y="410" font-family="sans-serif" font-size="30" fill="#16202a">M. ${esc(p.phone)}</text>
<text x="70" y="455" font-family="sans-serif" font-size="26" fill="#77848f">sample@example.com · 예시 명함</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function seedPeople(today = new Date()) {
  const y = today.getFullYear();
  const md = n => { const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + n); return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const list = [
    { id: 'p1', name: '어머니 (예시)', group: '가족', phone: '010-0000-0001', birthday: `1965-${md(5)}`, annivName: '', annivDate: '', company: '', title: '' },
    { id: 'p2', name: '김민수 (예시)', group: '친구', phone: '010-0000-0002', birthday: `1990-${md(2)}`, annivName: '', annivDate: '', company: '예시상사', title: '대리', hue: 150 },
    { id: 'p3', name: '이지은 (예시)', group: '친구', phone: '010-0000-0003', birthday: `1991-${md(40)}`, annivName: '', annivDate: '', company: '', title: '' },
    { id: 'p4', name: '박팀장 (예시)', group: '동료', phone: '010-0000-0004', birthday: `1982-${md(120)}`, annivName: '입사 동기 모임', annivDate: `2019-${md(18)}`, company: '예시테크', title: '팀장', hue: 210 },
    { id: 'p5', name: '최선배 (예시)', group: '지인', phone: '010-0000-0005', birthday: '', annivName: '', annivDate: '', company: '예시컨설팅', title: '이사', hue: 20 },
    { id: 'p6', name: '배우자 (예시)', group: '가족', phone: '010-0000-0006', birthday: `1992-${md(200)}`, annivName: '결혼기념일', annivDate: `2016-${md(9)}`, company: '', title: '' },
  ];
  return list.map(({ hue, ...p }) => ({ ...p, card: hue ? sampleCard(p, hue) : '' }));
}

/** 예전 형식(연락 주기)의 예시 데이터는 새 예시로 바꾸고, 직접 넣은 사람은 새 필드만 채운다 */
export function migratePeople(people, today) {
  if (!people) return people;
  const old = people.some(p => 'cycle' in p) && people.every(p => p.name.includes('(예시)'));
  if (old) return seedPeople(today);
  return people.map(({ cycle, last, ...p }) => ({ birthday: '', annivName: '', annivDate: '', company: '', title: '', email: '', address: '', card: '', ...p }));
}

/** fixedArea: 근로 › 업무 연락처처럼 한 영역의 사람만 먼저 보여 줄 때 (같은 인맥 데이터를 쓴다) */
export default function RelationView({ area, cat, fixedArea }) {
  const { store, setStore, now } = useCtx();
  const today = iso(now);
  const people = store.people || seedPeople(now);
  const setPeople = fn => setStore(s => ({ ...s, people: fn(s.people || seedPeople(now)) }));
  const [grp, setGrp] = useState('ALL');
  const [ar, setAr] = useState(fixedArea || 'ALL');                      // 영역 거르기: ALL · P · W · B · NONE
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState(null);
  const [focus, setFocus] = useState(null);                              // 요약 카드를 누르면 펼치는 상세: people · soon · check · card
  const blank = { name: '', group: fixedArea === 'W' ? '업무' : '친구', phone: '', company: '', birthday: '', annivName: '', annivDate: '', card: '', areas: [fixedArea || 'P'] };
  const [form, setForm] = useState(blank);

  // 다가오는 생일·기념일 (30일 이내)
  const events = people.flatMap(p => [
    p.birthday && { p, kind: '생일', ...nextDay(p.birthday, today) },
    p.annivDate && { p, kind: p.annivName || '기념일', ...nextDay(p.annivDate, today), years: nextDay(p.annivDate, today).date.getFullYear() - Number(p.annivDate.slice(0, 4)) },
  ].filter(Boolean)).sort((a, b) => a.dday - b.dday);
  const soon = events.filter(e => e.dday <= 30);
  const [co, setCo] = useState('');
  const [limit, setLimit] = useState(24);
  const [showImport, setShowImport] = useState(false);
  const companies = Object.entries(people.reduce((m, p) => { if (p.company) m[p.company] = (m[p.company] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'));
  const ql = q.trim().toLowerCase();
  const inArea = p => { const a = areasOf(p); return ar === 'ALL' || (ar === 'NONE' ? !a.length : a.includes(ar)); };
  const matched = people.filter(p => (grp === 'ALL' || p.group === grp) && inArea(p) && (!co || p.company === co)
    && (!ql || [p.name, p.company, p.dept, p.title, p.phone, p.phone2, p.tel, p.email, p.email2, p.note].join(' ').toLowerCase().includes(ql)));
  const shown = matched.slice(0, limit);
  useEffect(() => { setLimit(24); }, [grp, ar, co, q]);
  const noArea = people.filter(p => !areasOf(p).length).length;
  const checks = people.filter(p => p.check), cards = people.filter(p => p.card);
  // 상세에서 항목을 누르면 아래 연락처 목록을 그 조건으로 거르고 목록으로 내려간다
  const showList = f => {
    setGrp(f.grp || 'ALL'); setAr(fixedArea || f.ar || 'ALL'); setCo(f.co || ''); setQ('');
    setTimeout(() => document.getElementById('rv-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  // 지금 보이는(거른) 사람 전체의 영역을 한 번에 넣거나 빼기
  const [bulk, setBulk] = useState(false);
  const bulkSet = (k, on) => {
    const ids = new Set(matched.map(p => p.id));
    setPeople(ps => ps.map(p => { if (!ids.has(p.id)) return p; const a = areasOf(p).filter(x => x !== k); return { ...p, areas: on ? AREA_KEYS.map(([x]) => x).filter(x => a.includes(x) || x === k) : a }; }));
  };
  const last = store.peopleImport;

  const upd = (id, patch) => setPeople(ps => ps.map(p => (p.id === id ? { ...p, ...patch } : p)));
  const pickCard = async (file, done) => {
    if (!file) return;
    try { done(await shrinkImage(file)); } catch (e) { alert('이미지를 읽지 못했습니다. 다른 파일을 선택해 주세요.'); }
  };
  const add = e => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setPeople(ps => [...ps, { id: uid(), ...form, name: form.name.trim(), phone: form.phone.trim(), title: '', email: '' }]);
    setForm(blank);
  };
  const open = people.find(p => p.id === openId);
  // 명함 촬영 온보딩 결과 저장: 연락처 + (선택) 기념일 관리
  const saveScanned = (person, annivs) => setStore(s => ({ ...s, people: [...(s.people || seedPeople(now)), person], anniv: annivs.length ? [...(s.anniv || []), ...annivs] : s.anniv }));

  return (
    <div className="catv rv" style={{ '--ac': areaVar(area) }}>
      <header className="page-h">
        <h1 className="area-title">{cat}</h1>
      </header>

      <CardScan onSave={saveScanned} />

      <div className="hv-stats rv-stats">
        {[
          ['people', 'sl', '등록한 사람', `${people.length}명`, GROUPS.map(g => `${g} ${people.filter(p => p.group === g).length}`).join(' · ')],
          ['soon', soon.some(e => e.dday <= 7) ? 'over' : 'ex', '30일 이내 생일·기념일', `${soon.length}건`, soon[0] ? `${soon[0].p.name} ${soon[0].kind} ${dd(soon[0].dday)}` : '없음'],
          ...(checks.length ? [['check', 'over', '번호 확인 필요', `${checks.length}명`, '엑셀에서 번호가 깨진 사람']] : []),
          ['card', 'sl', '명함 등록', `${cards.length}장`, '명함을 모아 봅니다'],
        ].map(([k, tone, label, value, sub]) => (
          <button key={k} type="button" className={`hv-stat ${tone} rv-stat ${focus === k ? 'on' : ''}`} aria-expanded={focus === k} onClick={() => setFocus(f => (f === k ? null : k))}>
            <span className="muted">{label}</span><b>{value}</b><span className="hv-sub">{sub}</span><span className="rv-stat-go" aria-hidden="true">{focus === k ? '접기 ▲' : '자세히 ▼'}</span></button>))}
      </div>

      {focus && <section className="panel rv-focus" aria-label="요약 상세">
        <div className="csum-h"><h2>{{ people: '등록한 사람', soon: '다가오는 생일 · 기념일', check: '번호 확인 필요', card: '명함 모아 보기' }[focus]}</h2>
          <button className="btn sm grow-r" onClick={() => setFocus(null)}>닫기</button></div>

        {focus === 'people' && <div className="rv-fgrid">
          <div><h3>관계별</h3><ul className="rv-flist">{[['ALL', '전체', people.length], ...GROUPS.map(g => [g, g, people.filter(p => p.group === g).length])].map(([k, n, c]) => (
            <li key={k}><button className={grp === k && !co && ar === (fixedArea || 'ALL') ? 'on' : ''} onClick={() => showList({ grp: k })}><span>{n}</span><b>{c}명</b>
              <i className="rv-fbar"><i style={{ width: `${people.length ? c / people.length * 100 : 0}%` }} /></i></button></li>))}</ul></div>
          <div><h3>영역별</h3><ul className="rv-flist">{[...AREA_KEYS, ...(noArea ? [['NONE', '미지정']] : [])].map(([k, n]) => { const c = k === 'NONE' ? noArea : people.filter(p => areasOf(p).includes(k)).length; return (
            <li key={k}><button onClick={() => showList({ ar: k })}><span>{n}</span><b>{c}명</b><i className="rv-fbar"><i style={{ width: `${people.length ? c / people.length * 100 : 0}%` }} /></i></button></li>); })}</ul></div>
          <div><h3>회사별 <small className="muted">많은 순 10곳</small></h3>{companies.length ? <ul className="rv-flist">{companies.slice(0, 10).map(([c, n]) => (
            <li key={c}><button onClick={() => showList({ co: c })}><span>{c}</span><b>{n}명</b><i className="rv-fbar"><i style={{ width: `${n / companies[0][1] * 100}%` }} /></i></button></li>))}</ul> : <p className="muted">회사가 적힌 사람이 없습니다.</p>}</div>
          <p className="note rv-fnote">항목을 누르면 아래 연락처 목록이 그 사람들로 걸러집니다.</p>
        </div>}

        {focus === 'soon' && (events.length ? <>
          <ul className="rv-elist">{events.filter(e => e.dday <= 60).map((e, i) => (
            <li key={i} className={e.dday <= 7 ? 'hot' : e.dday > 30 ? 'later' : ''}><em>{dd(e.dday)}</em><span className="grow"><b>{e.p.name}</b> {e.kind}{e.years > 0 ? ` (${e.years}주년)` : ''}<small className="muted"> · {fmt(e.date)}{e.p.company ? ` · ${e.p.company}` : ''}</small></span>
              <button className="btn sm" onClick={() => setOpenId(e.p.id)}>상세</button></li>))}</ul>
          {!events.some(e => e.dday <= 60) && <p className="muted">60일 이내에는 없습니다. 가장 가까운 날: {events[0].p.name} {events[0].kind} {fmt(events[0].date)} ({dd(events[0].dday)})</p>}
          <p className="note">30일 이내는 진하게, 31~60일은 흐리게 보입니다. 생일 · 기념일은 사람 상세에서 넣습니다.</p></>
          : <p className="muted">생일이나 기념일이 등록된 사람이 없습니다. 사람 카드를 눌러 상세에서 생일 · 기념일을 넣으세요.</p>)}

        {focus === 'check' && <>
          <p className="note">엑셀에서 가져올 때 번호가 깨졌거나 형식이 이상한 사람입니다. 번호를 고친 뒤 "확인 완료"를 누르세요.</p>
          <div className="tablewrap"><table className="prog fv-table rv-ctable"><thead><tr><th>이름</th><th>회사</th><th>휴대폰</th><th>원래 값 (비고)</th><th /></tr></thead>
            <tbody>{checks.map(p => (
              <tr key={p.id}><td><b>{p.name}</b></td><td>{p.company || '-'}</td>
                <td><input value={p.phone || ''} onChange={e => upd(p.id, { phone: e.target.value })} inputMode="tel" aria-label={`${p.name} 휴대폰`} /></td>
                <td><small className="muted">{p.note || '-'}</small></td>
                <td className="nw"><button className="btn sm" onClick={() => upd(p.id, { check: false })}>확인 완료</button> <button className="btn sm" onClick={() => setOpenId(p.id)}>상세</button></td></tr>))}</tbody></table></div></>}

        {focus === 'card' && (cards.length ? <div className="rv-cards">{cards.map(p => (
          <button key={p.id} type="button" className="rv-cardimg" onClick={() => setOpenId(p.id)} aria-label={`${p.name} 명함 크게 보기`}>
            <img src={p.card} alt={`${p.name} 명함`} /><span><b>{p.name}</b>{p.company && <small> · {p.company}</small>}</span></button>))}</div>
          : <p className="muted">등록된 명함이 없습니다. 위의 "명함 촬영"으로 찍거나, 사람 상세에서 명함 사진을 넣으세요.</p>)}
      </section>}

      <section className="panel" id="rv-list">
        <div className="csum-h"><h2>연락처</h2>
          <div className="chips" role="group" aria-label="관계">
            {[['ALL', '전체'], ...GROUPS.map(g => [g, g])].map(([k, n]) => <button key={k} aria-pressed={grp === k} onClick={() => setGrp(k)}>{n}</button>)}
          </div>
          <div className="chips rv-areas" role="group" aria-label="영역">
            {[['ALL', '영역 전체'], ...AREA_KEYS, ...(noArea ? [['NONE', '미지정']] : [])].map(([k, n]) => (
              <button key={k} aria-pressed={ar === k} onClick={() => setAr(k)}>{n}{k !== 'ALL' && <small> {k === 'NONE' ? noArea : people.filter(p => areasOf(p).includes(k)).length}</small>}</button>))}
          </div>
          {companies.length > 1 && <select value={co} onChange={e => setCo(e.target.value)} aria-label="회사" className="rv-co">
            <option value="">회사 전체</option>{companies.map(([c, n]) => <option key={c} value={c}>{c} ({n})</option>)}</select>}
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="이름·회사·소속·번호·이메일 검색" aria-label="연락처 검색" className="jv-q" />
          <button className="btn sm" onClick={() => setShowImport(v => !v)} aria-expanded={showImport}>엑셀 가져오기</button></div>
        {last && <p className="ci-last">마지막 가져오기: {last.file} · {last.at} · {last.added.length}명 추가{last.patched?.length ? ` · ${last.patched.length}명 보완` : ''}
          <button className="btn sm" onClick={() => setStore(undoImport)}>되돌리기</button></p>}
        {showImport && <ContactImport people={people} setStore={setStore} now={now} onClose={() => setShowImport(false)} />}
        <div className="rv-countbar"><span className="muted rv-count">{matched.length}명{matched.length > shown.length ? ` 중 ${shown.length}명 표시` : ''}</span>
          {matched.length > 0 && <button className="btn sm" onClick={() => setBulk(v => !v)} aria-expanded={bulk}>영역 한꺼번에 설정</button>}</div>
        {bulk && matched.length > 0 && <div className="rv-bulk"><span>지금 보이는 <b>{matched.length}명</b>을</span>
          {AREA_KEYS.map(([k, n]) => <span key={k} className="rv-bulk-a"><b>{n}</b><button className="btn sm" onClick={() => bulkSet(k, true)}>넣기</button><button className="btn sm" onClick={() => bulkSet(k, false)}>빼기</button></span>)}
          <span className="muted">여러 영역에 함께 넣을 수 있습니다</span></div>}
        <div className="rv-grid">{shown.map(p => {
          const b = nextDay(p.birthday, today), a = nextDay(p.annivDate, today);
          return (
            <article key={p.id} className="rv-card">
              <div className="rv-top">
                <span className="rv-av" aria-hidden="true">{p.name.slice(0, 1)}</span>
                <span className="rv-dn"><b>{p.name}{p.check && <span className="ci-flag" title={p.note}>확인</span>}</b><small>{p.group}{p.company ? ` · ${p.company}` : ''}{p.title ? ` ${p.title}` : ''}</small>
                  {p.dept && <small className="rv-dept">{p.dept}</small>}</span>
              </div>
              <div className="rv-tags">{areasOf(p).length ? areasOf(p).map(k => <span key={k} className={`rv-area a-${k}`}>{AREA_NAME[k]}</span>) : <span className="rv-area none">영역 미지정</span>}</div>
              <div className="rv-call">{p.phone ? <span className="rv-num">휴대폰 {p.phone}</span> : <span className="muted">전화번호 없음</span>}</div>
              <ul className="rv-days">
                <li><span>생일</span>{b ? <><b>{fmt(b.date)}</b><em className={b.dday <= 7 ? 'soon' : ''}>{dd(b.dday)}</em></> : <i className="muted">미등록</i>}</li>
                {p.annivDate && <li><span>{p.annivName || '기념일'}</span><b>{fmt(a.date)}</b><em className={a.dday <= 7 ? 'soon' : ''}>{dd(a.dday)}</em></li>}
              </ul>
              <button className={`rv-thumb ${p.card ? '' : 'empty'}`} onClick={() => setOpenId(p.id)} aria-label={`${p.name} 명함·상세 보기`}>
                {p.card ? <img src={p.card} alt={`${p.name} 명함`} /> : <span>명함 없음 · 눌러서 상세 보기</span>}
              </button>
            </article>
          );
        })}</div>
        {!shown.length && <p className="muted">해당하는 사람이 없습니다.</p>}
        {matched.length > shown.length && <div className="rv-more"><button className="btn" onClick={() => setLimit(l => l + 48)}>더 보기 ({matched.length - shown.length}명 남음)</button>
          <button className="btn" onClick={() => setLimit(matched.length)}>전체 보기</button></div>}

        <h3 className="lv-h3">사람 추가</h3>
        <form className="rv-add" onSubmit={add}>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="이름" aria-label="새 사람 이름" />
          <select value={form.group} onChange={e => setForm({ ...form, group: e.target.value })} aria-label="관계">{GROUPS.map(g => <option key={g}>{g}</option>)}</select>
          <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="전화번호" aria-label="전화번호" inputMode="tel" />
          <input value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} placeholder="회사 (선택)" aria-label="회사" />
          <label className="rv-lbl">생일<input type="date" value={form.birthday} onChange={e => setForm({ ...form, birthday: e.target.value })} /></label>
          <input value={form.annivName} onChange={e => setForm({ ...form, annivName: e.target.value })} placeholder="기념일 이름 (선택)" aria-label="기념일 이름" />
          <span className="rv-achk" role="group" aria-label="영역">{AREA_KEYS.map(([k, n]) => <label key={k}><input type="checkbox" checked={form.areas.includes(k)}
            onChange={e => setForm({ ...form, areas: AREA_KEYS.map(([x]) => x).filter(x => (x === k ? e.target.checked : form.areas.includes(x))) })} />{n}</label>)}</span>
          <label className="rv-lbl">기념일<input type="date" value={form.annivDate} onChange={e => setForm({ ...form, annivDate: e.target.value })} /></label>
          <label className="btn rv-file">{form.card ? '명함 선택됨' : '명함 사진'}<input type="file" accept="image/*" onChange={e => pickCard(e.target.files[0], card => setForm(f => ({ ...f, card })))} hidden /></label>
          <button className="btn primary" disabled={!form.name.trim()}>추가</button>
        </form>
        <p className="note">명함 사진은 저장 공간을 아끼려고 작게 줄여서 저장합니다.</p>
      </section>


      {open && <PersonDetail p={open} onClose={() => setOpenId(null)} upd={patch => upd(open.id, patch)}
        onDelete={() => { setStore(s => toTrash({ ...s, people: s.people || seedPeople(now) }, 'person', open.id)); setOpenId(null); }}
        pickCard={file => pickCard(file, card => { upd(open.id, { card }); })} />}
    </div>
  );
}

/* 상세 창: 명함 크게 + 정보 수정 */
function PersonDetail({ p, onClose, upd, onDelete, pickCard }) {
  const [zoom, setZoom] = useState(false);
  const [arm, setArm] = useState(false);
  useEffect(() => {
    const esc = e => { if (e.key === 'Escape') (zoom ? setZoom(false) : onClose()); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [zoom]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal rv-modal" role="dialog" aria-label={`${p.name} 상세`} onClick={e => e.stopPropagation()}>
        <div className="rv-mh"><h2>{p.name}</h2><span className="muted">{p.group}</span><button className="btn sm" onClick={onClose}>닫기</button></div>
        {p.card ? (
          <button className="rv-big" onClick={() => setZoom(true)} aria-label="명함 원본 크기로 보기"><img src={p.card} alt={`${p.name} 명함`} /></button>
        ) : <div className="rv-big empty">등록된 명함이 없습니다</div>}
        <div className="rv-cardbtns">
          <label className="btn sm">{p.card ? '명함 바꾸기' : '명함 사진 올리기'}<input type="file" accept="image/*" hidden onChange={e => pickCard(e.target.files[0])} /></label>
          {p.card && <button className="btn sm" onClick={() => upd({ card: '' })}>명함 삭제</button>}
        </div>
        <div className="rv-achk big" role="group" aria-label="영역"><b>영역</b>{AREA_KEYS.map(([k, n]) => <label key={k}><input type="checkbox" checked={areasOf(p).includes(k)}
          onChange={e => upd({ areas: AREA_KEYS.map(([x]) => x).filter(x => (x === k ? e.target.checked : areasOf(p).includes(x))) })} />{n}</label>)}
          <span className="muted">여러 개 고를 수 있습니다</span></div>
        <div className="rv-fields">
          <label>전화번호<input value={p.phone} onChange={e => upd({ phone: e.target.value })} inputMode="tel" /></label>
          <label>관계<select value={p.group} onChange={e => upd({ group: e.target.value })}>{GROUPS.map(g => <option key={g}>{g}</option>)}</select></label>
          <label>회사<input value={p.company || ''} onChange={e => upd({ company: e.target.value })} /></label>
          <label>직함<input value={p.title || ''} onChange={e => upd({ title: e.target.value })} /></label>
          <label>생일<input type="date" value={p.birthday || ''} onChange={e => upd({ birthday: e.target.value })} /></label>
          <label>기념일 이름<input value={p.annivName || ''} onChange={e => upd({ annivName: e.target.value })} placeholder="예: 결혼기념일" /></label>
          <label>기념일 날짜<input type="date" value={p.annivDate || ''} onChange={e => upd({ annivDate: e.target.value })} /></label>
          <label>소속<input value={p.dept || ''} onChange={e => upd({ dept: e.target.value })} /></label>
          <label>휴대폰 2<input value={p.phone2 || ''} onChange={e => upd({ phone2: e.target.value })} inputMode="tel" /></label>
          <label>회사 전화<input value={p.tel || ''} onChange={e => upd({ tel: e.target.value })} inputMode="tel" /></label>
          <label>팩스<input value={p.fax || ''} onChange={e => upd({ fax: e.target.value })} inputMode="tel" /></label>
          <label>이메일<input value={p.email || ''} onChange={e => upd({ email: e.target.value })} inputMode="email" /></label>
          <label>이메일 2<input value={p.email2 || ''} onChange={e => upd({ email2: e.target.value })} inputMode="email" /></label>
          <label>주소<input value={p.address || ''} onChange={e => upd({ address: e.target.value })} /></label>
          <label className="rv-wide">메모<textarea rows={2} value={p.note || ''} onChange={e => upd({ note: e.target.value })} /></label>
          {p.check && <label className="rv-wide rv-chk"><input type="checkbox" checked onChange={() => upd({ check: false })} />번호 확인 필요 (확인했으면 체크 해제)</label>}
        </div>
        {p.src && <p className="note">엑셀에서 가져옴 · {p.src}</p>}
        <div className="rv-mf"><button className={`btn sm ${arm ? 'danger' : ''}`} onClick={() => (arm ? onDelete() : (setArm(true), setTimeout(() => setArm(false), 3000)))}>{arm ? '정말 삭제할까요?' : '이 사람 삭제'}</button></div>
      </div>
      {zoom && <div className="rv-zoom" onClick={e => { e.stopPropagation(); setZoom(false); }}><img src={p.card} alt={`${p.name} 명함 원본`} /></div>}
    </div>
  );
}
