import React, { useState } from 'react';
import { AREAS, ROWS, iso } from '../data.js';
import { WEEK, areaVar, num, useCtx } from '../shared.jsx';
import BarChart from './BarChart.jsx';
import { WORKOUT_TYPES, avgClock, estimateKcal, fmtDur, seedHealth, sleepMinutes } from './health.js';

/* 개인 › 건강 관리 전용 화면: 운동·수면 기록 그래프 */
const RANGES = [7, 14, 30];
const uid = () => Math.random().toString(36).slice(2, 10);
const md = d => `${d.getMonth() + 1}/${d.getDate()}`;
const longDate = d => `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`;
const ACT_WORKOUT = ROWS.find(r => r.a === 'P' && r.c === 'D' && r.action === '운동 기록');
const ACT_SLEEP = ROWS.find(r => r.a === 'P' && r.c === 'D' && r.action === '수면 기록');

export default function HealthView({ area, cat, group }) {
  const { store, setStore, now, isDone, finish } = useCtx();
  const health = store.health || seedHealth(now);
  const [range, setRange] = useState(14);
  const [table, setTable] = useState(false);
  const setHealth = fn => setStore(s => ({ ...s, health: fn(s.health || seedHealth(now)) }));

  // 기간의 날짜 목록 (오늘 포함)
  const days = Array.from({ length: range }, (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - (range - 1 - i)));
  const byDay = days.map(d => {
    const k = iso(d);
    const ws = health.workouts.filter(w => w.date === k);
    const sl = health.sleep.find(s => s.date === k);
    return { d, k, ws, min: ws.reduce((a, w) => a + w.minutes, 0), kcal: ws.reduce((a, w) => a + w.kcal, 0), sl, sleepMin: sl ? sleepMinutes(sl.bed, sl.wake) : 0 };
  });

  const exDays = byDay.filter(x => x.min > 0);
  const exTotal = exDays.reduce((a, x) => a + x.min, 0);
  const kcalTotal = exDays.reduce((a, x) => a + x.kcal, 0);
  const slDays = byDay.filter(x => x.sl);
  const slAvg = slDays.length ? Math.round(slDays.reduce((a, x) => a + x.sleepMin, 0) / slDays.length) : 0;
  const slGoalHit = slDays.filter(x => x.sleepMin >= health.goalSleep).length;

  const exData = byDay.map(x => ({
    key: x.k, label: md(x.d), value: x.min, title: longDate(x.d),
    tip: [...x.ws.map(w => `${w.type} ${w.minutes}분`), `합계 ${num(x.min)}분 · ${num(x.kcal)}kcal`],
  }));
  const slData = byDay.map(x => ({
    key: x.k, label: md(x.d), value: x.sleepMin, title: longDate(x.d),
    tip: x.sl ? [`${x.sl.bed} 취침 → ${x.sl.wake} 기상`, fmtDur(x.sleepMin)] : [],
  }));

  const addWorkout = w => {
    setHealth(h => ({ ...h, workouts: [...h.workouts, { id: uid(), ...w }] }));
  };
  const addSleep = s => {
    setHealth(h => ({ ...h, sleep: [...h.sleep.filter(x => x.date !== s.date), { id: uid(), ...s }] }));
  };
  const delWorkout = id => setHealth(h => ({ ...h, workouts: h.workouts.filter(w => w.id !== id) }));
  const delSleep = id => setHealth(h => ({ ...h, sleep: h.sleep.filter(s => s.id !== id) }));
  const setGoal = v => setHealth(h => ({ ...h, goalSleep: Math.max(240, Math.min(720, Math.round(Number(v) * 60) || 420)) }));

  const items = group.items.map(it => ({ it, rows: group.rows.filter(r => r.item === it) }));

  return (
    <div className="catv hv" style={{ '--ac': areaVar(area) }}>
      <header className="page-h">
        <h1 className="area-title">{cat}</h1>
        <p>{AREAS[area].n} · 운동과 수면 기록을 그래프로 봅니다. 막대에 마우스를 올리면 상세 내용이 나옵니다.</p>
      </header>

      <div className="bar">
        <div className="chips" role="group" aria-label="기간">
          {RANGES.map(r => <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>최근 {r}일</button>)}
        </div>
        <div className="chips grow-r" role="group" aria-label="보기 방식">
          <button aria-pressed={!table} onClick={() => setTable(false)}>그래프</button>
          <button aria-pressed={table} onClick={() => setTable(true)}>표</button>
        </div>
      </div>

      <div className="hv-stats">
        <Stat label="운동 합계" value={fmtDur(exTotal)} sub={`${range}일 중 ${exDays.length}일 운동`} tone="ex" />
        <Stat label="소모 칼로리" value={`${num(kcalTotal)}kcal`} sub={`운동한 날 평균 ${num(exDays.length ? Math.round(kcalTotal / exDays.length) : 0)}kcal`} tone="ex" />
        <Stat label="평균 수면" value={slAvg ? fmtDur(slAvg) : '-'} sub={`목표 ${fmtDur(health.goalSleep)} 달성 ${slGoalHit}/${slDays.length}일`} tone="sl" />
        <Stat label="평균 취침 · 기상" value={`${avgClock(slDays.map(x => x.sl.bed), true)} · ${avgClock(slDays.map(x => x.sl.wake))}`} sub="자정 넘긴 취침도 이어서 계산" tone="sl" />
      </div>

      {table ? (
        <div className="panel tablewrap">
          <table className="prog hv-table">
            <thead><tr><th>날짜</th><th>운동</th><th>운동 시간</th><th>칼로리</th><th>취침</th><th>기상</th><th>수면</th></tr></thead>
            <tbody>{[...byDay].reverse().map(x => (
              <tr key={x.k}><td>{longDate(x.d)}</td><td>{x.ws.map(w => w.type).join(', ') || '-'}</td><td>{x.min ? `${num(x.min)}분` : '-'}</td><td>{x.kcal ? num(x.kcal) : '-'}</td>
                <td>{x.sl?.bed || '-'}</td><td>{x.sl?.wake || '-'}</td><td>{x.sl ? fmtDur(x.sleepMin) : '-'}</td></tr>))}</tbody>
          </table>
        </div>
      ) : (
        <div className="hv-charts">
          <section className="panel">
            <div className="hv-ch"><h2>운동 시간</h2><span className="muted">하루 합계 (분)</span></div>
            <BarChart data={exData} color="var(--viz-ex)" fmt={v => `${v}분`} tickFmt={v => `${v}`} label={`최근 ${range}일 운동 시간 막대 그래프`} />
          </section>
          <section className="panel">
            <div className="hv-ch"><h2>수면 시간</h2><span className="muted">기상한 날 기준 (시간)</span></div>
            <BarChart data={slData} color="var(--viz-sl)" fmt={v => `${Math.round(v / 6) / 10}h`} tickFmt={v => `${v / 60}`} steps={[60, 120, 180, 240]}
              goal={health.goalSleep} goalLabel={`목표 ${Math.round(health.goalSleep / 6) / 10}h`} label={`최근 ${range}일 수면 시간 막대 그래프`} />
          </section>
        </div>
      )}

      <div className="hv-forms">
        <WorkoutForm today={iso(now)} onAdd={addWorkout} recent={[...health.workouts].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5)} onDelete={delWorkout} />
        <SleepForm today={iso(now)} onAdd={addSleep} goal={health.goalSleep} setGoal={setGoal}
          recent={[...health.sleep].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5)} onDelete={delSleep} />
      </div>

    </div>
  );
}

function Stat({ label, value, sub, tone }) {
  return (
    <div className={`hv-stat ${tone}`}>
      <span className="muted">{label}</span>
      <b>{value}</b>
      <span className="hv-sub">{sub}</span>
    </div>
  );
}

function WorkoutForm({ today, onAdd, recent, onDelete }) {
  const [f, setF] = useState({ date: today, type: '러닝', minutes: 30 });
  const submit = e => {
    e.preventDefault();
    const minutes = Math.max(1, Math.min(600, Number(f.minutes) || 0));
    onAdd({ date: f.date, type: f.type, minutes, kcal: estimateKcal(f.type, minutes) });
  };
  return (
    <section className="panel hv-form">
      <h2>운동 기록 추가</h2>
      <form onSubmit={submit}>
        <label>날짜<input type="date" value={f.date} max={today} onChange={e => setF({ ...f, date: e.target.value })} /></label>
        <label>종류<select value={f.type} onChange={e => setF({ ...f, type: e.target.value })}>{WORKOUT_TYPES.map(t => <option key={t}>{t}</option>)}</select></label>
        <label>시간(분)<input type="number" min="1" max="600" value={f.minutes} onChange={e => setF({ ...f, minutes: e.target.value })} /></label>
        <button className="btn primary">추가</button>
      </form>
      <p className="note">칼로리는 종류별 평균값으로 추정합니다.</p>
      <ul className="hv-recent">{recent.map(w => (
        <li key={w.id}><span>{w.date.slice(5).replace('-', '/')}</span><span className="grow">{w.type} {num(w.minutes)}분 · {num(w.kcal)}kcal</span><button className="tl-del" onClick={() => onDelete(w.id)}>삭제</button></li>))}</ul>
    </section>
  );
}

function SleepForm({ today, onAdd, goal, setGoal, recent, onDelete }) {
  const [f, setF] = useState({ date: today, bed: '23:30', wake: '07:00' });
  const submit = e => { e.preventDefault(); if (f.bed && f.wake) onAdd({ ...f }); };
  return (
    <section className="panel hv-form">
      <h2>수면 기록 추가</h2>
      <form onSubmit={submit}>
        <label>기상한 날<input type="date" value={f.date} max={today} onChange={e => setF({ ...f, date: e.target.value })} /></label>
        <label>취침<input type="time" value={f.bed} onChange={e => setF({ ...f, bed: e.target.value })} /></label>
        <label>기상<input type="time" value={f.wake} onChange={e => setF({ ...f, wake: e.target.value })} /></label>
        <button className="btn primary">저장</button>
      </form>
      <p className="note">
        {f.bed && f.wake ? `수면 ${fmtDur(sleepMinutes(f.bed, f.wake))}. ` : ''}같은 날 기록이 있으면 바꿔 씁니다.
        <span className="hv-goal">목표 <input type="number" min="4" max="12" step="0.5" value={goal / 60} onChange={e => setGoal(e.target.value)} aria-label="목표 수면 시간" />시간</span>
      </p>
      <ul className="hv-recent">{recent.map(s => (
        <li key={s.id}><span>{s.date.slice(5).replace('-', '/')}</span><span className="grow">{s.bed} → {s.wake} · {fmtDur(sleepMinutes(s.bed, s.wake))}</span><button className="tl-del" onClick={() => onDelete(s.id)}>삭제</button></li>))}</ul>
    </section>
  );
}
