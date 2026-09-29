import React, { useRef, useState } from 'react';
import { AREAS, iso } from '../data.js';
import { areaVar, num, useCtx } from '../shared.jsx';
import StudyView from './StudyView.jsx';

/* 개인 › 자기계발/학습: 영어 · 독서 · 기타 3개 아이콘 카드
   직접 개발하는 앱과 연동한다. 카드마다 앱 주소(열기)와 데이터 주소(동기화)를 저장하고,
   데이터 주소는 docs/learning-app-integration.md 의 JSON 형식을 돌려주면 된다.
   learn = { english|reading|guitar: { appName, openUrl, dataUrl, data, syncedAt } } */
export const LEARN_APPS = [
  { key: 'english', name: '영어' },
  { key: 'reading', name: '독서' },
  { key: 'guitar', name: '기타' },
];

/* 아이콘 (선으로 그린 SVG) */
const ICONS = {
  english: (
    <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 14h36a6 6 0 0 1 6 6v18a6 6 0 0 1-6 6H28l-10 9v-9h-8a6 6 0 0 1-6-6V20a6 6 0 0 1 6-6z" />
      <path d="M17 37l6-15 6 15M19.5 31h7" /><path d="M36 26c2-2 7-2 8 1v10M44 32c-1-2-8-2-8 2s6 4 8 1" /></svg>
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

const emptyCard = { appName: '', openUrl: '', dataUrl: '', data: null, syncedAt: '' };
const hm = m => (m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${m}분`);

/** 연동 앱이 보낸 JSON 확인 (필수: summary 또는 sessions 중 하나) */
export function validateFeed(j) {
  if (!j || typeof j !== 'object') throw new Error('JSON 객체가 아닙니다');
  if (!j.summary && !Array.isArray(j.sessions)) throw new Error('summary 나 sessions 가 없습니다');
  const s = j.summary || {};
  const sessions = (Array.isArray(j.sessions) ? j.sessions : []).filter(x => x && x.date).map(x => ({ date: String(x.date).slice(0, 10), minutes: Number(x.minutes) || 0, title: String(x.title || '') }));
  return {
    app: String(j.app || ''), updatedAt: String(j.updatedAt || ''),
    summary: { todayMinutes: Number(s.todayMinutes) || 0, weekMinutes: Number(s.weekMinutes) || 0, streakDays: Number(s.streakDays) || 0,
      progress: s.progress == null ? null : Math.max(0, Math.min(100, Number(s.progress) || 0)), progressLabel: String(s.progressLabel || '') },
    sessions: sessions.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 50),
  };
}

export default function LearnHubView({ area, cat }) {
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
      setMsg({ ...msg, [k]: { t: `동기화했습니다 (기록 ${data.sessions.length}건).` } });
    } catch (e) {
      setMsg({ ...msg, [k]: { err: true, t: `동기화하지 못했습니다: ${e.message}. 앱 서버가 이 주소에서의 요청을 허용(CORS)하는지 확인하거나 JSON 파일로 불러오세요.` } });
    }
  };
  const loadFile = async (k, file) => {
    if (!file) return;
    try {
      const data = validateFeed(JSON.parse(await file.text()));
      save(k, { data, syncedAt: stamp() });
      setMsg({ ...msg, [k]: { t: `파일에서 불러왔습니다 (기록 ${data.sessions.length}건).` } });
    } catch (e) { setMsg({ ...msg, [k]: { err: true, t: `파일을 읽지 못했습니다: ${e.message}` } }); }
    if (fileRef.current[k]) fileRef.current[k].value = '';
  };

  return (
    <div className="catv lh" style={{ '--ac': areaVar(area) }}>
      <header className="page-h">
        <h1 className="area-title">{cat}</h1>
        <p>{AREAS[area].n} · 영어 · 독서 · 기타 학습 앱과 연동합니다. 아이콘을 누르면 앱을 열고, 연동 설정에서 앱 주소와 데이터 주소를 입력합니다. 가져온 기록은 아래 공부 시간·진도·기록에 함께 들어갑니다.</p>
      </header>

      <div className="lh-grid">
        {LEARN_APPS.map(({ key: k, name }) => {
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
                  <ul className="lh-kpi">
                    <li><span>오늘</span><b>{hm(d.summary.todayMinutes)}</b></li>
                    <li><span>이번 주</span><b>{hm(d.summary.weekMinutes)}</b></li>
                    <li><span>연속</span><b>{num(d.summary.streakDays)}일</b></li>
                  </ul>
                  {d.summary.progress != null && <div className="lh-prog"><span>{d.summary.progressLabel || '진행률'}</span><span className="pbar"><i style={{ width: `${d.summary.progress}%`, background: 'var(--ac)' }} /></span><b>{d.summary.progress}%</b></div>}
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

      {/* 공부 시간 · 과목별 진도 · 공부 기록 (연동 앱 기록 포함) */}
      <StudyView area={area} cat={cat} embedded apps={LEARN_APPS} />
    </div>
  );
}
