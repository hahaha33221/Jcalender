import React, { useRef, useState } from 'react';
import { iso } from '../data.js';
import { WEEK, areaVar, num, useCtx } from '../shared.jsx';
import BarChart from './BarChart.jsx';
import { WORKOUT_TYPES, avgClock, estimateKcal, fmtDur, seedHealth, seedHealthExtra, sleepMinutes } from './health.js';
import { mergeImport, parseSamsungFiles, readFiles } from './samsungHealth.js';

/* 개인 › 건강 관리 대시보드: 삼성 헬스 데이터 가져오기 + 운동 · 수면 · 식단 · 병원 진찰 */
const RANGES = [7, 14, 30];
const TABS = [['ex', '운동'], ['sl', '수면'], ['fd', '식단'], ['md', '병원 진찰']];
const MEALS = ['아침', '점심', '저녁', '간식'];
const uid = () => Math.random().toString(36).slice(2, 10);
const md = d => `${d.getMonth() + 1}/${d.getDate()}`;
const mds = s => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
const longDate = d => `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`;
const dayDiff = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);
const norm = h => (h.meals ? h : { ...h, ...seedHealthExtra() });           // 예전 저장 데이터에 식단·병원 칸 채우기

export default function HealthView({ area, cat }) {
  const { store, setStore, now } = useCtx();
  const today = iso(now);
  const health = norm(store.health || seedHealth(now));
  const setHealth = fn => setStore(s => ({ ...s, health: fn(norm(s.health || seedHealth(now))) }));
  const [tab, setTab] = useState('ex');
  const [range, setRange] = useState(14);

  // ── 삼성 헬스 가져오기
  const fileRef = useRef(null);
  const [imp, setImp] = useState(null);                  // { busy, msg, err }
  const [guide, setGuide] = useState(!health.imported);
  const onFiles = async list => {
    if (!list?.length) return;
    setImp({ busy: true, msg: '파일을 읽는 중입니다…' });
    try {
      const files = await readFiles(list);
      const data = parseSamsungFiles(files);
      const total = data.workouts.length + data.sleep.length + data.meals.length;
      if (!total) { setImp({ err: true, msg: '운동·수면·식단 기록을 찾지 못했습니다. 삼성 헬스에서 받은 압축 파일(.zip)이나 exercise·sleep·food_intake CSV 파일을 골라 주세요.' }); return; }
      setHealth(h => mergeImport(h, data, new Date()));
      setImp({ msg: `가져왔습니다: 운동 ${num(data.workouts.length)}건 · 수면 ${num(data.sleep.length)}일 · 식단 ${num(data.meals.length)}건` });
      setGuide(false);
    } catch (e) {
      setImp({ err: true, msg: `파일을 읽지 못했습니다 (${e.message || e}). 압축 파일이 손상되지 않았는지 확인해 주세요.` });
    } finally { if (fileRef.current) fileRef.current.value = ''; }
  };

  // ── 날짜별 모음
  const days = Array.from({ length: range }, (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - (range - 1 - i)));
  const byDay = days.map(d => {
    const k = iso(d);
    const ws = health.workouts.filter(w => w.date === k);
    const sl = health.sleep.find(s => s.date === k);
    const ml = health.meals.filter(m => m.date === k);
    return { d, k, ws, min: ws.reduce((a, w) => a + w.minutes, 0), kcal: ws.reduce((a, w) => a + (w.kcal || 0), 0), sl, sleepMin: sl ? (sl.mins || sleepMinutes(sl.bed, sl.wake)) : 0, ml, food: ml.reduce((a, m) => a + (m.kcal || 0), 0) };
  });
  const last7 = byDay.slice(-7);
  const ex7 = last7.reduce((a, x) => a + x.min, 0), exCnt7 = last7.reduce((a, x) => a + x.ws.length, 0);
  const sl7 = last7.filter(x => x.sl), slAvg7 = sl7.length ? Math.round(sl7.reduce((a, x) => a + x.sleepMin, 0) / sl7.length) : 0;
  const foodToday = health.meals.filter(m => m.date === today).reduce((a, m) => a + (m.kcal || 0), 0);
  const nextVisit = [...health.visits].filter(v => v.next && v.next >= today).sort((a, b) => a.next.localeCompare(b.next))[0];

  const del = (k, id) => setHealth(h => ({ ...h, [k]: h[k].filter(x => x.id !== id) }));
  const add = (k, rec) => setHealth(h => ({ ...h, [k]: [...h[k], { id: uid(), src: '직접 입력', ...rec }] }));

  return (
    <div className="catv hv" style={{ '--ac': areaVar(area) }}>
      <header className="page-h">
        <h1 className="area-title">{cat}</h1>
      </header>

      <section className="panel sh-imp">
        <div className="csum-h"><h2>삼성 헬스 데이터</h2>
          <span className="muted">{health.imported ? `마지막 가져오기 ${health.imported.at} · 운동 ${num(health.imported.counts.workouts)} · 수면 ${num(health.imported.counts.sleep)} · 식단 ${num(health.imported.counts.meals)}` : '아직 가져온 적이 없습니다 (지금은 예시 기록)'}</span>
          <div className="grow-r btns">
            <button className="btn sm" onClick={() => setGuide(!guide)}>{guide ? '방법 닫기' : '가져오는 방법'}</button>
            <button className="btn sm primary" onClick={() => fileRef.current?.click()} disabled={imp?.busy}>삼성 헬스 파일 불러오기</button>
            <input ref={fileRef} type="file" accept=".zip,.csv" multiple hidden onChange={e => onFiles(e.target.files)} aria-label="삼성 헬스 파일" />
          </div></div>
        {imp && <p className={`sh-msg ${imp.err ? 'err' : ''}`} role="status">{imp.msg}</p>}
        {guide && (
          <ol className="sh-guide">
            <li>휴대폰에서 <b>삼성 헬스</b> 앱을 열고 오른쪽 위 <b>⋮ › 설정</b>으로 들어갑니다.</li>
            <li><b>개인 데이터 다운로드</b>를 누르고 본인 인증을 하면 휴대폰 <b>내 파일 › 내장 메모리 › Download › Samsung Health</b> 폴더에 파일이 저장됩니다.</li>
            <li>그 폴더를 압축(.zip)하거나 CSV 파일을 컴퓨터로 옮긴 뒤, 위 <b>삼성 헬스 파일 불러오기</b>로 고릅니다. 여러 파일을 한 번에 골라도 됩니다.</li>
            <li>운동(exercise), 수면(sleep), 식단(food_intake) 파일을 읽어 합칩니다. 같은 기록은 한 번만 들어가므로 다시 불러와도 괜찮습니다. 처음 불러오면 화면의 예시 기록(운동·수면·식단)은 지워집니다.</li>
          </ol>
        )}
        {health.imported?.files?.length > 0 && !guide && <p className="note">읽은 파일: {health.imported.files.join(', ')}</p>}
      </section>

      <div className="hv-stats sh-tiles">
        <button className={`hv-stat ex ${tab === 'ex' ? 'on' : ''}`} onClick={() => setTab('ex')}><span className="muted">운동 · 최근 7일</span><b>{fmtDur(ex7)}</b><span className="hv-sub">{exCnt7}회 · {num(last7.reduce((a, x) => a + x.kcal, 0))}kcal</span></button>
        <button className={`hv-stat sl ${tab === 'sl' ? 'on' : ''}`} onClick={() => setTab('sl')}><span className="muted">수면 · 최근 7일 평균</span><b>{slAvg7 ? fmtDur(slAvg7) : '-'}</b><span className="hv-sub">목표 {fmtDur(health.goalSleep)}</span></button>
        <button className={`hv-stat ${foodToday > health.goalKcal ? 'over' : 'ex'} ${tab === 'fd' ? 'on' : ''}`} onClick={() => setTab('fd')}><span className="muted">식단 · 오늘</span><b>{num(foodToday)}kcal</b>
          <span className="pbar"><i style={{ width: `${Math.min(100, foodToday / health.goalKcal * 100)}%`, background: foodToday > health.goalKcal ? 'var(--over)' : 'var(--viz-ex)' }} /></span></button>
        <button className={`hv-stat sl ${tab === 'md' ? 'on' : ''}`} onClick={() => setTab('md')}><span className="muted">병원 진찰 · 다음 예약</span><b>{nextVisit ? (nextVisit.next === today ? '오늘' : `D-${dayDiff(today, nextVisit.next)}`) : '-'}</b>
          <span className="hv-sub">{nextVisit ? `${nextVisit.hospital} · ${mds(nextVisit.next)}` : '예정된 진찰 없음'}</span></button>
      </div>

      <div className="bar">
        <div className="tabs sh-tabs" role="tablist">{TABS.map(([k, n]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{n}</button>)}</div>
        {tab !== 'md' && <div className="chips grow-r" role="group" aria-label="기간">{RANGES.map(r => <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>최근 {r}일</button>)}</div>}
      </div>

      {tab === 'ex' && <ExerciseTab byDay={byDay} health={health} today={today} add={add} del={del} range={range} />}
      {tab === 'sl' && <SleepTab byDay={byDay} health={health} today={today} setHealth={setHealth} del={del} />}
      {tab === 'fd' && <FoodTab byDay={byDay} health={health} today={today} add={add} del={del} setHealth={setHealth} />}
      {tab === 'md' && <VisitTab health={health} today={today} add={add} del={del} />}
    </div>
  );
}

const SrcTag = ({ src }) => (src && src !== '직접 입력' ? <span className={`tag ${src === '삼성 헬스' ? 'sh' : ''}`}>{src}</span> : null);

/* ── 운동 */
function ExerciseTab({ byDay, health, today, add, del, range }) {
  const data = byDay.map(x => ({ key: x.k, label: md(x.d), value: x.min, title: longDate(x.d),
    tip: [...x.ws.map(w => `${w.type} ${num(w.minutes)}분${w.km ? ` · ${w.km}km` : ''}`), `합계 ${num(x.min)}분 · ${num(x.kcal)}kcal`] }));
  const inRange = health.workouts.filter(w => w.date >= byDay[0].k && w.date <= today);
  const types = [...new Set(inRange.map(w => w.type))].map(t => ({ t, v: inRange.filter(w => w.type === t).reduce((a, w) => a + w.minutes, 0) })).sort((a, b) => b.v - a.v);
  const maxT = Math.max(1, ...types.map(x => x.v));
  const [f, setF] = useState({ date: today, type: '걷기', minutes: 30 });
  return (
    <>
      <div className="hv-charts">
        <section className="panel"><div className="hv-ch"><h2>운동 시간</h2><span className="muted">하루 합계 (분) · 최근 {range}일</span></div>
          <BarChart data={data} color="var(--viz-ex)" fmt={v => `${num(v)}분`} tickFmt={v => `${v}`} label="운동 시간 막대 그래프" /></section>
        <section className="panel"><div className="hv-ch"><h2>종류별 시간</h2><span className="muted">최근 {range}일</span></div>
          {types.length ? <ul className="fv-bars">{types.map(x => <li key={x.t}><span className="fv-bl">{x.t}</span><span className="fv-track"><i style={{ width: `${x.v / maxT * 100}%`, background: 'var(--viz-ex)' }} /></span><span className="fv-bv">{fmtDur(x.v)}</span></li>)}</ul> : <p className="muted">기록이 없습니다.</p>}</section>
      </div>
      <section className="panel">
        <div className="csum-h"><h2>운동 기록</h2><span className="muted">최근 기록 순</span></div>
        <ul className="hv-recent big">{[...health.workouts].sort((a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || ''))).slice(0, 12).map(w => (
          <li key={w.id}><span>{mds(w.date)}{w.time ? ` ${w.time}` : ''}</span><span className="grow"><b>{w.type}</b> {num(w.minutes)}분{w.km ? ` · ${w.km}km` : ''} · {num(w.kcal || 0)}kcal <SrcTag src={w.src} /></span>
            <button className="tl-del" onClick={() => del('workouts', w.id)}>삭제</button></li>))}</ul>
        <form className="lv-form" onSubmit={e => { e.preventDefault(); const minutes = Math.max(1, Number(f.minutes) || 0); add('workouts', { date: f.date, type: f.type, minutes, kcal: estimateKcal(f.type, minutes) }); }}>
          <input type="date" value={f.date} max={today} onChange={e => setF({ ...f, date: e.target.value })} aria-label="날짜" />
          <select value={f.type} onChange={e => setF({ ...f, type: e.target.value })} aria-label="종류">{[...new Set(['걷기', '달리기', ...WORKOUT_TYPES])].map(t => <option key={t}>{t}</option>)}</select>
          <label className="lv-min"><input type="number" min="1" value={f.minutes} onChange={e => setF({ ...f, minutes: e.target.value })} aria-label="시간(분)" />분</label>
          <button className="btn">직접 추가</button>
        </form>
      </section>
    </>
  );
}

/* ── 수면 */
function SleepTab({ byDay, health, today, setHealth, del }) {
  const data = byDay.map(x => ({ key: x.k, label: md(x.d), value: x.sleepMin, title: longDate(x.d), tip: x.sl ? [`${x.sl.bed} 취침 → ${x.sl.wake} 기상`, fmtDur(x.sleepMin)] : [] }));
  const got = byDay.filter(x => x.sl);
  const [f, setF] = useState({ date: today, bed: '23:30', wake: '07:00' });
  return (
    <>
      <div className="hv-charts">
        <section className="panel"><div className="hv-ch"><h2>수면 시간</h2><span className="muted">기상한 날 기준</span></div>
          <BarChart data={data} color="var(--viz-sl)" fmt={v => `${Math.round(v / 6) / 10}h`} tickFmt={v => `${v / 60}`} steps={[60, 120, 180, 240]} goal={health.goalSleep} goalLabel={`목표 ${Math.round(health.goalSleep / 6) / 10}h`} label="수면 시간 막대 그래프" /></section>
        <section className="panel"><div className="hv-ch"><h2>수면 요약</h2><span className="muted">선택한 기간</span></div>
          <ul className="sh-kv">
            <li><span>평균 수면</span><b>{got.length ? fmtDur(Math.round(got.reduce((a, x) => a + x.sleepMin, 0) / got.length)) : '-'}</b></li>
            <li><span>평균 취침 · 기상</span><b>{avgClock(got.map(x => x.sl.bed), true)} · {avgClock(got.map(x => x.sl.wake))}</b></li>
            <li><span>목표 달성</span><b>{got.filter(x => x.sleepMin >= health.goalSleep).length} / {got.length}일</b></li>
            <li><span>목표 수면</span><b><input type="number" min="4" max="12" step="0.5" value={health.goalSleep / 60} onChange={e => setHealth(h => ({ ...h, goalSleep: Math.max(240, Math.min(720, Math.round(Number(e.target.value) * 60) || 420)) }))} aria-label="목표 수면 시간" className="sh-goal" />시간</b></li>
          </ul></section>
      </div>
      <section className="panel">
        <div className="csum-h"><h2>수면 기록</h2></div>
        <ul className="hv-recent big">{[...health.sleep].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12).map(s => (
          <li key={s.id}><span>{mds(s.date)}</span><span className="grow">{s.bed} → {s.wake} · <b>{fmtDur(s.mins || sleepMinutes(s.bed, s.wake))}</b>{s.score ? ` · 점수 ${s.score}` : ''} <SrcTag src={s.src} /></span>
            <button className="tl-del" onClick={() => del('sleep', s.id)}>삭제</button></li>))}</ul>
        <form className="lv-form" onSubmit={e => { e.preventDefault(); setHealth(h => ({ ...h, sleep: [...h.sleep.filter(x => x.date !== f.date), { id: uid(), src: '직접 입력', ...f }] })); }}>
          <input type="date" value={f.date} max={today} onChange={e => setF({ ...f, date: e.target.value })} aria-label="기상한 날" />
          <label className="lv-min">취침<input type="time" value={f.bed} onChange={e => setF({ ...f, bed: e.target.value })} /></label>
          <label className="lv-min">기상<input type="time" value={f.wake} onChange={e => setF({ ...f, wake: e.target.value })} /></label>
          <button className="btn">직접 추가</button>
        </form>
      </section>
    </>
  );
}

/* ── 식단 */
function FoodTab({ byDay, health, today, add, del, setHealth }) {
  const data = byDay.map(x => ({ key: x.k, label: md(x.d), value: x.food, title: longDate(x.d), tip: MEALS.map(m => { const v = x.ml.filter(y => y.meal === m).reduce((a, y) => a + (y.kcal || 0), 0); return v ? `${m} ${num(v)}kcal` : null; }).filter(Boolean) }));
  const [day, setDay] = useState(today);
  const list = health.meals.filter(m => m.date === day);
  const total = list.reduce((a, m) => a + (m.kcal || 0), 0);
  const [f, setF] = useState({ meal: '점심', name: '', kcal: '' });
  return (
    <div className="hv-charts">
      <section className="panel"><div className="hv-ch"><h2>하루 섭취 칼로리</h2><span className="muted">kcal</span></div>
        <BarChart data={data} color="var(--viz-ex)" fmt={v => `${num(v)}`} tickFmt={v => num(v)} goal={health.goalKcal} goalLabel={`목표 ${num(health.goalKcal)}`} label="하루 섭취 칼로리 막대 그래프" /></section>
      <section className="panel">
        <div className="hv-ch"><h2>끼니별 식단</h2>
          <input type="date" value={day} max={today} onChange={e => setDay(e.target.value || today)} aria-label="식단 날짜" className="jv-date" /></div>
        <p className="sh-total">합계 <b>{num(total)}kcal</b> / 목표 <input type="number" min="800" step="100" value={health.goalKcal} onChange={e => setHealth(h => ({ ...h, goalKcal: Math.max(800, Number(e.target.value) || 2000) }))} aria-label="목표 칼로리" className="sh-goal" />kcal</p>
        {MEALS.map(m => { const ms = list.filter(x => x.meal === m); return (
          <div key={m} className="sh-meal"><div className="sh-meal-h"><b>{m}</b><span className="muted">{num(ms.reduce((a, x) => a + (x.kcal || 0), 0))}kcal</span></div>
            {ms.length ? <ul>{ms.map(x => <li key={x.id}><span className="grow">{x.name} <SrcTag src={x.src} /></span><span className="muted">{num(x.kcal || 0)}kcal</span><button className="tl-del" onClick={() => del('meals', x.id)}>삭제</button></li>)}</ul> : <p className="muted sh-none">기록 없음</p>}
          </div>); })}
        <form className="lv-form" onSubmit={e => { e.preventDefault(); if (!f.name.trim()) return; add('meals', { date: day, meal: f.meal, name: f.name.trim(), kcal: Math.max(0, Number(f.kcal) || 0) }); setF({ ...f, name: '', kcal: '' }); }}>
          <select value={f.meal} onChange={e => setF({ ...f, meal: e.target.value })} aria-label="끼니">{MEALS.map(m => <option key={m}>{m}</option>)}</select>
          <input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="음식" aria-label="음식" className="wide" />
          <label className="lv-min"><input type="number" min="0" value={f.kcal} onChange={e => setF({ ...f, kcal: e.target.value })} aria-label="칼로리" />kcal</label>
          <button className="btn" disabled={!f.name.trim()}>직접 추가</button>
        </form>
      </section>
    </div>
  );
}

/* ── 병원 진찰 (삼성 헬스에는 없어서 직접 기록) */
function VisitTab({ health, today, add, del }) {
  const blank = { date: today, hospital: '', dept: '', note: '', rx: '', next: '' };
  const [f, setF] = useState(blank);
  const upcoming = health.visits.filter(v => v.next && v.next >= today).sort((a, b) => a.next.localeCompare(b.next));
  return (
    <>
      <section className="panel">
        <div className="csum-h"><h2>다음 진찰 예약</h2><span className="muted">{upcoming.length}건</span></div>
        {upcoming.length ? <ul className="tv-up">{upcoming.map(v => { const d = dayDiff(today, v.next); return (
          <li key={v.id} className={d <= 3 ? 'hot' : ''}><b className="tv-dd">{d === 0 ? '오늘' : `D-${d}`}</b><span className="grow"><b>{v.hospital}</b><small className="muted"> · {v.dept} · {mds(v.next)} · 지난 진찰: {v.note || '-'}</small></span></li>); })}</ul>
          : <p className="muted">예정된 진찰이 없습니다.</p>}
      </section>
      <section className="panel">
        <div className="csum-h"><h2>진찰 기록</h2><span className="muted">{health.visits.length}건 · 삼성 헬스에는 진찰 기록이 없어 직접 입력합니다</span></div>
        <div className="tablewrap"><table className="prog tv-table">
          <thead><tr><th>날짜</th><th>병원</th><th>진료과</th><th>진단·메모</th><th>처방</th><th>다음 예약</th><th /></tr></thead>
          <tbody>{[...health.visits].sort((a, b) => b.date.localeCompare(a.date)).map(v => (
            <tr key={v.id}><td>{mds(v.date)}</td><td><b>{v.hospital}</b></td><td>{v.dept || '-'}</td><td>{v.note || '-'}</td><td>{v.rx || '-'}</td><td>{v.next ? mds(v.next) : '-'}</td>
              <td><button className="tl-del" onClick={() => del('visits', v.id)}>삭제</button></td></tr>))}</tbody>
        </table></div>
        <form className="tv-add" onSubmit={e => { e.preventDefault(); if (!f.hospital.trim()) return; add('visits', { ...f, hospital: f.hospital.trim() }); setF(blank); }}>
          <label className="tv-f"><span>날짜</span><input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></label>
          <label className="tv-f"><span>병원 *</span><input value={f.hospital} onChange={e => setF({ ...f, hospital: e.target.value })} /></label>
          <label className="tv-f"><span>진료과</span><input value={f.dept} onChange={e => setF({ ...f, dept: e.target.value })} placeholder="예: 내과" /></label>
          <label className="tv-f wide"><span>진단·메모</span><input value={f.note} onChange={e => setF({ ...f, note: e.target.value })} /></label>
          <label className="tv-f"><span>처방</span><input value={f.rx} onChange={e => setF({ ...f, rx: e.target.value })} /></label>
          <label className="tv-f"><span>다음 예약</span><input type="date" value={f.next} onChange={e => setF({ ...f, next: e.target.value })} /></label>
          <button className="btn primary" disabled={!f.hospital.trim()}>추가</button>
        </form>
      </section>
    </>
  );
}
