import React, { useState } from 'react';
import { AREAS, iso } from '../data.js';
import { ANNIV_KINDS, nextAnniv } from '../anniv.js';
import { ActionRow, WEEK, areaVar, useCtx } from '../shared.jsx';

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

      <AnnivManager />

      <h2 className="hv-sec">기념일 관리 체크 항목</h2>
      <div className="catv-items">
        {items.map(({ it, rows }) => (
          <section key={it} className="catv-item">
            <div className="catv-item-h"><h3>{it}</h3><span className="muted">{rows.filter(isDone).length}/{rows.length}</span></div>
            {rows.map(r => <ActionRow key={r.id} row={r} showCycle />)}
          </section>
        ))}
      </div>
    </div>
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

