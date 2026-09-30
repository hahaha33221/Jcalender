import React, { useState } from 'react';
import { iso } from '../data.js';
import { useCtx } from '../shared.jsx';
import { ddayInfo } from '../dday.js';

/* 개인 › 기념일 관리 › D-day 관리
   - 목표일까지(D-): 시험, 여행, 마감처럼 다가오는 날
   - 시작일부터(D+ / N일째): 사귄 날, 금연 시작일처럼 지난 날을 세고 다음 100일·주년을 알려 준다
   - 카드를 누르면 수정, 대시보드 표시(고정)를 켜면 대시보드 위쪽에 보인다 */
const uid = () => Math.random().toString(36).slice(2, 10);
const dot = s => `${s.slice(0, 4)}. ${Number(s.slice(5, 7))}. ${Number(s.slice(8, 10))}.`;
export const MODES = { until: '목표일까지 (D-)', since: '시작일부터 (D+)' };

export default function DdayPanel() {
  const { store, setStore, now } = useCtx();
  const list = store.ddays || [];
  const set = fn => setStore(s => ({ ...s, ddays: fn(s.ddays || []) }));
  const blank = { name: '', date: iso(now), mode: 'until', startOne: true, pin: true, memo: '' };
  const [f, setF] = useState(blank);
  const [edit, setEdit] = useState(null);                   // 수정 중인 id
  const [arm, setArm] = useState(null);
  const [tab, setTab] = useState('all');                    // all · until · since · past

  const add = e => {
    e.preventDefault();
    if (!f.name.trim() || !f.date) return;
    set(l => [...l, { id: uid(), ...f, name: f.name.trim(), memo: f.memo.trim() }]);
    setF({ ...blank, mode: f.mode });
  };
  const upd = (id, patch) => set(l => l.map(x => (x.id === id ? { ...x, ...patch } : x)));
  const del = id => { set(l => l.filter(x => x.id !== id)); setArm(null); setEdit(null); };

  const rows = list.map(x => ({ x, i: ddayInfo(x, now) }));
  // 순서: 다가오는 목표일(가까운 순) → 지난 날 세기(다음 기념 가까운 순) → 지난 목표일
  const grp = ({ x, i }) => (i.past ? 2 : x.mode === 'since' && i.next ? 1 : 0);
  const shown = rows.filter(({ x, i }) => (tab === 'all' ? true : tab === 'past' ? i.past : x.mode === tab && !i.past))
    .sort((a, b) => grp(a) - grp(b) || (grp(a) === 1 ? a.i.next.dday - b.i.next.dday : Math.abs(a.i.n) - Math.abs(b.i.n)));
  const cnt = k => rows.filter(({ x, i }) => (k === 'past' ? i.past : x.mode === k && !i.past)).length;

  return (
    <section className="panel dd" aria-label="D-day 관리">
      <div className="csum-h"><h2>D-day 관리</h2><span className="muted">{list.length}개 · 카드를 누르면 수정</span>
        <span className="grow" />
        <span className="chips">{[['all', `전체 ${list.length}`], ['until', `다가오는 ${cnt('until')}`], ['since', `지난 날 세기 ${cnt('since')}`], ['past', `지남 ${cnt('past')}`]].map(([k, n]) =>
          <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>{n}</button>)}</span></div>

      {shown.length ? <div className="dd-grid">{shown.map(({ x, i }) => (
        edit === x.id ? (
          <div key={x.id} className="dd-card editing">
            <input value={x.name} onChange={e => upd(x.id, { name: e.target.value })} aria-label="D-day 이름" />
            <select value={x.mode} onChange={e => upd(x.id, { mode: e.target.value })} aria-label="종류">{Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <input type="date" value={x.date} onChange={e => e.target.value && upd(x.id, { date: e.target.value })} aria-label="날짜" />
            {x.mode === 'since' && <label className="dd-chk"><input type="checkbox" checked={!!x.startOne} onChange={e => upd(x.id, { startOne: e.target.checked })} />시작일을 1일로 세기</label>}
            <label className="dd-chk"><input type="checkbox" checked={!!x.pin} onChange={e => upd(x.id, { pin: e.target.checked })} />대시보드에 표시</label>
            <input value={x.memo || ''} onChange={e => upd(x.id, { memo: e.target.value })} placeholder="메모 (선택)" aria-label="메모" />
            <div className="dd-btns">
              {arm === x.id ? <button className="btn sm danger" onClick={() => del(x.id)}>정말 삭제?</button> : <button className="btn sm" onClick={() => setArm(x.id)}>삭제</button>}
              <span className="grow" /><button className="btn sm primary" onClick={() => { setEdit(null); setArm(null); }}>완료</button></div>
          </div>
        ) : (
          <button key={x.id} className={`dd-card ${x.mode} ${i.past ? 'past' : ''} ${i.soon ? 'soon' : ''} ${i.n === 0 && x.mode === 'until' ? 'today' : ''}`} onClick={() => setEdit(x.id)}>
            <span className="dd-top"><b className="dd-name">{x.name}</b>{x.pin && <span className="dd-pin">대시보드</span>}</span>
            <b className="dd-big">{i.big}</b>
            <span className="dd-sub">{x.mode === 'until' ? `${dot(x.date)}${i.past ? ' · 지남' : ''}` : `${dot(x.date)}부터${i.sub ? ` · ${i.sub}` : ''}`}</span>
            {i.next && <span className="dd-next">다음 {i.next.label} · {dot(i.next.key)} (D-{i.next.dday})</span>}
            {x.memo && <span className="dd-memo">{x.memo}</span>}
          </button>
        )))}</div>
        : <p className="muted">{list.length ? '해당하는 D-day가 없습니다.' : '시험·여행·마감처럼 기다리는 날이나, 사귄 날·금연 시작일처럼 세고 싶은 날을 추가하세요.'}</p>}

      <form className="dd-add" onSubmit={add}>
        <input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="D-day 이름 (예: 자격증 시험, 금연 시작)" aria-label="새 D-day 이름" />
        <select value={f.mode} onChange={e => setF({ ...f, mode: e.target.value })} aria-label="새 D-day 종류">{Object.entries(MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} aria-label="새 D-day 날짜" />
        {f.mode === 'since' && <label className="dd-chk"><input type="checkbox" checked={f.startOne} onChange={e => setF({ ...f, startOne: e.target.checked })} />시작일을 1일로</label>}
        <label className="dd-chk"><input type="checkbox" checked={f.pin} onChange={e => setF({ ...f, pin: e.target.checked })} />대시보드 표시</label>
        <button className="btn primary" disabled={!f.name.trim() || !f.date}>추가</button>
      </form>
      <p className="note">목표일까지는 D-12처럼 남은 날을, 시작일부터는 지난 날(시작일을 1일로 세면 "100일째")과 다음 100일·주년을 보여 줍니다. 목표일과 100일·주년은 대시보드 달력에도 표시됩니다.</p>
    </section>
  );
}

/** 대시보드용: "대시보드 표시"를 켠 D-day 가로 목록 (없으면 숨김) */
export function DdayStrip() {
  const { store, now, openCat } = useCtx();
  const list = (store.ddays || []).filter(x => x.pin).map(x => ({ x, i: ddayInfo(x, now) }))
    .sort((a, b) => (a.x.mode === 'until' ? 0 : 1) - (b.x.mode === 'until' ? 0 : 1) || (a.i.past - b.i.past) || Math.abs(a.i.n) - Math.abs(b.i.n));
  if (!list.length) return null;
  return (
    <section className="panel dd-strip" aria-label="D-day">
      <div className="csum-h"><h2>D-day</h2><span className="muted">{list.length}개</span>
        <button className="btn sm" onClick={() => openCat('P', '기념일 관리')}>D-day 관리</button></div>
      <div className="dd-row">{list.map(({ x, i }) => (
        <div key={x.id} className={`dd-mini ${x.mode} ${i.soon ? 'soon' : ''} ${i.past ? 'past' : ''}`}>
          <b>{i.big}</b><span>{x.name}</span>{i.next && <small>다음 {i.next.label} D-{i.next.dday}</small>}
        </div>))}</div>
    </section>
  );
}
