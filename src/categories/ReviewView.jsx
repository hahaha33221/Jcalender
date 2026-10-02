import React, { useState } from 'react';
import { ROWS, iso, periodKey } from '../data.js';
import { WEEK, areaVar, num, useCtx } from '../shared.jsx';
import { sleepMinutes } from './health.js';
import { DEFAULT_REMIND, remindOf, upcomingJournal, whenText } from '../reminders.js';
import { showOsNotification } from '../notify.js';

/* 개인 › 저널링 전용 화면
   journal = {
     entries: [{ id, date, mood(1~5), text, tags: [] }],            하루 하나
     reviews: [{ id, week('2026-W40'), keep, problem, tryNext, saved }], 한 주 하나
     remind:  알림 설정 (reminders.js)
   } */
export const MOODS = ['', '매우 나쁨', '나쁨', '보통', '좋음', '매우 좋음'];
const uid = () => Math.random().toString(36).slice(2, 10);
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const md = s => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
const mdw = s => `${md(s)} (${WEEK[new Date(s + 'T00:00:00').getDay()]})`;
const ACT_REVIEW = ROWS.find(r => r.a === 'P' && r.action === '한 주 돌아보고 적기');

/** 날짜가 속한 주의 월요일 */
const monday = s => { const d = new Date(s + 'T00:00:00'); const k = (d.getDay() + 6) % 7; d.setDate(d.getDate() - k); return iso(d); };
const weekOf = s => periodKey('W', new Date(s + 'T00:00:00'));

export function seedJournal(today = new Date()) {
  const t = iso(today);
  const texts = [
    ['아침 러닝 후 기분이 상쾌했다. 오후 회의가 길어져 피곤.', 4, ['운동']],
    ['친구와 저녁. 오랜만에 웃었다.', 5, ['친구']],
    ['업무 마감이 겹쳐 정신없었다. 일찍 자야겠다.', 2, ['일']],
    ['책 50쪽 읽음. 조용한 하루.', 3, ['독서']],
    ['합주 연습. 새 곡이 조금씩 맞아 간다.', 4, ['취미']],
    ['잠을 설쳐서 하루 종일 멍했다.', 2, ['수면']],
    ['가계부 정리하고 이번 달 지출을 점검했다.', 3, ['재무']],
    ['어머니와 통화. 생신 계획 이야기.', 4, ['가족']],
    ['운동 쉬는 날. 산책만 30분.', 3, ['운동']],
    ['프로젝트 1차 결과 공유, 반응이 좋았다.', 5, ['일']],
    ['비가 와서 집에서 쉬었다.', 3, []],
    ['주간 계획을 세우고 할일을 정리했다.', 4, ['계획']],
    ['피곤했지만 할 일은 다 끝냈다.', 3, ['일']],
    ['아침 루틴을 지켰다. 뿌듯.', 4, ['루틴']],
  ];
  const entries = [];
  let k = 0;
  for (let i = 1; i <= 20 && k < texts.length; i++) {
    if (i % 4 === 0 || i === 7) continue;                      // 가끔 빠진 날
    const [text, mood, tags] = texts[k++];
    entries.push({ id: `j${i}`, date: addDays(t, -i), mood, text: `${text} (예시)`, tags });
  }
  const w1 = weekOf(addDays(t, -7)), w2 = weekOf(addDays(t, -14));
  return {
    entries,
    reviews: [
      { id: 'r1', week: w1, keep: '운동 3회 유지, 계획한 일 대부분 완료 (예시)', problem: '수면이 부족했다, 회의가 많아 집중 시간이 적었다', tryNext: '23시 전 취침, 오전 2시간 집중 시간 확보', saved: addDays(t, -2) },
      { id: 'r2', week: w2, keep: '가계부 정리, 친구와 만남 (예시)', problem: '외식비 지출이 많았다', tryNext: '평일 도시락 3회', saved: addDays(t, -9) },
    ],
  };
}

export default function ReviewView({ area, cat, group }) {
  const { store, setStore, now, isDone, finish } = useCtx();
  const today = iso(now);
  const J = store.journal || seedJournal(now);
  const set = fn => setStore(s => ({ ...s, journal: fn(s.journal || seedJournal(now)) }));

  // ── 일기
  const [day, setDay] = useState(today);
  const cur = J.entries.find(e => e.date === day);
  const [draft, setDraft] = useState(null);                 // 편집 중인 값 (null 이면 저장된 값 표시)
  const view = draft && draft.date === day ? draft : { date: day, mood: cur?.mood || 0, text: cur?.text || '', tags: (cur?.tags || []).join(', ') };
  const edit = patch => setDraft({ ...view, ...patch });
  const saveEntry = () => {
    if (!view.text.trim() && !view.mood) return;
    const tags = view.tags.split(',').map(x => x.trim()).filter(Boolean);
    set(x => ({ ...x, entries: [...x.entries.filter(e => e.date !== day), { id: cur?.id || uid(), date: day, mood: view.mood || 3, text: view.text.trim(), tags }] }));
    setDraft(null);
  };

  // 통계
  const month = today.slice(0, 7);
  const monthEntries = J.entries.filter(e => e.date.slice(0, 7) === month);
  const moodAvg = monthEntries.length ? (monthEntries.reduce((a, e) => a + e.mood, 0) / monthEntries.length) : 0;
  const has = new Set(J.entries.map(e => e.date));
  let streak = 0;
  for (let d = has.has(today) ? today : addDays(today, -1); has.has(d); d = addDays(d, -1)) streak++;

  // 최근 35일 기분 달력 (월요일부터 5주)
  const start = addDays(monday(today), -28);
  const cells = Array.from({ length: 35 }, (_, i) => addDays(start, i));
  const moodOf = d => J.entries.find(e => e.date === d)?.mood || 0;

  // ── 주간 회고
  const thisWeek = weekOf(today);
  const [week, setWeek] = useState(thisWeek);
  const wStart = (() => { for (let i = 0; i < 400; i++) { const d = addDays(monday(today), -7 * i); if (weekOf(d) === week) return d; } return monday(today); })();
  const wEnd = addDays(wStart, 6);
  const inWeek = d => d >= wStart && d <= wEnd;
  const saved = J.reviews.find(r => r.week === week);
  const [rv, setRv] = useState(null);
  const rview = rv && rv.week === week ? rv : { week, keep: saved?.keep || '', problem: saved?.problem || '', tryNext: saved?.tryNext || '' };
  const editRv = patch => setRv({ ...rview, ...patch });

  /** 앱에 쌓인 이번 주 기록으로 회고 초안을 만든다 */
  const autoDraft = () => {
    const doneCnt = Object.values(store.done || {}).filter(v => v?.at && inWeek(v.at.slice(0, 10))).length;
    const ws = (store.health?.workouts || []).filter(w => inWeek(w.date));
    const sl = (store.health?.sleep || []).filter(s => inWeek(s.date));
    const slAvg = sl.length ? Math.round(sl.reduce((a, s) => a + sleepMinutes(s.bed, s.wake), 0) / sl.length) : 0;
    const exp = (store.finance?.expenses || []).filter(e => inWeek(e.date)).reduce((a, e) => a + e.amount, 0);
    const notes = (store.people || []).flatMap(p => p.notes.filter(n => inWeek(n.date)).map(() => p.name));
    const je = J.entries.filter(e => inWeek(e.date));
    const jm = je.length ? (je.reduce((a, e) => a + e.mood, 0) / je.length).toFixed(1) : '-';
    const keep = [
      doneCnt ? `체크 항목 ${num(doneCnt)}개 완료` : '',
      ws.length ? `운동 ${ws.length}회 (총 ${num(ws.reduce((a, w) => a + w.minutes, 0))}분)` : '',
      je.length ? `일기 ${je.length}일 작성, 평균 기분 ${jm}` : '',
      notes.length ? `${[...new Set(notes)].join(', ')}와(과) 연락` : '',
    ].filter(Boolean).join('\n');
    const problem = [
      !ws.length ? '운동을 하지 못했다' : ws.length < 3 ? `운동이 ${ws.length}회로 목표(3회)보다 적었다` : '',
      slAvg && slAvg < (store.health?.goalSleep || 420) ? `평균 수면 ${Math.floor(slAvg / 60)}시간 ${slAvg % 60}분으로 목표보다 부족` : '',
      exp ? `지출 합계 ${num(exp)}원 — 예산과 비교해 보기` : '',
    ].filter(Boolean).join('\n');
    editRv({ keep: rview.keep || keep, problem: rview.problem || problem, tryNext: rview.tryNext || '- \n- \n- ' });
  };
  const saveReview = () => {
    set(x => ({ ...x, reviews: [...x.reviews.filter(r => r.week !== week), { id: saved?.id || uid(), week, keep: rview.keep.trim(), problem: rview.problem.trim(), tryNext: rview.tryNext.trim(), saved: today }] }));
    setRv(null);
  };

  // ── 기록 검색
  const [q, setQ] = useState('');
  const list = [...J.entries].filter(e => !q || `${e.text} ${e.tags.join(' ')}`.includes(q)).sort((a, b) => b.date.localeCompare(a.date));
  const items = group.items.map(it => ({ it, rows: group.rows.filter(r => r.item === it) }));

  return (
    <div className="catv jv" style={{ '--ac': areaVar(area) }}>
      <header className="page-h">
        <h1 className="area-title">{cat}</h1>
      </header>

      <div className="hv-stats">
        <div className="hv-stat sl"><span className="muted">연속 기록</span><b>{streak}일</b><span className="hv-sub">{has.has(today) ? '오늘 작성함' : '오늘 아직 안 씀'}</span></div>
        <div className="hv-stat sl"><span className="muted">이번 달 일기</span><b>{monthEntries.length}일</b><span className="hv-sub">평균 기분 {moodAvg ? `${moodAvg.toFixed(1)} (${MOODS[Math.round(moodAvg)]})` : '-'}</span></div>
        <div className={`hv-stat ${J.reviews.some(r => r.week === thisWeek) ? 'ex' : 'over'}`}><span className="muted">이번 주 회고</span>
          <b>{J.reviews.some(r => r.week === thisWeek) ? '작성함' : '아직'}</b><span className="hv-sub">{md(monday(today))} ~ {md(addDays(monday(today), 6))}</span></div>
        <div className="hv-stat ex"><span className="muted">쌓인 회고</span><b>{J.reviews.length}주</b><span className="hv-sub">일기 전체 {J.entries.length}일</span></div>
      </div>

      <JournalRemind />

      <div className="jv-grid">
        <section className="panel">
          <div className="csum-h"><h2>일기</h2>
            <input type="date" value={day} max={today} onChange={e => { setDay(e.target.value || today); setDraft(null); }} aria-label="날짜" className="jv-date" />
            {day !== today && <button className="btn sm" onClick={() => { setDay(today); setDraft(null); }}>오늘</button>}</div>
          <div className="jv-moods" role="radiogroup" aria-label="오늘 기분">
            {[1, 2, 3, 4, 5].map(m => (
              <button key={m} role="radio" aria-checked={view.mood === m} className={`jv-mood m${m} ${view.mood === m ? 'on' : ''}`} onClick={() => edit({ mood: m })}>
                <i aria-hidden="true" />{MOODS[m]}</button>))}
          </div>
          <textarea rows={5} value={view.text} onChange={e => edit({ text: e.target.value })} placeholder="오늘 있었던 일, 느낀 점을 짧게 적어 보세요" aria-label="일기 내용" />
          <div className="row2 jv-save">
            <input value={view.tags} onChange={e => edit({ tags: e.target.value })} placeholder="태그 (쉼표로 구분, 예: 운동, 가족)" aria-label="태그" />
            <button className="btn primary" onClick={saveEntry} disabled={!view.text.trim() && !view.mood}>{cur ? '수정 저장' : '저장'}</button>
          </div>
          {cur && !draft && <p className="note">{mdw(day)}에 쓴 일기입니다. 고치고 "수정 저장"을 누르세요.</p>}
        </section>

        <section className="panel">
          <div className="csum-h"><h2>기분 달력</h2><span className="muted">최근 5주</span></div>
          <div className="jv-cal">
            {['월', '화', '수', '목', '금', '토', '일'].map(w => <span key={w} className="jv-dow">{w}</span>)}
            {cells.map(d => {
              const m = moodOf(d), future = d > today;
              return (
                <button key={d} className={`jv-cell m${m} ${d === today ? 'today' : ''} ${d === day ? 'sel' : ''}`} disabled={future}
                  onClick={() => { setDay(d); setDraft(null); }} title={`${mdw(d)} · ${m ? MOODS[m] : '기록 없음'}`} aria-label={`${mdw(d)} ${m ? MOODS[m] : '기록 없음'}`}>
                  <span>{Number(d.slice(8, 10))}</span></button>
              );
            })}
          </div>
          <div className="jv-legend"><span>나쁨</span>{[1, 2, 3, 4, 5].map(m => <i key={m} className={`m${m}`} title={MOODS[m]} />)}<span>좋음</span><span className="muted">· 칸을 누르면 그날 일기</span></div>
        </section>
      </div>

      <section className="panel">
        <div className="csum-h"><h2>주간 회고</h2>
          <select value={week} onChange={e => { setWeek(e.target.value); setRv(null); }} aria-label="주 선택" className="jv-week">
            {Array.from({ length: 8 }, (_, i) => { const d = addDays(monday(today), -7 * i); const k = weekOf(d); return <option key={k} value={k}>{i === 0 ? '이번 주' : i === 1 ? '지난주' : `${i}주 전`} · {md(d)} ~ {md(addDays(d, 6))}{J.reviews.some(r => r.week === k) ? ' · 작성함' : ''}</option>; })}
          </select>
          <button className="btn sm" onClick={autoDraft}>이번 주 기록으로 초안 채우기</button></div>
        <div className="jv-kpt">
          <label className="kpt k"><b>잘한 것</b><textarea rows={5} value={rview.keep} onChange={e => editRv({ keep: e.target.value })} placeholder="계속 이어갈 것" /></label>
          <label className="kpt p"><b>아쉬운 것</b><textarea rows={5} value={rview.problem} onChange={e => editRv({ problem: e.target.value })} placeholder="잘 안 된 것, 문제였던 것" /></label>
          <label className="kpt t"><b>다음 주에 할 것</b><textarea rows={5} value={rview.tryNext} onChange={e => editRv({ tryNext: e.target.value })} placeholder="다음 주에 시도할 것" /></label>
        </div>
        <div className="jv-rv-foot">
          <span className="note">초안은 체크리스트 완료, 운동·수면, 지출, 연락 메모, 일기에서 이번 주 기록을 모아 빈 칸에만 채웁니다.{saved ? ` 마지막 저장 ${md(saved.saved)}.` : ''}</span>
          <button className="btn primary" onClick={saveReview} disabled={!rview.keep.trim() && !rview.problem.trim() && !rview.tryNext.trim()}>회고 저장</button>
        </div>
      </section>

      <div className="jv-grid">
        <section className="panel">
          <div className="csum-h"><h2>지난 회고</h2><span className="muted">{J.reviews.length}주</span></div>
          <ul className="jv-reviews">{[...J.reviews].sort((a, b) => b.week.localeCompare(a.week)).map(r => (
            <li key={r.id}><button className="linkish" onClick={() => { setWeek(r.week); setRv(null); }}>{r.week.replace('-W', '년 ')}주차</button>
              <p><b>잘한 것</b> {r.keep || '-'}</p><p><b>다음 주</b> {r.tryNext || '-'}</p></li>))}</ul>
          {!J.reviews.length && <p className="muted">아직 회고가 없습니다.</p>}
        </section>
        <section className="panel">
          <div className="csum-h"><h2>일기 모아보기</h2><input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="내용·태그 검색" aria-label="일기 검색" className="jv-q" /></div>
          <ul className="jv-list">{list.slice(0, 12).map(e => (
            <li key={e.id}><button className="jv-li" onClick={() => { setDay(e.date); setDraft(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
              <i className={`jv-dot m${e.mood}`} aria-hidden="true" /><time>{mdw(e.date)}</time>
              <span className="grow">{e.text}</span>{e.tags.map(t => <span key={t} className="tag">{t}</span>)}</button></li>))}</ul>
          {!list.length && <p className="muted">해당하는 일기가 없습니다.</p>}
        </section>
      </div>

    </div>
  );
}

/* 저널링 알림 설정: 매일 일기 · 주간 회고 */
const WD = ['일', '월', '화', '수', '목', '금', '토'];
function JournalRemind() {
  const { store, setStore, now } = useCtx();
  const R = remindOf(store);
  const set = p => setStore(s => ({ ...s, journal: { ...(s.journal || seedJournal(now)), remind: { ...remindOf(s), ...p } } }));
  const setW = p => set({ weekly: { ...R.weekly, ...p } });
  const perm = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
  const [, rerender] = useState(0);
  const ask = async () => { try { await Notification.requestPermission(); } catch { /* 무시 */ } rerender(x => x + 1); };
  const next = upcomingJournal(store, new Date(), 8).filter(n => n.when > new Date()).slice(0, 2);
  const test = () => showOsNotification({ key: `test:${Date.now()}`, title: '저널링 알림 (시험)', body: '이렇게 알림이 옵니다' });
  return (
    <section className="panel jr">
      <div className="csum-h"><h2>알림</h2>
        <span className="muted">{R.on || R.weekly.on ? (next.length ? `다음 알림 ${whenText(next[0].when, WD)}` : '') : '꺼져 있음'}</span></div>
      <div className="jr-rows">
        <div className="jr-row">
          <label className="jr-on"><input type="checkbox" checked={R.on} onChange={e => set({ on: e.target.checked })} />매일 일기 알림</label>
          <input type="time" value={R.time} onChange={e => e.target.value && set({ time: e.target.value })} disabled={!R.on} aria-label="일기 알림 시각" />
          <span className="jr-days" role="group" aria-label="알림 요일">{WD.map((w, i) => (
            <button key={w} type="button" aria-pressed={R.days.includes(i)} disabled={!R.on}
              onClick={() => set({ days: R.days.includes(i) ? R.days.filter(x => x !== i) : [...R.days, i].sort() })}>{w}</button>))}</span>
          <label className="jr-skip"><input type="checkbox" checked={R.skip} onChange={e => set({ skip: e.target.checked })} disabled={!R.on} />이미 쓴 날은 알리지 않기</label>
        </div>
        <div className="jr-row">
          <label className="jr-on"><input type="checkbox" checked={R.weekly.on} onChange={e => setW({ on: e.target.checked })} />주간 회고 알림</label>
          <select value={R.weekly.day} onChange={e => setW({ day: Number(e.target.value) })} disabled={!R.weekly.on} aria-label="회고 알림 요일">{WD.map((w, i) => <option key={w} value={i}>매주 {w}요일</option>)}</select>
          <input type="time" value={R.weekly.time} onChange={e => e.target.value && setW({ time: e.target.value })} disabled={!R.weekly.on} aria-label="회고 알림 시각" />
          <span className="muted">그 주 회고를 이미 썼으면 알리지 않습니다</span>
        </div>
      </div>
      <div className="jr-foot">
        {perm === 'default' && <button className="btn sm primary" onClick={ask}>브라우저 알림 허용</button>}
        {perm === 'denied' && <span className="jr-warn">브라우저에서 알림이 막혀 있어 화면 안 알림만 뜹니다 (주소창 왼쪽 자물쇠 › 알림 허용)</span>}
        {perm === 'granted' && <button className="btn sm" onClick={test}>알림 시험</button>}
        <span className="note">지금은 Jcalender 가 열려 있을 때(다른 탭이어도) 알림이 옵니다. 설치 앱으로 바꾸면 앱이 꺼져 있어도 같은 설정으로 울리게 됩니다.</span>
      </div>
    </section>
  );
}
