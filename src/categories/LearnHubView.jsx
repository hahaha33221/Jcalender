import React, { useRef, useState } from 'react';
import { iso } from '../data.js';
import { areaVar, num, useCtx } from '../shared.jsx';
import StudyView from './StudyView.jsx';

/* 직접 개발하는 앱과 연동하는 아이콘 카드
   - 개인 › 자기계발/학습: 영어 · IT · 자격증 (LEARN_APPS)
   - 개인 › 여가 관리: 여행 · 독서 · 기타 · 밴드 합주 (LEISURE_APPS, LeisureView 에서 AppCards 로 사용)
   카드마다 앱 주소(열기)와 데이터 주소(동기화)를 저장하고,
   데이터 주소는 docs/learning-app-integration.md 의 JSON 형식을 돌려주면 된다.
   learn = { english|it|cert|trip|reading|guitar|band: { appName, openUrl, dataUrl, data, syncedAt } } */
export const LEARN_APPS = [
  { key: 'english', name: '영어' },
  { key: 'it', name: 'IT' },
  { key: 'cert', name: '자격증' },
];
export const LEISURE_APPS = [
  { key: 'trip', name: '여행' },
  { key: 'reading', name: '독서' },
  { key: 'guitar', name: '기타' },
  { key: 'band', name: '밴드 합주' },
];

/* 아이콘 (선으로 그린 SVG) */
const ICONS = {
  english: (
    <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 14h36a6 6 0 0 1 6 6v18a6 6 0 0 1-6 6H28l-10 9v-9h-8a6 6 0 0 1-6-6V20a6 6 0 0 1 6-6z" />
      <path d="M17 37l6-15 6 15M19.5 31h7" /><path d="M36 26c2-2 7-2 8 1v10M44 32c-1-2-8-2-8 2s6 4 8 1" /></svg>
  ),
  it: (
    <svg viewBox="0 0 64 64" aria-hidden="true"><rect x="8" y="12" width="48" height="32" rx="4" /><path d="M24 52h16M32 44v8" />
      <path d="M26 22l-6 6 6 6M38 22l6 6-6 6M34 20l-4 16" /></svg>
  ),
  cert: (
    <svg viewBox="0 0 64 64" aria-hidden="true"><rect x="8" y="10" width="48" height="34" rx="3" /><path d="M16 20h24M16 27h18M16 34h12" />
      <circle cx="44" cy="36" r="7" /><path d="M40 42l-3 12 7-4 7 4-3-12" /></svg>
  ),
  trip: (
    <svg viewBox="0 0 64 64" aria-hidden="true"><rect x="12" y="22" width="40" height="30" rx="4" /><path d="M24 22v-6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v6" />
      <path d="M22 22v30M42 22v30" /><circle cx="20" cy="56" r="2" /><circle cx="44" cy="56" r="2" /></svg>
  ),
  band: (
    <svg viewBox="0 0 64 64" aria-hidden="true"><ellipse cx="32" cy="40" rx="20" ry="7" /><path d="M12 40v8c0 4 9 7 20 7s20-3 20-7v-8" />
      <path d="M22 26l-8-14M42 26l8-14" /><path d="M44 8v14a3 3 0 1 1-3-3M50 6v12a3 3 0 1 1-3-3M44 8l6-2" /></svg>
  ),
  reading: (
    <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 18c-6-5-15-6-24-4v34c9-2 18-1 24 4 6-5 15-6 24-4V14c-9-2-18-1-24 4z" /><path d="M32 18v34" />
      <path d="M14 23c4-1 8-1 12 1M14 30c4-1 8-1 12 1M38 24c4-2 8-2 12-1M38 31c4-2 8-2 12-1" /></svg>
  ),
  guitar: (
    <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M40 24l12-12M48 10l6 6" /><path d="M36 28c-3-3-8-3-11 0-2 2-2 5-4 6-3 1-7 1-10 4-5 5-4 12 1 17s12 6 17 1c3-3 3-7 4-10 1-2 4-2 6-4 3-3 3-8 0-11z" />
      <circle cx="26" cy="38" r="4" /><path d="M20 44l6-6" /></svg>
  ),
};

const dday = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);
/** 금액을 짧게: 1,950,000 → 195만원 (좁은 카드용) */
const man = v => (v >= 10000 ? `${num(Math.round(v / 10000))}만원` : `${num(v)}원`);
/** 여행 앱 카드: 예정 여행 수 · 다음 여행 D-day · 예산 합계 */
function TripKpi({ trips }) {
  const { now } = useCtx();
  const t0 = iso(now), next = [...trips].filter(t => t.end >= t0).sort((a, b) => a.start.localeCompare(b.start));
  return (
    <ul className="lh-kpi">
      <li><span>예정</span><b>{next.length}건</b></li>
      <li><span>다음 여행</span><b>{next[0] ? (next[0].start <= t0 ? '여행 중' : `D-${dday(t0, next[0].start)}`) : '-'}</b></li>
      <li><span>예산 합계</span><b>{man(next.reduce((a, t) => a + t.budget, 0))}</b></li>
    </ul>
  );
}

const emptyCard = { appName: '', openUrl: '', dataUrl: '', data: null, syncedAt: '' };
const hm = m => (m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${m}분`);

/** 연동 앱이 보낸 JSON 확인 (필수: summary 또는 sessions 중 하나) */
export function validateFeed(j) {
  if (!j || typeof j !== 'object') throw new Error('JSON 객체가 아닙니다');
  if (!j.summary && !Array.isArray(j.sessions) && !Array.isArray(j.trips)) throw new Error('summary, sessions, trips 중 하나가 있어야 합니다');
  const s = j.summary || {};
  const sessions = (Array.isArray(j.sessions) ? j.sessions : []).filter(x => x && x.date).map(x => ({ date: String(x.date).slice(0, 10), minutes: Number(x.minutes) || 0, title: String(x.title || '') }));
  return {
    app: String(j.app || ''), updatedAt: String(j.updatedAt || ''),
    summary: { todayMinutes: Number(s.todayMinutes) || 0, weekMinutes: Number(s.weekMinutes) || 0, streakDays: Number(s.streakDays) || 0,
      progress: s.progress == null ? null : Math.max(0, Math.min(100, Number(s.progress) || 0)), progressLabel: String(s.progressLabel || '') },
    sessions: sessions.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50),
    // 여행 앱: trips = [{ name, start, end, budget, spent }]
    trips: (Array.isArray(j.trips) ? j.trips : []).filter(t => t && t.name && t.start).map(t => ({
      name: String(t.name), start: String(t.start).slice(0, 10), end: String(t.end || t.start).slice(0, 10), budget: Number(t.budget) || 0, spent: Number(t.spent) || 0,
    })).slice(0, 50),
  };
}

export default function LearnHubView({ area, cat }) {
  return (
    <div className="catv lh" style={{ '--ac': areaVar(area) }}>
      <header className="page-h">
        <h1 className="area-title">{cat}</h1>
      </header>
      <AppCards apps={LEARN_APPS} />

      {/* 공부 시간 · 과목별 진도 · 공부 기록 (연동 앱 기록 포함) */}
      <StudyView area={area} cat={cat} embedded apps={LEARN_APPS} />
    </div>
  );
}

/** 앱 연동 카드 묶음 (apps = [{ key, name }]) */
export function AppCards({ apps }) {
  const { store, setStore } = useCtx();
  const learn = store.learn || {};
  const [open, setOpen] = useState(null);             // 설정을 펼친 카드
  const [msg, setMsg] = useState({});                 // 카드별 안내 문구
  const fileRef = useRef({});
  const card = k => ({ ...emptyCard, ...(learn[k] || {}) });
  const save = (k, patch) => setStore(s => ({ ...s, learn: { ...(s.learn || {}), [k]: { ...emptyCard, ...((s.learn || {})[k] || {}), ...patch } } }));
  const stamp = () => { const d = new Date(); return `${iso(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

  const sync = async k => {
    const c = card(k);
    if (!c.dataUrl) { setMsg({ ...msg, [k]: { err: true, t: '데이터 주소를 먼저 입력해 주세요.' } }); return; }
    setMsg({ ...msg, [k]: { t: '동기화 중…' } });
    try {
      const r = await fetch(c.dataUrl, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`응답 ${r.status}`);
      const data = validateFeed(await r.json());
      save(k, { data, syncedAt: stamp() });
      setMsg({ ...msg, [k]: { t: `동기화했습니다 (기록 ${data.sessions.length + data.trips.length}건).` } });
    } catch (e) {
      setMsg({ ...msg, [k]: { err: true, t: `동기화하지 못했습니다: ${e.message}. 앱 서버가 이 주소에서의 요청을 허용(CORS)하는지 확인하거나 JSON 파일로 불러오세요.` } });
    }
  };
  const loadFile = async (k, file) => {
    if (!file) return;
    try {
      const data = validateFeed(JSON.parse(await file.text()));
      save(k, { data, syncedAt: stamp() });
      setMsg({ ...msg, [k]: { t: `파일에서 불러왔습니다 (기록 ${data.sessions.length + data.trips.length}건).` } });
    } catch (e) { setMsg({ ...msg, [k]: { err: true, t: `파일을 읽지 못했습니다: ${e.message}` } }); }
    if (fileRef.current[k]) fileRef.current[k].value = '';
  };

  return (
      <div className={`lh-grid n${apps.length}`}>
        {apps.map(({ key: k, name }) => {
          const c = card(k), d = c.data, linked = !!(c.openUrl || c.dataUrl);
          return (
            <section key={k} className={`lh-card ${d ? 'has' : ''}`} aria-label={name}>
              <a className="lh-icon" href={c.openUrl || undefined} target="_blank" rel="noreferrer" onClick={e => { if (!c.openUrl) { e.preventDefault(); setOpen(open === k ? null : k); } }}
                title={c.openUrl ? `${c.appName || name} 앱 열기` : '연동 설정 열기'}>
                {ICONS[k]}<b>{name}</b>
              </a>
              <p className="lh-state">{d ? `${c.appName || d.app || name} · 마지막 동기화 ${c.syncedAt}` : linked ? `${c.appName || '앱'} 연결됨 · 아직 동기화 전` : '연동 전'}</p>
              {d && (
                <div className="lh-data">
                  {d.trips?.length ? <TripKpi trips={d.trips} /> : <ul className="lh-kpi">
                    <li><span>오늘</span><b>{hm(d.summary.todayMinutes)}</b></li>
                    <li><span>이번 주</span><b>{hm(d.summary.weekMinutes)}</b></li>
                    <li><span>연속</span><b>{num(d.summary.streakDays)}일</b></li>
                  </ul>}
                  {d.summary.progress != null && <div className="lh-prog"><span>{d.summary.progressLabel || '진행률'}</span><span className="pbar"><i style={{ width: `${d.summary.progress}%`, background: 'var(--ac)' }} /></span><b>{d.summary.progress}%</b></div>}
                  {d.trips?.length > 0 && <ul className="lh-sess">{[...d.trips].sort((a, b) => a.start.localeCompare(b.start)).filter(t => t.end >= iso(new Date())).slice(0, 4).map((t, i) => <li key={`t${i}`}><time>{Number(t.start.slice(5, 7))}/{Number(t.start.slice(8, 10))}</time><span className="grow">{t.name}</span><span className="muted">{man(t.budget)}</span></li>)}</ul>}
                  {d.sessions.length > 0 && <ul className="lh-sess">{d.sessions.slice(0, 4).map((x, i) => <li key={i}><time>{Number(x.date.slice(5, 7))}/{Number(x.date.slice(8, 10))}</time><span className="grow">{x.title || '학습'}</span><span className="muted">{hm(x.minutes)}</span></li>)}</ul>}
                </div>
              )}
              <div className="lh-btns">
                {c.openUrl && <a className="btn sm primary" href={c.openUrl} target="_blank" rel="noreferrer">앱 열기</a>}
                {c.dataUrl && <button className="btn sm" onClick={() => sync(k)}>동기화</button>}
                <button className="btn sm" onClick={() => setOpen(open === k ? null : k)}>{open === k ? '설정 닫기' : '연동 설정'}</button>
              </div>
              {msg[k] && <p className={`sh-msg ${msg[k].err ? 'err' : ''}`} role="status">{msg[k].t}</p>}
              {open === k && (
                <div className="lh-set">
                  <label>앱 이름<input value={c.appName} onChange={e => save(k, { appName: e.target.value })} placeholder={`예: 나의 ${name} 앱`} /></label>
                  <label>앱 주소 (열기)<input value={c.openUrl} onChange={e => save(k, { openUrl: e.target.value.trim() })} placeholder="https://… 또는 앱 링크" /></label>
                  <label>데이터 주소 (동기화, JSON)<input value={c.dataUrl} onChange={e => save(k, { dataUrl: e.target.value.trim() })} placeholder="https://…/learning.json" /></label>
                  <div className="lh-btns">
                    <label className="btn sm">JSON 파일 불러오기<input type="file" accept=".json,application/json" hidden ref={el => { fileRef.current[k] = el; }} onChange={e => loadFile(k, e.target.files[0])} /></label>
                    {d && <button className="btn sm" onClick={() => { save(k, { data: null, syncedAt: '' }); setMsg({ ...msg, [k]: null }); }}>가져온 기록 지우기</button>}
                  </div>
                  <p className="note">데이터 형식은 저장소의 docs/learning-app-integration.md 에 있습니다. 시험용 파일: samples/learning_{k}_sample.json</p>
                </div>
              )}
            </section>
          );
        })}
      </div>
  );
}
