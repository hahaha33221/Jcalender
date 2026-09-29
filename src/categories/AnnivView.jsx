import React, { useRef, useState } from 'react';
import { AREAS, iso } from '../data.js';
import { ANNIV_HEAD, ANNIV_KINDS, mergeAnniv, nextAnniv, parseAnnivRows } from '../anniv.js';
import { WEEK, areaVar, useCtx } from '../shared.jsx';
import { download, excelDate, readXlsx, writeXlsx } from '../xlsx.js';
import { parseCsv } from './samsungHealth.js';

/* 개인 › 기념일 관리 전용 화면: 다가오는 기념일, 월별 달력형 목록, 기념일 편집 */
const uid = () => Math.random().toString(36).slice(2, 10);
const fmtMD = d => `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`;

export default function AnnivView({ area, cat, group }) {
  const { store, now, isDone } = useCtx();
  const all = store.anniv.map(a => ({ a, n: nextAnniv(a, now) })).filter(x => x.n).sort((x, y) => x.n.dday - y.n.dday);
  const soon = all.filter(x => x.n.dday <= store.annivDays);
  // 앞으로 12개월을 월별로 묶는다
  const months = Array.from({ length: 12 }, (_, i) => new Date(now.getFullYear(), now.getMonth() + i, 1));
  const byMonth = months.map(m => ({ m, list: all.filter(x => x.n.date.getFullYear() === m.getFullYear() && x.n.date.getMonth() === m.getMonth()) }));
  const items = group.items.map(it => ({ it, rows: group.rows.filter(r => r.item === it) }));

  return (
    <div className="catv" style={{ '--ac': areaVar(area) }}>
      <header className="page-h">
        <h1 className="area-title">{cat}</h1>
        <p>{AREAS[area].n} · 생일과 기념일 {store.anniv.length}건 · 대시보드에는 D-{store.annivDays}일 이내 기념일이 보입니다.</p>
      </header>

      <section className="panel anniv">
        <div className="csum-h"><h2>다가오는 기념일</h2><span className="muted">D-{store.annivDays}일 이내 · {soon.length}건</span></div>
        {soon.length ? (
          <div className="anniv-list">{soon.map(({ a, n }) => (
            <div key={a.id} className={`anniv-card ${n.dday === 0 ? 'hot' : n.dday <= 3 ? 'soon' : ''}`}>
              <b className="anniv-d">{n.dday === 0 ? '오늘' : `D-${n.dday}`}</b>
              <span className="anniv-n">{a.name}</span>
              <span className="anniv-m">{a.kind} · {fmtMD(n.date)}{a.kind === '기념일' && n.years > 0 ? ` · ${n.years}주년` : ''}</span>
            </div>))}</div>
        ) : <p className="muted anniv-empty">{store.annivDays}일 이내에 다가오는 기념일이 없습니다.</p>}
      </section>

      <section className="panel">
        <h2>앞으로 12개월</h2>
        <div className="anniv-months">{byMonth.map(({ m, list }) => (
          <div key={m.getMonth()} className={`anniv-month ${list.length ? '' : 'none'}`}>
            <b>{m.getFullYear() !== now.getFullYear() ? `${m.getFullYear()}년 ` : ''}{m.getMonth() + 1}월</b>
            {list.length ? list.map(({ a, n }) => (
              <span key={a.id}><em>{n.date.getDate()}일</em> {a.name}<small> · D-{n.dday}</small></span>
            )) : <span className="muted">없음</span>}
          </div>))}</div>
      </section>

      <AnnivExcel />

      <AnnivManager />

    </div>
  );
}

/* 엑셀 양식 다운로드 · 업로드 */
function templateFile() {
  return writeXlsx([
    { name: '기념일', cols: [28, 20, 18, 16], rows: [ANNIV_HEAD, ['홍길동 생일 (예시)', '1990-09-30', '생일', 'O'], ['결혼기념일 (예시)', '2016-10-07', '기념일', 'O']] },
    { name: '작성 안내', cols: [18, 70], rows: [
      ['항목', '작성 방법'],
      ['이름', '표시할 이름 (예: 어머니 생신). 이름이 "(예시)" 로 끝나는 줄은 올리지 않습니다.'],
      ['날짜', '처음 날짜. 1990-09-30, 1990.9.30, 1990/9/30 또는 엑셀 날짜 모두 됩니다.'],
      ['종류', '생일 또는 기념일 (비우면 생일). 기념일은 처음 연도로 몇 주년인지 계산합니다.'],
      ['매년 반복', 'O = 매년 반복, X = 그 날짜 한 번만 (비우면 O)'],
      ['올리기', '기념일 관리 › 엑셀 업로드. 이름과 날짜가 같은 기념일은 새 값으로 바뀌고, 예시 기념일은 지워집니다.'],
    ] },
  ]);
}

function AnnivExcel() {
  const { store, setStore } = useCtx();
  const ref = useRef(null);
  const [msg, setMsg] = useState(null);
  const upload = async file => {
    if (!file) return;
    try {
      const rows = /\.csv$/i.test(file.name) ? parseCsv((await file.text()).replace(/^\uFEFF/, '')) : readXlsx(new Uint8Array(await file.arrayBuffer()));
      const { items, skipped } = parseAnnivRows(rows, excelDate);
      if (!items.length) throw new Error(skipped.length ? `올릴 수 있는 줄이 없습니다 (${skipped.map(x => `${x.row}행 ${x.why}`).join(', ')})` : '기념일이 없습니다. 양식의 "이름" 머리글 아래에 입력해 주세요');
      const res = mergeAnniv(store.anniv, items, uid);
      setStore(s => ({ ...s, anniv: res.list }));
      setMsg({ t: `${file.name}: 추가 ${res.added}건${res.updated ? `, 갱신 ${res.updated}건` : ''}${res.removedExamples ? `, 예시 ${res.removedExamples}건 삭제` : ''}${skipped.length ? ` · 건너뜀 ${skipped.length}건 (${skipped.map(x => `${x.row}행 ${x.why}`).join(', ')})` : ''}` });
    } catch (e) {
      setMsg({ err: true, t: `파일을 읽지 못했습니다: ${e.message}` });
    }
    if (ref.current) ref.current.value = '';
  };
  return (
    <section className="panel">
      <div className="csum-h"><h2>엑셀로 올리기</h2><span className="muted">양식을 내려받아 작성한 뒤 업로드합니다 (.xlsx, .csv)</span></div>
      <div className="btns">
        <button className="btn" onClick={() => download(templateFile(), 'anniversary_template.xlsx')}>양식 다운로드</button>
        <label className="btn primary">엑셀 업로드<input ref={ref} type="file" accept=".xlsx,.csv" hidden onChange={e => upload(e.target.files[0])} /></label>
      </div>
      {msg && <p className={`sh-msg ${msg.err ? 'err' : ''}`} role="status">{msg.t}</p>}
      <p className="note">열: 이름 · 날짜 · 종류(생일/기념일) · 매년 반복(O/X). 이름과 날짜가 같으면 새 값으로 바뀌고, 예시 기념일은 지워집니다.</p>
    </section>
  );
}

/* 기념일 목록 편집 (표시 기간, 수정, 삭제, 추가) */
function AnnivManager() {
  const { store, setStore, now } = useCtx();
  const blank = { name: '', date: iso(now), kind: '생일', yearly: true };
  const [f, setF] = useState(blank);
  const setDays = v => setStore(s => ({ ...s, annivDays: Math.max(0, Math.min(365, Number(v) || 0)) }));
  const upd = (id, patch) => setStore(s => ({ ...s, anniv: s.anniv.map(a => (a.id === id ? { ...a, ...patch } : a)) }));
  const del = id => setStore(s => ({ ...s, anniv: s.anniv.filter(a => a.id !== id) }));
  const add = e => {
    e.preventDefault();
    if (!f.name.trim() || !f.date) return;
    setStore(s => ({ ...s, anniv: [...s.anniv, { id: uid(), ...f, name: f.name.trim() }] }));
    setF(blank);
  };
  const sorted = [...store.anniv].sort((x, y) => (nextAnniv(x, now)?.dday ?? 9999) - (nextAnniv(y, now)?.dday ?? 9999));
  return (
    <div className="panel">
      <h2>기념일 목록</h2>
      <label className="anniv-days">대시보드 표시 기간
        <span><b>D-</b><input type="number" min="0" max="365" value={store.annivDays} onChange={e => setDays(e.target.value)} aria-label="며칠 전부터 표시" />일 전부터 표시</span></label>
      <div className="tablewrap">
        <table className="prog anniv-tb">
          <thead><tr><th>이름</th><th>날짜</th><th>종류</th><th>매년</th><th>다음</th><th /></tr></thead>
          <tbody>{sorted.map(a => {
            const n = nextAnniv(a, now);
            return (
              <tr key={a.id}>
                <td><input value={a.name} onChange={e => upd(a.id, { name: e.target.value })} aria-label="이름" /></td>
                <td><input type="date" value={a.date} onChange={e => e.target.value && upd(a.id, { date: e.target.value })} aria-label="날짜" /></td>
                <td><select value={a.kind} onChange={e => upd(a.id, { kind: e.target.value })} aria-label="종류">{ANNIV_KINDS.map(k => <option key={k}>{k}</option>)}</select></td>
                <td><input type="checkbox" checked={a.yearly} onChange={e => upd(a.id, { yearly: e.target.checked })} aria-label="매년 반복" /></td>
                <td className="nowrap">{n ? (n.dday === 0 ? '오늘' : `D-${n.dday}`) : '지남'}</td>
                <td><button className="btn sm" onClick={() => del(a.id)}>삭제</button></td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      <form className="anniv-add" onSubmit={add}>
        <input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="기념일 이름 (예: 아버지 생신)" aria-label="새 기념일 이름" />
        <input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} aria-label="새 기념일 날짜" />
        <select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })} aria-label="새 기념일 종류">{ANNIV_KINDS.map(k => <option key={k}>{k}</option>)}</select>
        <label className="chk"><input type="checkbox" checked={f.yearly} onChange={e => setF({ ...f, yearly: e.target.checked })} />매년</label>
        <button className="btn primary" disabled={!f.name.trim()}>추가</button>
      </form>
      <p className="note">기념일 종류는 처음 날짜의 연도로 몇 주년인지 계산합니다. 매년 반복을 끄면 그 날짜 한 번만 표시됩니다.</p>
    </div>
  );
}

