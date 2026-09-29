import React, { useState } from 'react';
import { AREAS, iso } from '../data.js';
import { WEEK, areaVar, num, useCtx } from '../shared.jsx';
import BarChart from './BarChart.jsx';

/* 학습 대시보드 (개인 › 자기계발/학습, 근로 › 직무 학습 공통)
   study['영역|카테고리'] = {
     subjects: [{ id, name, target(목표 시간) }], dailyGoal(분),
     logs: [{ id, date, subject, minutes, memo }],
   }
   개인 › 자기계발/학습은 LearnHubView(영어·독서·기타 앱 연동 카드) 아래에 embedded 로 붙고,
   연동 앱에서 가져온 기록(store.learn[*].data.sessions)도 공부 시간·진도·기록에 함께 계산한다 */
const uid = () => Math.random().toString(36).slice(2, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const md = s => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
const hm = m => (m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${m}분`);

const PRESETS = {
  'P|자기계발/학습': {
    acts: { time: '공부 시간 기록', note: '공부 내용 기록' },
    subjects: [['영어', 120], ['IT', 100], ['자격증', 80]],
    memos: ['단어 30개 암기', '리액트 강의 1강', '기출 20문항', '듣기 연습', '코딩 테스트 2문제', '이론 1장 정리'],
  },
  'W|직무 학습': {
    acts: { time: '학습 시간 기록', note: '학습 내용 기록' },
    subjects: [['데이터 분석 (예시)', 60], ['자격증 준비 (예시)', 100], ['사내 교육 (예시)', 20]],
    memos: ['SQL 조인 복습', '기출 20문항', '사내 교육 1강', '대시보드 실습', '이론 2장'],
  },
};

export function seedStudy(key, today = new Date()) {
  const P = PRESETS[key], t = iso(today);
  const subjects = P.subjects.map(([name, target], i) => ({ id: `s${i}`, name, target }));
  const logs = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 1; i <= 30; i++) {
    if (rnd() < 0.3) continue;
    const s = subjects[Math.floor(rnd() * subjects.length)];
    logs.push({ id: `l${i}`, date: addDays(t, -i), subject: s.name, minutes: 20 + Math.round(rnd() * 5) * 10, memo: `${P.memos[i % P.memos.length]} (예시)` });
  }
  return { subjects, dailyGoal: 30, logs };
}

/** 연동 앱 기록 → 공부 기록 형태 (과목은 앱 이름과 같은 이름으로 시작하는 과목에 붙임) */
export function appLogs(learn, subjects, apps) {
  return apps.flatMap(({ key: k, name }) => {
    const sub = subjects.find(s => s.name.startsWith(name))?.name || name;
    return (learn?.[k]?.data?.sessions || []).map((x, i) => ({ id: `app-${k}-${i}`, date: x.date, subject: sub, minutes: x.minutes, memo: x.title, app: true }));
  });
}

export default function StudyView({ area, cat, embedded, apps }) {
  const { store, setStore, now } = useCtx();
  const today = iso(now), key = `${area}|${cat}`;
  const raw = store.study?.[key] || seedStudy(key, now);
  // 연동 앱 기록을 가져왔으면 예시 기록은 빼고 계산
  const fromApps = apps ? appLogs(store.learn, raw.subjects, apps) : [];
  const S = { ...raw, logs: [...(fromApps.length ? raw.logs.filter(l => !/\(예시\)$/.test(l.memo || '')) : raw.logs), ...fromApps] };
  const set = fn => setStore(s => ({ ...s, study: { ...(s.study || {}), [key]: fn(s.study?.[key] || seedStudy(key, now)) } }));

  const minsOn = d => S.logs.filter(l => l.date === d).reduce((a, l) => a + l.minutes, 0);

  const chart = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13)).map(d => ({
    key: d, label: md(d), title: `${md(d)} (${WEEK[new Date(d + 'T00:00:00').getDay()]})`, value: minsOn(d),
    tip: S.logs.filter(l => l.date === d).map(l => `${l.subject} ${l.minutes}분`),
  }));

  // 기록
  const [f, setF] = useState({ date: today, subject: S.subjects[0]?.name || '', minutes: 30, memo: '' });
  const addLog = e => {
    e.preventDefault();
    const minutes = Math.max(1, Number(f.minutes) || 0);
    if (!f.subject) return;
    set(x => ({ ...x, logs: [{ id: uid(), date: f.date, subject: f.subject, minutes, memo: f.memo.trim() }, ...x.logs] }));
    setF({ ...f, memo: '' });
  };
  const [sf, setSf] = useState({ name: '', target: 50 });
  const addSubject = e => { e.preventDefault(); if (!sf.name.trim()) return; set(x => ({ ...x, subjects: [...x.subjects, { id: uid(), name: sf.name.trim(), target: Math.max(1, Number(sf.target) || 1) }] })); setSf({ name: '', target: 50 }); };

  return (
    <div className={`catv sv ${embedded ? 'embedded' : ''}`} style={{ '--ac': areaVar(area) }}>
      {!embedded && <header className="page-h">
        <h1 className="area-title">{cat}</h1>
        <p>{AREAS[area].n} · 공부 시간, 과목별 진도, 공부 기록을 한눈에 봅니다.</p>
      </header>}

      <div className="sv-grid">
        <section className="panel">
          <div className="hv-ch"><h2>공부 시간</h2><span className="muted">최근 14일 · 하루 목표
            <input type="number" min="5" step="5" value={S.dailyGoal} onChange={e => set(x => ({ ...x, dailyGoal: Math.max(5, Number(e.target.value) || 30) }))} aria-label="하루 목표(분)" className="sv-goal" />분</span></div>
          <BarChart data={chart} color="var(--viz-ex)" fmt={v => `${v}분`} tickFmt={v => `${v}`} goal={S.dailyGoal} goalLabel={`목표 ${S.dailyGoal}분`} label="최근 14일 공부 시간" height={210} />
        </section>
        <section className="panel">
          <div className="hv-ch"><h2>과목별 진도</h2><span className="muted">누적 시간 / 목표 시간</span></div>
          <ul className="tv-prog">{S.subjects.map(s => { const m = S.logs.filter(l => l.subject === s.name).reduce((a, l) => a + l.minutes, 0), p = Math.round(m / 60 / s.target * 100); return (
            <li key={s.id}><span className="tv-pn">{s.name}</span><span className="fv-track"><i style={{ width: `${Math.min(100, p)}%`, background: p >= 100 ? 'var(--ok)' : 'var(--viz-ex)' }} /></span>
              <span className="tv-pv">{Math.round(m / 6) / 10} / {num(s.target)}시간 <b>{p}%</b></span></li>); })}</ul>
          <form className="lv-form" onSubmit={addSubject}>
            <input value={sf.name} onChange={e => setSf({ ...sf, name: e.target.value })} placeholder="새 과목" aria-label="새 과목" className="wide" />
            <label className="lv-min"><input type="number" min="1" value={sf.target} onChange={e => setSf({ ...sf, target: e.target.value })} aria-label="목표 시간" />시간</label>
            <button className="btn" disabled={!sf.name.trim()}>과목 추가</button>
          </form>
        </section>
      </div>

      <div>
        <section className="panel">
          <div className="csum-h"><h2>공부 기록</h2><span className="muted">{S.logs.length}회</span></div>
          <form className="lv-form" onSubmit={addLog}>
            <input type="date" value={f.date} max={today} onChange={e => setF({ ...f, date: e.target.value })} aria-label="날짜" />
            <select value={f.subject} onChange={e => setF({ ...f, subject: e.target.value })} aria-label="과목">{S.subjects.map(s => <option key={s.id}>{s.name}</option>)}</select>
            <label className="lv-min"><input type="number" min="5" step="5" value={f.minutes} onChange={e => setF({ ...f, minutes: e.target.value })} aria-label="시간(분)" />분</label>
            <input value={f.memo} onChange={e => setF({ ...f, memo: e.target.value })} placeholder="공부한 내용" aria-label="공부한 내용" className="wide" />
            <button className="btn primary">기록</button>
          </form>
          <ul className="lv-simple">{[...S.logs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10).map(l => (
            <li key={l.id}><time>{md(l.date)}</time><span className="tag">{l.subject}</span><span className="grow">{hm(l.minutes)}{l.memo ? ` · ${l.memo}` : ''}</span>
              {l.app ? <span className="muted sv-app">앱 연동</span> : <button className="tl-del" onClick={() => set(x => ({ ...x, logs: x.logs.filter(k => k.id !== l.id) }))}>삭제</button>}</li>))}</ul>
        </section>
      </div>

    </div>
  );
}
