import React, { useEffect, useState } from 'react';
import { AREAS, ROWS, iso } from '../data.js';
import { WEEK, areaVar, useCtx } from '../shared.jsx';

/* 개인 › 인맥 관리 전용 화면: 바로 전화하기 · 생일/기념일 · 명함
   people: [{ id, name, group, phone, company, title, birthday('YYYY-MM-DD'), annivName, annivDate, memo,
              card(명함 이미지 data URL), notes: [{ id, date, text }] }] */
export const GROUPS = ['가족', '친구', '동료', '지인'];
const uid = () => Math.random().toString(36).slice(2, 10);
const ACT_CARD = ROWS.find(r => r.a === 'P' && r.action === '명함 등록');
const ACT_NOTE = ROWS.find(r => r.a === 'P' && r.action.startsWith('만남 메모 기록'));
const telOf = p => (p || '').replace(/[^0-9+]/g, '');

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
    { id: 'p1', name: '어머니 (예시)', group: '가족', phone: '010-0000-0001', birthday: `1965-${md(5)}`, annivName: '', annivDate: '', memo: '주말 통화', company: '', title: '' },
    { id: 'p2', name: '김민수 (예시)', group: '친구', phone: '010-0000-0002', birthday: `1990-${md(2)}`, annivName: '', annivDate: '', memo: '대학 동기', company: '예시상사', title: '대리', hue: 150 },
    { id: 'p3', name: '이지은 (예시)', group: '친구', phone: '010-0000-0003', birthday: `1991-${md(40)}`, annivName: '', annivDate: '', memo: '독서 모임', company: '', title: '' },
    { id: 'p4', name: '박팀장 (예시)', group: '동료', phone: '010-0000-0004', birthday: `1982-${md(120)}`, annivName: '입사 동기 모임', annivDate: `2019-${md(18)}`, memo: '전 직장 상사', company: '예시테크', title: '팀장', hue: 210 },
    { id: 'p5', name: '최선배 (예시)', group: '지인', phone: '010-0000-0005', birthday: '', annivName: '', annivDate: '', memo: '업계 선배', company: '예시컨설팅', title: '이사', hue: 20 },
    { id: 'p6', name: '배우자 (예시)', group: '가족', phone: '010-0000-0006', birthday: `1992-${md(200)}`, annivName: '결혼기념일', annivDate: `2016-${md(9)}`, memo: '', company: '', title: '' },
  ];
  return list.map(({ hue, ...p }) => ({ ...p, card: hue ? sampleCard(p, hue) : '', notes: [] }));
}

/** 예전 형식(연락 주기)의 예시 데이터는 새 예시로 바꾸고, 직접 넣은 사람은 새 필드만 채운다 */
export function migratePeople(people, today) {
  if (!people) return people;
  const old = people.some(p => 'cycle' in p) && people.every(p => p.name.includes('(예시)'));
  if (old) return seedPeople(today);
  return people.map(({ cycle, last, ...p }) => ({ birthday: '', annivName: '', annivDate: '', company: '', title: '', card: '', memo: '', notes: [], ...p }));
}

/** 사진을 긴 변 1,000px 이하 JPEG 로 줄여 data URL 로 (브라우저 저장 공간 절약) */
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1000 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = reject;
      img.src = r.result;
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

export default function RelationView({ area, cat, group }) {
  const { store, setStore, now, isDone, finish } = useCtx();
  const today = iso(now);
  const people = store.people || seedPeople(now);
  const setPeople = fn => setStore(s => ({ ...s, people: fn(s.people || seedPeople(now)) }));
  const [grp, setGrp] = useState('ALL');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState(null);
  const blank = { name: '', group: '친구', phone: '', company: '', birthday: '', annivName: '', annivDate: '', card: '' };
  const [form, setForm] = useState(blank);

  // 다가오는 생일·기념일 (30일 이내)
  const events = people.flatMap(p => [
    p.birthday && { p, kind: '생일', ...nextDay(p.birthday, today) },
    p.annivDate && { p, kind: p.annivName || '기념일', ...nextDay(p.annivDate, today), years: nextDay(p.annivDate, today).date.getFullYear() - Number(p.annivDate.slice(0, 4)) },
  ].filter(Boolean)).sort((a, b) => a.dday - b.dday);
  const soon = events.filter(e => e.dday <= 30);
  const shown = people.filter(p => (grp === 'ALL' || p.group === grp) && (!q || `${p.name} ${p.company} ${p.phone} ${p.memo}`.includes(q)));

  const upd = (id, patch) => setPeople(ps => ps.map(p => (p.id === id ? { ...p, ...patch } : p)));
  const pickCard = async (file, done) => {
    if (!file) return;
    try { done(await shrinkImage(file)); } catch (e) { alert('이미지를 읽지 못했습니다. 다른 파일을 선택해 주세요.'); }
  };
  const add = e => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setPeople(ps => [...ps, { id: uid(), ...form, name: form.name.trim(), phone: form.phone.trim(), memo: '', title: '', notes: [] }]);
    setForm(blank);
  };
  const open = people.find(p => p.id === openId);
  const items = group.items.map(it => ({ it, rows: group.rows.filter(r => r.item === it) }));

  return (
    <div className="catv rv" style={{ '--ac': areaVar(area) }}>
      <header className="page-h">
        <h1 className="area-title">{cat}</h1>
        <p>{AREAS[area].n} · 바로 전화하고, 다가오는 생일·기념일을 챙깁니다. 명함을 누르면 크게 보고 상세 정보를 고칠 수 있습니다.</p>
      </header>

      <div className="hv-stats">
        <div className="hv-stat sl"><span className="muted">등록한 사람</span><b>{people.length}명</b><span className="hv-sub">{GROUPS.map(g => `${g} ${people.filter(p => p.group === g).length}`).join(' · ')}</span></div>
        <div className={`hv-stat ${soon.some(e => e.dday <= 7) ? 'over' : 'ex'}`}><span className="muted">30일 이내 생일·기념일</span><b>{soon.length}건</b>
          <span className="hv-sub">{soon[0] ? `${soon[0].p.name} ${soon[0].kind} ${dd(soon[0].dday)}` : '없음'}</span></div>
        <div className="hv-stat sl"><span className="muted">명함 등록</span><b>{people.filter(p => p.card).length}장</b><span className="hv-sub">명함을 누르면 크게 봅니다</span></div>
      </div>

      <section className="panel">
        <div className="csum-h"><h2>다가오는 생일·기념일</h2><span className="muted">30일 이내 · 가까운 순</span></div>
        {soon.length ? (
          <ul className="rv-ev">{soon.map((e, i) => (
            <li key={`${e.p.id}-${i}`} className={e.dday <= 3 ? 'hot' : ''}>
              <b className="rv-dd">{dd(e.dday)}</b>
              <span className="rv-dn"><b>{e.p.name}</b><small>{e.kind}{e.years > 0 ? ` ${e.years}주년` : ''} · {fmt(e.date)}</small></span>
              {e.p.phone && <a className="btn sm primary" href={`tel:${telOf(e.p.phone)}`}>전화하기</a>}
            </li>))}</ul>
        ) : <p className="muted">30일 이내 생일·기념일이 없습니다.</p>}
      </section>

      <section className="panel">
        <div className="csum-h"><h2>연락처</h2>
          <div className="chips" role="group" aria-label="관계">
            {[['ALL', '전체'], ...GROUPS.map(g => [g, g])].map(([k, n]) => <button key={k} aria-pressed={grp === k} onClick={() => setGrp(k)}>{n}</button>)}
          </div>
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="이름·회사·번호 검색" aria-label="연락처 검색" className="jv-q" /></div>
        <div className="rv-grid">{shown.map(p => {
          const b = nextDay(p.birthday, today), a = nextDay(p.annivDate, today);
          return (
            <article key={p.id} className="rv-card">
              <div className="rv-top">
                <span className="rv-av" aria-hidden="true">{p.name.slice(0, 1)}</span>
                <span className="rv-dn"><b>{p.name}</b><small>{p.group}{p.company ? ` · ${p.company}` : ''}{p.memo ? ` · ${p.memo}` : ''}</small></span>
              </div>
              <div className="rv-call">
                {p.phone ? <>
                  <a className="btn primary rv-tel" href={`tel:${telOf(p.phone)}`}>전화하기</a>
                  <a className="btn" href={`sms:${telOf(p.phone)}`}>문자</a>
                  <span className="rv-num">{p.phone}</span>
                </> : <span className="muted">전화번호 없음</span>}
              </div>
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

        <h3 className="lv-h3">사람 추가</h3>
        <form className="rv-add" onSubmit={add}>
          <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="이름" aria-label="새 사람 이름" />
          <select value={form.group} onChange={e => setForm({ ...form, group: e.target.value })} aria-label="관계">{GROUPS.map(g => <option key={g}>{g}</option>)}</select>
          <input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="전화번호" aria-label="전화번호" inputMode="tel" />
          <input value={form.company} onChange={e => setForm({ ...form, company: e.target.value })} placeholder="회사 (선택)" aria-label="회사" />
          <label className="rv-lbl">생일<input type="date" value={form.birthday} onChange={e => setForm({ ...form, birthday: e.target.value })} /></label>
          <input value={form.annivName} onChange={e => setForm({ ...form, annivName: e.target.value })} placeholder="기념일 이름 (선택)" aria-label="기념일 이름" />
          <label className="rv-lbl">기념일<input type="date" value={form.annivDate} onChange={e => setForm({ ...form, annivDate: e.target.value })} /></label>
          <label className="btn rv-file">{form.card ? '명함 선택됨' : '명함 사진'}<input type="file" accept="image/*" onChange={e => pickCard(e.target.files[0], card => setForm(f => ({ ...f, card })))} hidden /></label>
          <button className="btn primary" disabled={!form.name.trim()}>추가</button>
        </form>
        <p className="note">명함 사진은 저장 공간을 아끼려고 작게 줄여서 저장합니다.</p>
      </section>


      {open && <PersonDetail p={open} today={today} onClose={() => setOpenId(null)} upd={patch => upd(open.id, patch)}
        onDelete={() => { setPeople(ps => ps.filter(x => x.id !== open.id)); setOpenId(null); }}
        pickCard={file => pickCard(file, card => { upd(open.id, { card }); })}
        addNote={text => { upd(open.id, { notes: [{ id: uid(), date: today, text }, ...open.notes] }); }} />}
    </div>
  );
}

/* 상세 창: 명함 크게 + 정보 수정 + 메모 */
function PersonDetail({ p, today, onClose, upd, onDelete, pickCard, addNote }) {
  const [note, setNote] = useState('');
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
        {p.phone && <div className="rv-call big">
          <a className="btn primary rv-tel" href={`tel:${telOf(p.phone)}`}>전화하기 {p.phone}</a>
          <a className="btn" href={`sms:${telOf(p.phone)}`}>문자</a></div>}
        <div className="rv-fields">
          <label>전화번호<input value={p.phone} onChange={e => upd({ phone: e.target.value })} inputMode="tel" /></label>
          <label>관계<select value={p.group} onChange={e => upd({ group: e.target.value })}>{GROUPS.map(g => <option key={g}>{g}</option>)}</select></label>
          <label>회사<input value={p.company || ''} onChange={e => upd({ company: e.target.value })} /></label>
          <label>직함<input value={p.title || ''} onChange={e => upd({ title: e.target.value })} /></label>
          <label>생일<input type="date" value={p.birthday || ''} onChange={e => upd({ birthday: e.target.value })} /></label>
          <label>기념일 이름<input value={p.annivName || ''} onChange={e => upd({ annivName: e.target.value })} placeholder="예: 결혼기념일" /></label>
          <label>기념일 날짜<input type="date" value={p.annivDate || ''} onChange={e => upd({ annivDate: e.target.value })} /></label>
          <label>메모<input value={p.memo || ''} onChange={e => upd({ memo: e.target.value })} /></label>
        </div>
        <h3 className="lv-h3">만남·통화 메모</h3>
        <div className="row2">
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="예: 다음 달 점심 약속" aria-label="메모 입력"
            onKeyDown={e => { if (e.key === 'Enter' && note.trim()) { addNote(note.trim()); setNote(''); } }} />
          <button className="btn primary" disabled={!note.trim()} onClick={() => { addNote(note.trim()); setNote(''); }}>기록</button>
        </div>
        <ul className="rv-notes">{p.notes.map(n => <li key={n.id}><time>{n.date.slice(5).replace('-', '/')}</time>{n.text}</li>)}</ul>
        {!p.notes.length && <p className="muted">메모가 없습니다.</p>}
        <div className="rv-mf"><button className={`btn sm ${arm ? 'danger' : ''}`} onClick={() => (arm ? onDelete() : (setArm(true), setTimeout(() => setArm(false), 3000)))}>{arm ? '정말 삭제할까요?' : '이 사람 삭제'}</button></div>
      </div>
      {zoom && <div className="rv-zoom" onClick={e => { e.stopPropagation(); setZoom(false); }}><img src={p.card} alt={`${p.name} 명함 원본`} /></div>}
    </div>
  );
}
