import React, { useRef, useState } from 'react';
import { iso } from '../data.js';
import { ANNIV_HEAD, ANNIV_KINDS, annivDateText, lunarTag, mergeAnniv, nextAnniv, parseAnnivRows, replaceAnniv } from '../anniv.js';
import { Popup, WEEK, areaVar, useCtx } from '../shared.jsx';
import { download, excelDate, readXlsx, writeXlsx } from '../xlsx.js';
import { parseCsv } from './samsungHealth.js';
import DdayPanel from './DdayPanel.jsx';
import { toTrash } from '../schema.js';

/* 개인 › 기념일 관리 전용 화면: 다가오는 기념일, D-day 관리(DdayPanel), 월별 달력형 목록, 기념일 편집 */
const uid = () => Math.random().toString(36).slice(2, 10);
/* 기념일 목록 정렬: store.annivSort = { key, dir } */
const A_SORTS = [['next', '다가오는 순'], ['name', '이름'], ['person', '관련 인물'], ['date', '날짜 (월 · 일)'], ['kind', '종류'], ['added', '등록순']];
function sortAnniv(list, sort, now) {
  const { key = 'next', dir = 'asc' } = sort || {};
  const ko = (a, b) => String(a || '').localeCompare(String(b || ''), 'ko', { numeric: true });
  const idx = new Map(list.map((a, i) => [a.id, i]));
  const nd = a => nextAnniv(a, now)?.dday;
  const has = key === 'next' ? a => nd(a) != null : key === 'person' ? a => !!a.person : () => true;   // 값 없는 것(지난 날 · 인물 없음)은 늘 뒤로
  const cmp = {
    next: (a, b) => nd(a) - nd(b) || ko(a.name, b.name),
    name: (a, b) => ko(a.name, b.name),
    person: (a, b) => ko(a.person, b.person) || ko(a.name, b.name),
    date: (a, b) => a.date.slice(5).localeCompare(b.date.slice(5)) || ko(a.name, b.name),
    kind: (a, b) => ko(a.kind, b.kind) || ko(a.name, b.name),
    added: (a, b) => idx.get(a.id) - idx.get(b.id),
  }[key] || ((a, b) => nd(a) - nd(b));
  const yes = list.filter(has).sort(cmp), no = list.filter(a => !has(a)).sort((a, b) => ko(a.name, b.name));
  return [...(dir === 'desc' ? yes.reverse() : yes), ...no];
}
const fmtMD = d => `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`;

export default function AnnivView({ area, cat, group }) {
  const { store, now, isDone } = useCtx();
  const all = store.anniv.map(a => ({ a, n: nextAnniv(a, now) })).filter(x => x.n).sort((x, y) => x.n.dday - y.n.dday);
  const soon = all.filter(x => x.n.dday <= store.annivDays);
  // 앞으로 12개월을 월별로 묶는다
  const months = Array.from({ length: 12 }, (_, i) => new Date(now.getFullYear(), now.getMonth() + i, 1));
  const byMonth = months.map(m => ({ m, list: all.filter(x => x.n.date.getFullYear() === m.getFullYear() && x.n.date.getMonth() === m.getMonth()) }));
  const items = group.items.map(it => ({ it, rows: group.rows.filter(r => r.item === it) }));
  const [openId, setOpenId] = useState(null);             // 기념일을 누르면 상세 팝업
  const opened = store.anniv.find(a => a.id === openId);

  return (
    <div className="catv" style={{ '--ac': areaVar(area) }}>
      <header className="page-h">
        <h1 className="area-title">{cat}</h1>
      </header>

      <section className="panel anniv">
        <div className="csum-h"><h2>다가오는 기념일</h2><span className="muted">D-{store.annivDays}일 이내 · {soon.length}건</span></div>
        {soon.length ? (
          <div className="anniv-list">{soon.map(({ a, n }) => (
            <button type="button" key={a.id} className={`anniv-card an-click ${n.dday === 0 ? 'hot' : n.dday <= 3 ? 'soon' : ''}`} onClick={() => setOpenId(a.id)} aria-haspopup="dialog">
              <b className="anniv-d">{n.dday === 0 ? '오늘' : `D-${n.dday}`}</b>
              <span className="anniv-n">{a.name}</span>
              <span className="anniv-m">{a.kind} · {fmtMD(n.date)}{lunarTag(a)}{a.kind === '기념일' && n.years > 0 ? ` · ${n.years}주년` : ''}{a.person ? ` · ${a.person}` : ''}</span>
            </button>))}</div>
        ) : <p className="muted anniv-empty">{store.annivDays}일 이내에 다가오는 기념일이 없습니다.</p>}
      </section>

      <DdayPanel />

      <section className="panel">
        <h2>앞으로 12개월</h2>
        <div className="anniv-months">{byMonth.map(({ m, list }) => (
          <div key={m.getMonth()} className={`anniv-month ${list.length ? '' : 'none'}`}>
            <b>{m.getFullYear() !== now.getFullYear() ? `${m.getFullYear()}년 ` : ''}{m.getMonth() + 1}월</b>
            {list.length ? list.map(({ a, n }) => (
              <button type="button" key={a.id} className="an-mi" onClick={() => setOpenId(a.id)}><em>{n.date.getDate()}일</em> {a.name}<small>{lunarTag(a)}{a.person ? ` · ${a.person}` : ''} · D-{n.dday}</small></button>
            )) : <span className="muted">없음</span>}
          </div>))}</div>
      </section>

      <AnnivExcel />

      <AnnivManager onOpen={setOpenId} />

      {opened && <AnnivDetail a={opened} onClose={() => setOpenId(null)} />}

    </div>
  );
}

/* 엑셀 양식 다운로드 · 업로드 */
/** 양식: 설명 · 머리글 · 예시 2줄 · 지금 등록된 기념일 (고쳐서 다시 올리면 전체가 바뀜) */
function templateFile(list = []) {
  const desc = [
    '[이름] 글자\n표시할 이름 (예: 어머니 생신)\n"(예시)"로 끝나면 올리지 않음',
    '[관련 인물] 글자 (자유 입력)\n누구와 관련된 날인지 (예: 어머니)\n여러 명은 쉼표로 (예: 아내, 딸)',
    '[날짜] YYYY-MM-DD\n처음 날짜 (예: 1990-09-30)\n1990.9.30, 1990/9/30도 가능',
    '[종류] 생일 또는 기념일\n비우면 생일\n기념일은 처음 연도로 주년 계산',
    '[매년 반복] O 또는 X\nO = 매년 반복, X = 한 번만\n비우면 O',
    '[양력/음력] 양력 또는 음력\n비우면 양력\n연도를 모르면 날짜에 "10월 1일"',
  ];
  return writeXlsx([{
    name: '기념일', cols: [30, 30, 30, 30, 26, 26], grid: false, header: 1, blank: 30,
    rowStyle: { 0: 2 }, heights: { 0: 54, 1: 22 },
    rows: [desc, ANNIV_HEAD, ['홍길동 생일 (예시)', '홍길동 (대학 동기)', '1990-09-30', '생일', 'O', '양력'], ['어머니 생신 (예시)', '어머니', '10월 1일', '생일', 'O', '음력'],
      ...list.filter(a => !/\(예시\)$/.test(a.name)).sort((a, b) => a.date.slice(5).localeCompare(b.date.slice(5)))
        .map(a => [a.name, a.person || '', a.noYear ? `${a.leap ? '윤' : ''}${Number(a.date.slice(5, 7))}월 ${Number(a.date.slice(8, 10))}일` : a.date, a.kind, a.yearly ? 'O' : 'X', a.lunar ? '음력' : '양력'])],
  }]);
}

function AnnivExcel() {
  const { store, setStore } = useCtx();
  const ref = useRef(null);
  const [msg, setMsg] = useState(null);
  const [mode, setMode] = useState('replace');           // replace 전체 바꾸기 | merge 추가·수정만
  const [undo, setUndo] = useState(null);                // 올리기 전 목록 (되돌리기용)
  const skipTxt = sk => (sk.length ? ` · 건너뜀 ${sk.length}건 (${sk.map(x => `${x.row}행 ${x.why}`).join(', ')})` : '');
  const upload = async file => {
    if (!file) return;
    try {
      const rows = /\.csv$/i.test(file.name) ? parseCsv((await file.text()).replace(/^\uFEFF/, '')) : readXlsx(new Uint8Array(await file.arrayBuffer()));
      const { items, skipped } = parseAnnivRows(rows, excelDate);
      if (!items.length) throw new Error(skipped.length ? `올릴 수 있는 줄이 없습니다 (${skipped.map(x => `${x.row}행 ${x.why}`).join(', ')})` : '기념일이 없습니다. 양식의 "이름" 머리글 아래에 입력해 주세요');
      const before = store.anniv;
      if (mode === 'replace') {
        const res = replaceAnniv(before, items, uid);
        if (res.removed && !window.confirm(`엑셀의 ${res.list.length}건으로 기념일 목록 전체를 바꿉니다.\n엑셀에 없는 기존 기념일 ${res.removed}건은 삭제됩니다.${skipped.length ? `\n(오류 ${skipped.length}줄은 건너뜀)` : ''}\n\n진행할까요?`)) { setMsg({ t: '올리기를 취소했습니다.' }); return; }
        setStore(s => ({ ...s, anniv: res.list }));
        setMsg({ t: `${file.name}: 전체 바꾸기 완료 · 총 ${res.list.length}건 (새로 ${res.added}, 수정 ${res.updated}, 삭제 ${res.removed})${skipTxt(skipped)}` });
      } else {
        const res = mergeAnniv(before, items, uid);
        setStore(s => ({ ...s, anniv: res.list }));
        setMsg({ t: `${file.name}: 추가 ${res.added}건${res.updated ? `, 수정 ${res.updated}건` : ''}${res.removedExamples ? `, 예시 ${res.removedExamples}건 삭제` : ''}${skipTxt(skipped)}` });
      }
      setUndo(before);
    } catch (e) {
      setMsg({ err: true, t: `파일을 읽지 못했습니다: ${e.message}` });
    } finally {
      if (ref.current) ref.current.value = '';            // 같은 파일을 다시 골라도 올라가도록
    }
  };
  return (
    <section className="panel">
      <div className="csum-h"><h2>엑셀로 올리기</h2><span className="muted">양식을 내려받아 고친 뒤 업로드합니다 (.xlsx, .csv)</span></div>
      <div className="an-x">
        <div className="chips" role="radiogroup" aria-label="올리기 방식">
          <button role="radio" aria-checked={mode === 'replace'} aria-pressed={mode === 'replace'} onClick={() => setMode('replace')}>전체 바꾸기</button>
          <button role="radio" aria-checked={mode === 'merge'} aria-pressed={mode === 'merge'} onClick={() => setMode('merge')}>추가·수정만</button>
        </div>
        <div className="btns">
          <button className="btn" onClick={() => download(templateFile(store.anniv), 'anniversary_template.xlsx')}>양식 다운로드</button>
          <label className="btn primary">엑셀 업로드<input ref={ref} type="file" accept=".xlsx,.csv" hidden onChange={e => upload(e.target.files[0])} /></label>
          {undo && <button className="btn" onClick={() => { setStore(s => ({ ...s, anniv: undo })); setUndo(null); setMsg({ t: '올리기 전 목록으로 되돌렸습니다.' }); }}>되돌리기</button>}
        </div>
      </div>
      {msg && <p className={`sh-msg ${msg.err ? 'err' : ''}`} role="status">{msg.t}</p>}
      <p className="note">{mode === 'replace'
        ? '전체 바꾸기: 기념일 목록이 엑셀 내용과 똑같아집니다. 엑셀에 없는 기념일은 삭제되고(확인 후), 이름과 날짜가 같은 기념일은 엑셀 값으로 수정됩니다.'
        : '추가·수정만: 엑셀에 있는 기념일만 추가하거나 수정하고, 엑셀에 없는 기념일은 그대로 둡니다. 예시 기념일은 지워집니다.'}
        {' '}양식에는 지금 등록된 기념일이 들어 있으니 고쳐서 그대로 올리면 됩니다. 열: 이름 · 관련 인물 · 날짜 · 종류(생일/기념일) · 매년 반복(O/X) · 양력/음력. "양력/음력 · 날짜 · 내용"만 있는 표도 올릴 수 있고, 날짜는 연도 없이 "10월 1일"로 적어도 됩니다.</p>
    </section>
  );
}

/* 기념일 목록 편집 (표시 기간, 수정, 삭제, 추가) */
function AnnivManager({ onOpen }) {
  const { store, setStore, now } = useCtx();
  const blank = { name: '', person: '', date: iso(now), kind: '생일', yearly: true, lunar: false, noYear: false };
  const [f, setF] = useState(blank);
  const setDays = v => setStore(s => ({ ...s, annivDays: Math.max(0, Math.min(365, Number(v) || 0)) }));
  const upd = (id, patch) => setStore(s => ({ ...s, anniv: s.anniv.map(a => (a.id === id ? { ...a, ...patch } : a)) }));
  const del = id => setStore(s => toTrash(s, 'anniv', id));   // 휴지통으로
  // 관련 인물 ↔ 인맥 연결: 이름이 인맥의 사람과 같으면 personId 로 이어 둔다
  const people = store.people || [];
  const personOf = v => people.find(p => p.name === v || p.name.replace(/\s*\(.*\)$/, '') === v);
  const add = e => {
    e.preventDefault();
    if (!f.name.trim() || !f.date) return;
    setStore(s => ({ ...s, anniv: [...s.anniv, { id: uid(), ...f, name: f.name.trim(), person: f.person.trim() }] }));
    setF(blank);
  };
  const sort = store.annivSort || { key: 'next', dir: 'asc' };
  const setSort = patch => setStore(s => ({ ...s, annivSort: { ...(s.annivSort || { key: 'next', dir: 'asc' }), ...patch } }));
  const sorted = sortAnniv(store.anniv, sort, now);
  return (
    <div className="panel">
      <div className="csum-h"><h2>기념일 목록</h2><span className="muted">{store.anniv.length}건</span>
        <span className="rv-sort" role="group" aria-label="정렬">
          <select value={sort.key} onChange={e => setSort({ key: e.target.value })} aria-label="정렬 기준">{A_SORTS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
          <span className="rv-dir">{[['asc', '오름차순 ↑'], ['desc', '내림차순 ↓']].map(([k, n]) => <button key={k} type="button" aria-pressed={sort.dir === k} onClick={() => setSort({ dir: k })}>{n}</button>)}</span>
        </span></div>
      <label className="anniv-days">대시보드 표시 기간
        <span><b>D-</b><input type="number" min="0" max="365" value={store.annivDays} onChange={e => setDays(e.target.value)} aria-label="며칠 전부터 표시" />일 전부터 표시</span></label>
      <div className="tablewrap">
        <table className="prog anniv-tb">
          <thead><tr><th>이름</th><th>관련 인물</th><th>양/음</th><th>날짜</th><th>종류</th><th>매년</th><th>다음</th><th /></tr></thead>
          <tbody>{sorted.map(a => {
            const n = nextAnniv(a, now);
            return (
              <tr key={a.id}>
                <td><input value={a.name} onChange={e => upd(a.id, { name: e.target.value })} aria-label="이름" /></td>
                <td><span className="an-person"><input list="an-people" value={a.person || ''} onChange={e => upd(a.id, { person: e.target.value, personId: personOf(e.target.value)?.id || null })} placeholder="관련 인물" aria-label="관련 인물" />
                  {a.personId && people.some(p => p.id === a.personId) && <small className="an-link" title="인맥 관리의 사람과 연결됨">인맥 연결</small>}</span></td>
                <td><select value={a.lunar ? (a.leap ? 'L2' : 'L') : 'S'} onChange={e => upd(a.id, { lunar: e.target.value !== 'S', leap: e.target.value === 'L2' })} aria-label="양력/음력">
                  <option value="S">양력</option><option value="L">음력</option><option value="L2">음력 윤달</option></select></td>
                <td><DateCell a={a} onChange={patch => upd(a.id, patch)} /></td>
                <td><select value={a.kind} onChange={e => upd(a.id, { kind: e.target.value })} aria-label="종류">{ANNIV_KINDS.map(k => <option key={k}>{k}</option>)}</select></td>
                <td><input type="checkbox" checked={a.yearly} onChange={e => upd(a.id, { yearly: e.target.checked })} aria-label="매년 반복" /></td>
                <td className="nowrap">{n ? <>{n.dday === 0 ? '오늘' : `D-${n.dday}`}{a.lunar && <small className="muted"> · 양력 {n.date.getMonth() + 1}/{n.date.getDate()}</small>}</> : '지남'}</td>
                <td className="nowrap"><button className="btn sm" onClick={() => onOpen(a.id)}>상세</button> <button className="btn sm" onClick={() => del(a.id)}>삭제</button></td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      <datalist id="an-people">{people.map(p => <option key={p.id} value={p.name} />)}</datalist>
      <form className="anniv-add" onSubmit={add}>
        <input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="기념일 이름 (예: 아버지 생신)" aria-label="새 기념일 이름" />
        <input list="an-people" value={f.person} onChange={e => setF({ ...f, person: e.target.value, personId: personOf(e.target.value)?.id || null })} placeholder="관련 인물 (예: 어머니)" aria-label="새 기념일 관련 인물" className="anniv-person" />
        <select value={f.lunar ? 'L' : 'S'} onChange={e => setF({ ...f, lunar: e.target.value === 'L' })} aria-label="새 기념일 양력/음력"><option value="S">양력</option><option value="L">음력</option></select>
        <DateCell a={f} onChange={patch => setF({ ...f, ...patch })} />
        <select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })} aria-label="새 기념일 종류">{ANNIV_KINDS.map(k => <option key={k}>{k}</option>)}</select>
        <label className="chk"><input type="checkbox" checked={f.yearly} onChange={e => setF({ ...f, yearly: e.target.checked })} />매년</label>
        <button className="btn primary" disabled={!f.name.trim()}>추가</button>
      </form>
      <p className="note">기념일 종류는 처음 날짜의 연도로 몇 주년인지 계산합니다(연도 모름이면 주년 없음). 매년 반복을 끄면 그 날짜 한 번만 표시됩니다. 음력은 해마다 양력 날짜로 바꿔 달력·D-day에 보여 줍니다.</p>
    </div>
  );
}

/* 기념일 상세 팝업: 다음 날짜 · 앞으로 3번 · 관련 인물(인맥) · 바로 고치기 · 삭제 */
function AnnivDetail({ a, onClose }) {
  const { store, setStore, now } = useCtx();
  const upd = patch => setStore(s => ({ ...s, anniv: s.anniv.map(x => (x.id === a.id ? { ...x, ...patch } : x)) }));
  const people = store.people || [];
  const person = people.find(p => p.id === a.personId) || people.find(p => a.person && (p.name === a.person || p.name.replace(/\s*\(.*\)$/, '') === a.person));
  const n = nextAnniv(a, now);
  // 앞으로 세 번 (매년 반복일 때)
  const nexts = [];
  if (n) { let d = n.date; for (let i = 0; i < 3 && d; i++) { const x = nextAnniv(a, d); if (!x) break; nexts.push(x); d = new Date(x.date.getFullYear(), x.date.getMonth(), x.date.getDate() + 1); if (!a.yearly) break; } }
  const [arm, setArm] = useState(false);
  const del = () => { if (!arm) { setArm(true); setTimeout(() => setArm(false), 3000); return; } setStore(s => toTrash(s, 'anniv', a.id)); onClose(); };
  return (
    <Popup title={a.name} sub={`${a.kind}${a.person ? ` · ${a.person}` : ''}`} onClose={onClose}>
      <div className={`an-dd ${n && n.dday <= 3 ? 'soon' : ''}`}>
        {n ? <><b>{n.dday === 0 ? '오늘' : `D-${n.dday}`}</b><span>{fmtMD(n.date)}{a.lunar ? ` (음력 ${annivDateText(a)})` : ''}{a.kind === '기념일' && n.years > 0 ? ` · ${n.years}주년` : ''}</span></> : <span className="muted">지난 날짜입니다 (한 번만)</span>}
      </div>
      {nexts.length > 1 && <ul className="an-next">{nexts.map(x => <li key={x.key}><span>{x.date.getFullYear()}년</span>{fmtMD(x.date)}<small className="muted">D-{Math.round((x.date - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5)}{a.kind === '기념일' && x.years > 0 ? ` · ${x.years}주년` : ''}</small></li>)}</ul>}
      {person && <div className="an-person-card"><span className="rv-av" aria-hidden="true">{person.name.slice(0, 1)}</span><span><b>{person.name}</b><small className="muted">{[person.group, person.company, person.phone].filter(Boolean).join(' · ')}</small></span><small className="an-link">인맥 연결</small></div>}
      <div className="an-form">
        <label>이름<input value={a.name} onChange={e => upd({ name: e.target.value })} /></label>
        <label>관련 인물<input list="an-people" value={a.person || ''} onChange={e => { const v = e.target.value; upd({ person: v, personId: people.find(p => p.name === v)?.id || null }); }} /></label>
        <label>종류<select value={a.kind} onChange={e => upd({ kind: e.target.value })}>{ANNIV_KINDS.map(k => <option key={k}>{k}</option>)}</select></label>
        <label>양력 / 음력<select value={a.lunar ? (a.leap ? 'L2' : 'L') : 'S'} onChange={e => upd({ lunar: e.target.value !== 'S', leap: e.target.value === 'L2' })}><option value="S">양력</option><option value="L">음력</option><option value="L2">음력 윤달</option></select></label>
        <label className="an-wide">날짜<DateCell a={a} onChange={upd} /></label>
        <label className="an-chk"><input type="checkbox" checked={a.yearly} onChange={e => upd({ yearly: e.target.checked })} />매년 반복</label>
      </div>
      <datalist id="an-people">{people.map(p => <option key={p.id} value={p.name} />)}</datalist>
      <div className="btns"><span className="grow note">고치면 바로 저장됩니다.</span><button className={`btn ${arm ? 'danger' : ''}`} onClick={del}>{arm ? '정말 삭제?' : '삭제 (휴지통)'}</button></div>
    </Popup>
  );
}

/** 날짜 칸: 연도를 알면 날짜 입력, 모르면 월·일만. "연도 모름" 체크로 바꾼다 */
function DateCell({ a, onChange }) {
  const [, m, d] = a.date.split('-').map(Number);
  const setMD = (mm, dd) => { const dt = new Date(2000, mm - 1, dd); if (dt.getMonth() === mm - 1) onChange({ date: `2000-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}` }); };
  return (
    <span className="an-date">
      {a.noYear
        ? <span className="an-md"><input type="number" min="1" max="12" value={m} onChange={e => setMD(Number(e.target.value), d)} aria-label="월" />월
            <input type="number" min="1" max={a.lunar ? 30 : 31} value={d} onChange={e => setMD(m, Number(e.target.value))} aria-label="일" />일</span>
        : <input type="date" value={a.date} onChange={e => e.target.value && onChange({ date: e.target.value })} aria-label="날짜" />}
      <label className="an-noyear"><input type="checkbox" checked={!!a.noYear} onChange={e => onChange({ noYear: e.target.checked, date: e.target.checked ? `2000-${a.date.slice(5)}` : `${new Date().getFullYear()}-${a.date.slice(5)}` })} />연도 모름</label>
      {a.lunar && <small className="muted">{annivDateText(a)}</small>}
    </span>
  );
}
