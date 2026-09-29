import React, { useState } from 'react';
import { AREAS, ROWS, iso } from '../data.js';
import { ActionRow, WEEK, areaVar, num, useCtx } from '../shared.jsx';
import BarChart from './BarChart.jsx';

/* 학습 대시보드 (개인 › 자기계발/학습, 근로 › 직무 학습 공통)
   study['영역|카테고리'] = {
     subjects: [{ id, name, target(목표 시간) }], dailyGoal(분),
     logs: [{ id, date, subject, minutes, memo }],
     cards: [{ id, subject, q, a, box(0~3), next(다음 복습일) }],
   } */
const uid = () => Math.random().toString(36).slice(2, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const md = s => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
const hm = m => (m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${m}분`);
const GAP = [1, 3, 7, 14];                                  // 맞힐 때마다 다음 복습까지 늘어나는 날 수

const PRESETS = {
  'P|자기계발/학습': {
    acts: { time: '공부 시간 기록', note: '공부 내용 기록' },
    subjects: [['영어 (예시)', 120], ['독서 (예시)', 60], ['코딩 (예시)', 80]],
    cards: [['영어 (예시)', 'reluctant', '꺼리는, 마지못한'], ['영어 (예시)', 'be supposed to', '~하기로 되어 있다'], ['영어 (예시)', 'take for granted', '당연하게 여기다'], ['코딩 (예시)', 'Array.map 은 무엇을 돌려주나?', '각 요소를 바꾼 새 배열']],
    memos: ['단어 30개 암기', '문법: 가정법', '책 40쪽', '리액트 상태 관리', '듣기 연습', '모의고사 1회'],
  },
  'W|직무 학습': {
    acts: { time: '학습 시간 기록', note: '학습 내용 기록' },
    subjects: [['데이터 분석 (예시)', 60], ['자격증 준비 (예시)', 100], ['사내 교육 (예시)', 20]],
    cards: [['데이터 분석 (예시)', 'GROUP BY 와 HAVING 의 차이', 'WHERE 는 묶기 전, HAVING 은 묶은 뒤 조건'], ['자격증 준비 (예시)', 'WBS 란?', '작업을 계층으로 나눈 구조'], ['자격증 준비 (예시)', '임계 경로(CPM)', '여유 시간이 0인 가장 긴 경로']],
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
  const cards = P.cards.map(([subject, q, a], i) => ({ id: `c${i}`, subject, q, a, box: i % 2, next: addDays(t, i < 2 ? 0 : i) }));
  return { subjects, dailyGoal: 30, logs, cards };
}

export default function StudyView({ area, cat, group }) {
  const { store, setStore, now, isDone, finish } = useCtx();
  const today = iso(now), key = `${area}|${cat}`, P = PRESETS[key];
  const S = store.study?.[key] || seedStudy(key, now);
  const set = fn => setStore(s => ({ ...s, study: { ...(s.study || {}), [key]: fn(s.study?.[key] || seedStudy(key, now)) } }));
  const tick = (name, memo) => { const row = ROWS.find(r => r.a === area && r.cat === cat && r.action === name); if (row && !isDone(row)) finish(row, { t: '없음', memo }); };

  // 통계
  const minsOn = d => S.logs.filter(l => l.date === d).reduce((a, l) => a + l.minutes, 0);
  const todayMin = minsOn(today);
  const monday = (() => { const d = new Date(today + 'T00:00:00'); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); })();
  const weekMin = S.logs.filter(l => l.date >= monday && l.date <= today).reduce((a, l) => a + l.minutes, 0);
  let streak = 0;
  for (let d = minsOn(today) ? today : addDays(today, -1); minsOn(d) > 0; d = addDays(d, -1)) streak++;
  const due = S.cards.filter(c => c.next <= today);

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
    if (f.date === today) { tick(P.acts.time, `${f.subject} ${minutes}분`); if (f.memo.trim()) tick(P.acts.note, f.memo.trim()); }
    setF({ ...f, memo: '' });
  };
  const [sf, setSf] = useState({ name: '', target: 50 });
  const addSubject = e => { e.preventDefault(); if (!sf.name.trim()) return; set(x => ({ ...x, subjects: [...x.subjects, { id: uid(), name: sf.name.trim(), target: Math.max(1, Number(sf.target) || 1) }] })); setSf({ name: '', target: 50 }); };

  // 복습 카드
  const [flip, setFlip] = useState(false);
  const card = due[0];
  const answer = ok => {
    set(x => ({ ...x, cards: x.cards.map(c => (c.id === card.id ? { ...c, box: ok ? Math.min(3, c.box + 1) : 0, next: addDays(today, ok ? GAP[Math.min(3, c.box + 1)] : 1) } : c)) }));
    setFlip(false);
  };
  const [cf, setCf] = useState({ q: '', a: '' });
  const addCard = e => { e.preventDefault(); if (!cf.q.trim() || !cf.a.trim()) return; set(x => ({ ...x, cards: [...x.cards, { id: uid(), subject: f.subject, q: cf.q.trim(), a: cf.a.trim(), box: 0, next: today }] })); setCf({ q: '', a: '' }); };
  const items = group.items.map(it => ({ it, rows: group.rows.filter(r => r.item === it) }));

  return (
    <div className="catv sv" style={{ '--ac': areaVar(area) }}>
      <header className="page-h">
        <h1 className="area-title">{cat}</h1>
        <p>{AREAS[area].n} · 공부 시간과 과목별 진도를 한눈에 보고, 복습 카드로 배운 내용을 다시 확인합니다.</p>
      </header>

      <div className="hv-stats">
        <div className={`hv-stat ${todayMin >= S.dailyGoal ? 'ex' : 'sl'}`}><span className="muted">오늘 공부</span><b>{hm(todayMin)}</b>
          <span className="pbar"><i style={{ width: `${Math.min(100, todayMin / S.dailyGoal * 100)}%`, background: 'var(--viz-ex)' }} /></span></div>
        <div className="hv-stat sl"><span className="muted">이번 주</span><b>{hm(weekMin)}</b><span className="hv-sub">하루 목표 {S.dailyGoal}분 × 7 = {hm(S.dailyGoal * 7)}</span></div>
        <div className="hv-stat sl"><span className="muted">연속 공부</span><b>{streak}일</b><span className="hv-sub">{todayMin ? '오늘 기록함' : '오늘 아직 기록 없음'}</span></div>
        <div className={`hv-stat ${due.length ? 'over' : 'ex'}`}><span className="muted">오늘 복습할 카드</span><b>{due.length}장</b><span className="hv-sub">전체 {S.cards.length}장</span></div>
      </div>

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

      <div className="sv-grid">
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
              <button className="tl-del" onClick={() => set(x => ({ ...x, logs: x.logs.filter(k => k.id !== l.id) }))}>삭제</button></li>))}</ul>
          <p className="note">오늘 기록을 넣으면 "{P.acts.time}", 내용을 적으면 "{P.acts.note}"이 체크됩니다.</p>
        </section>

        <section className="panel">
          <div className="csum-h"><h2>복습 카드</h2><span className="muted">맞히면 1·3·7·14일 뒤에 다시 나옵니다</span></div>
          {card ? (
            <div className="sv-card">
              <span className="tag">{card.subject}</span>
              <p className="sv-q">{card.q}</p>
              {flip ? <>
                <p className="sv-a">{card.a}</p>
                <div className="btns"><button className="btn" onClick={() => answer(false)}>몰랐음 (내일 다시)</button><button className="btn primary" onClick={() => answer(true)}>알았음</button></div>
              </> : <button className="btn primary" onClick={() => setFlip(true)}>정답 보기</button>}
              <small className="muted">남은 카드 {due.length}장</small>
            </div>
          ) : <p className="muted sv-done">오늘 복습할 카드를 모두 끝냈습니다.</p>}
          <form className="lv-form" onSubmit={addCard}>
            <input value={cf.q} onChange={e => setCf({ ...cf, q: e.target.value })} placeholder="질문 (예: 단어)" aria-label="카드 질문" className="wide" />
            <input value={cf.a} onChange={e => setCf({ ...cf, a: e.target.value })} placeholder="정답" aria-label="카드 정답" className="wide" />
            <button className="btn" disabled={!cf.q.trim() || !cf.a.trim()}>카드 추가</button>
          </form>
        </section>
      </div>

      <h2 className="hv-sec">{cat} 체크 항목</h2>
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
