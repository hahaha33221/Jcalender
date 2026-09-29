import React from 'react';
import { AREAS, iso } from '../data.js';
import { WEEK, areaVar, num, useCtx } from '../shared.jsx';
import BarChart from './BarChart.jsx';
import { AppCards, LEISURE_APPS } from './LearnHubView.jsx';

/* 개인 › 여가 관리 대시보드: 여행 · 독서 · 기타 · 밴드 합주
   - 이 화면에서는 따로 입력하지 않는다. 직접 만든 앱이 API(JSON)로 보낸 정보만 받아 요약해서 보여준다
     (카드: LearnHubView 의 AppCards, 데이터: store.learn.trip|reading|guitar|band.data, 형식: docs/learning-app-integration.md)
   - 요약: 최근 14일 여가 시간, 이번 달 활동별 시간, 다가오는 여행
   - 목표 · 연간 일정표 · 마일스톤은 카테고리 화면(GoalBoard)이 아래에 붙인다
   store.leisure 는 예전 직접 입력 데이터(예시)로, 지금 화면에서는 쓰지 않는다 */
const KIND = { reading: '독서', guitar: '기타 연습', band: '밴드 합주' };
const KIND_COLOR = { '독서': 'var(--a3)', '기타 연습': 'var(--viz-ex)', '밴드 합주': 'var(--viz-sl)' };
const dayDiff = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);
const md = s => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const hm = m => (m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${m}분`);

export function seedLeisure(today = new Date()) {
  const d = n => iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + n));
  const y = today.getFullYear();
  return {
    trips: [
      { id: 't1', name: '제주 3박 4일 (예시)', start: d(17), end: d(20), budget: 800000, spent: 320000 },
      { id: 't2', name: '강릉 1박 2일 (예시)', start: `${y}-04-11`, end: `${y}-04-12`, budget: 300000, spent: 284000 },
    ],
    books: [
      { id: 'b1', title: '아주 작은 습관의 힘 (예시)', author: '제임스 클리어', pages: 360, read: 360, done: `${y}-02-20` },
      { id: 'b2', title: '사피엔스 (예시)', author: '유발 하라리', pages: 636, read: 636, done: `${y}-05-30` },
      { id: 'b3', title: '돈의 심리학 (예시)', author: '모건 하우절', pages: 404, read: 404, done: `${y}-08-14` },
      { id: 'b4', title: '불편한 편의점 (예시)', author: '김호연', pages: 268, read: 142 },
      { id: 'b5', title: '데일 카네기 인간관계론 (예시)', author: '데일 카네기', pages: 332, read: 0, want: true },
    ],
    bookGoal: 12,
    logs: [
      { id: 'l1', date: d(-1), kind: '기타 연습', minutes: 40, memo: '코드 전환 연습' },
      { id: 'l2', date: d(-3), kind: '밴드 합주', minutes: 120, memo: '공연곡 2곡 합주' },
      { id: 'l3', date: d(-6), kind: '기타 연습', minutes: 30, memo: '' },
      { id: 'l4', date: d(-10), kind: '밴드 합주', minutes: 120, memo: '' },
      { id: 'l5', date: d(-4), kind: '독서', minutes: 40, memo: '불편한 편의점 60쪽' },
      { id: 'l6', date: d(-8), kind: '기타 연습', minutes: 30, memo: '스트로크 연습' },
    ],
  };
}

export default function LeisureView({ area, cat }) {
  const { store, now } = useCtx();
  const today = iso(now), month = today.slice(0, 7);
  const learn = store.learn || {};
  const logs = Object.entries(KIND).flatMap(([k, kind]) => (learn[k]?.data?.sessions || []).map(x => ({ ...x, kind })));
  const trips = [...(learn.trip?.data?.trips || [])].sort((a, b) => a.start.localeCompare(b.start));
  const upcoming = trips.filter(t => t.end >= today);
  const linked = LEISURE_APPS.filter(a => learn[a.key]?.data).length;

  const monthLogs = logs.filter(l => l.date.slice(0, 7) === month);
  const byKind = Object.values(KIND).map(k => ({ k, v: monthLogs.filter(l => l.kind === k).reduce((a, l) => a + l.minutes, 0), n: monthLogs.filter(l => l.kind === k).length }));
  const maxKind = Math.max(1, ...byKind.map(x => x.v));
  const chart = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13)).map(d => ({
    key: d, label: md(d), title: `${md(d)} (${WEEK[new Date(d + 'T00:00:00').getDay()]})`,
    value: logs.filter(l => l.date === d).reduce((a, l) => a + l.minutes, 0),
    tip: logs.filter(l => l.date === d).map(l => `${l.kind} ${l.minutes}분`),
  }));

  return (
    <div className="catv lsv" style={{ '--ac': areaVar(area) }}>
      <header className="page-h">
        <h1 className="area-title">{cat}</h1>
        <p>{AREAS[area].n} · 여행 · 독서 · 기타 · 밴드 합주 앱에서 받은 정보를 요약해 보여줍니다. 기록은 각 앱에서 하고, 여기서는 연동 설정과 요약만 봅니다.</p>
      </header>

      <AppCards apps={LEISURE_APPS} />

      {!linked && <p className="panel muted lsv-empty">아직 연동된 앱이 없습니다. 위 카드의 연동 설정에서 데이터 주소를 넣거나 JSON 파일을 불러오면 요약이 보입니다.</p>}

      <div className="sv-grid">
        <section className="panel">
          <div className="hv-ch"><h2>여가 시간</h2><span className="muted">최근 14일 · 독서 · 기타 · 밴드 합주 앱 합계</span></div>
          <BarChart data={chart} color="var(--viz-ex)" fmt={v => hm(v)} tickFmt={v => `${v}분`} label="최근 14일 여가 시간" height={210} />
        </section>
        <section className="panel">
          <div className="hv-ch"><h2>이번 달 활동별 시간</h2><span className="muted">{hm(monthLogs.reduce((a, l) => a + l.minutes, 0))} · {monthLogs.length}회</span></div>
          <ul className="fv-bars">{byKind.map(x => (
            <li key={x.k}><span className="fv-bl">{x.k}</span><span className="fv-track"><i style={{ width: `${x.v / maxKind * 100}%`, background: KIND_COLOR[x.k] }} /></span><span className="fv-bv">{x.v ? `${hm(x.v)} · ${x.n}회` : '-'}</span></li>))}</ul>
        </section>
      </div>

      <section className="panel">
        <div className="hv-ch"><h2>다가오는 여행</h2><span className="muted">여행 앱 · {upcoming.length}건</span></div>
        {upcoming.length ? (
          <ul className="lsv-trips">{upcoming.map((t, i) => {
            const ratio = t.budget ? t.spent / t.budget : 0;
            return (
              <li key={i}>
                <b className="lsv-dd">{t.start <= today ? '여행 중' : `D-${dayDiff(today, t.start)}`}</b>
                <span className="lsv-tn"><b>{t.name}</b><small>{md(t.start)} ~ {md(t.end)} · {dayDiff(t.start, t.end)}박 {dayDiff(t.start, t.end) + 1}일</small></span>
                <span className="lsv-cost"><small>{num(t.spent)} / {num(t.budget)}원</small>
                  <span className="pbar"><i style={{ width: `${Math.min(100, ratio * 100)}%`, background: ratio > 1 ? 'var(--over)' : 'var(--viz-sl)' }} /></span></span>
              </li>
            );
          })}</ul>
        ) : <p className="muted">{learn.trip?.data ? '예정된 여행이 없습니다.' : '여행 앱을 연동하면 다가오는 여행이 보입니다.'}</p>}
      </section>
    </div>
  );
}
