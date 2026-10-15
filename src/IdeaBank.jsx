import React, { useEffect, useRef, useState } from 'react';
import { AREAS, CATS, iso } from './data.js';
import { Popup, useCtx } from './shared.jsx';
import { API_BASE } from './serverSync.js';
import { CYC, STAGES, TYPES, applyAction, contextOf, findGoal, ideaStats, ideaText, mergeIdea, newIdea, pointsOf, purgeDropped, stageOf, tagCounts, toTriage, uid, withAi } from './ideas.js';
import { ideaRemindOf } from './ideaRemind.js';
import { WishPick } from './Wishes.jsx';
import { ideaToWish } from './wishes.js';

/* 아이디어 뱅크: 스친 생각은 빠르게 남기고(스침), 하루 한 번 카드 넘기기로 정리하고, 중요한 것만 AI 로 정리해 실행한다 (src/ideas.js)
   - 스침: 한 줄 글 · 짧은 녹음 → AI 없이 바로 저장 (어느 화면에서든 오른쪽 아래 버튼 IdeaFab, 대시보드의 IdeaHome)
     긴 녹음(2분 이상) · 긴 글(300자 이상) · "바로 중요로" 를 켜면 곧바로 중요 + AI 정리
   - 정리하기(Triage): 스침을 한 장씩 → 체크(봤음) · 중요로 올리기(AI 정리) · 나중에(내일 다시) · 버리기(30일 뒤 삭제). 정리할 스침이 있으면 밤 11시 알림 (ideaRemind.js)
   - 중요 카드: 핵심 3줄 + 할 일 → "적용"을 누르면 캘린더 · 목표 To do · 체크리스트 · 새 목표로 바로 들어감
   - 긴 녹음(최대 90분)은 3분 구간으로 나눠 녹음하는 동안 차례로 받아 적음. 녹음 중에는 화면이 꺼지지 않게(Wake Lock)
   - 녹음 파일은 서버에서 받아 적은 뒤 버림. 저장되는 것은 글(원문) · 핵심 · 할 일뿐 */
const MAX_SEC = 90 * 60, SEG_SEC = 180;
const segSec = () => Number(window.__JCAL_SEG_SEC) || SEG_SEC;   // 시험할 때만 짧게
const MIME = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];
const fmtSec = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const fmtAt = s => { const d = new Date(s); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** 중요로 올리고 AI 로 정리 (핵심 3줄 + 할 일). 실패해도 중요로는 남김 → 결과 메시지 */
export function useOrganize() {
  const { store, setStore, sync, areasAllowed, now } = useCtx();
  const storeRef = useRef(store); storeRef.current = store;
  return async idea => {
    setStore(s => ({ ...s, ideas: (s.ideas || []).map(i => (i.id === idea.id ? { ...i, status: ['applied', 'archived'].includes(i.status) ? i.status : 'key', aiBusy: true } : i)) }));
    try {
      const r = await sync.request('/api/ideas/structure', { method: 'POST', body: { text: idea.text, today: iso(now), ...contextOf(storeRef.current, [...(areasAllowed || 'P')]) } });
      setStore(s => ({ ...s, ideas: (s.ideas || []).map(i => (i.id === idea.id ? { ...withAi(i, r), aiBusy: undefined, aiErr: undefined } : i)) }));
      return { ok: true };
    } catch (e) {
      const msg = e.status === 404 ? '서버 업데이트가 필요합니다 (update.sh)' : e.message;
      setStore(s => ({ ...s, ideas: (s.ideas || []).map(i => (i.id === idea.id ? { ...i, aiBusy: undefined, aiErr: msg } : i)) }));
      return { ok: false, msg };
    }
  };
}

/** 녹음(구간별 받아쓰기) → 저장(스침, 길면 중요 + AI 정리). onSaved(id) */
function useCapture(onSaved, keyRef) {
  const { setStore, areasAllowed, sync } = useCtx();
  const organize = useOrganize();
  const [st, setSt] = useState({ phase: 'idle', sec: 0, segs: 0, done: 0, msg: '', bad: false });
  const rec = useRef(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; const R = rec.current; if (R) { R.cancel = true; clearInterval(R.timer); try { R.mr?.stop(); } catch { /* 무시 */ } R.stream.getTracks().forEach(t => t.stop()); R.lock?.release().catch(() => {}); } }, []);
  const set = f => { if (alive.current) setSt(f); };

  /** 글 → 저장. 짧으면 스침, 길거나 key 면 중요 + AI 정리 */
  const save = async (text, src, sec = 0, key = false) => {
    const area = (areasAllowed || 'P')[0] || 'P';
    const big = key || (src === 'voice' && sec >= 120) || text.length >= 300;
    const idea = newIdea(text, src, area, sec, big ? 'key' : 'inbox');
    setStore(s => ({ ...s, ideas: [idea, ...(s.ideas || [])] }));
    onSaved?.(idea.id, big);
    if (!big) return set(v => ({ ...v, phase: 'idle', sec: 0, msg: `스침으로 저장했습니다 · "${idea.title}" · 정리할 때 체크 · 중요로 나눕니다`, bad: false }));
    set(v => ({ ...v, phase: 'ai', msg: `중요로 저장하고 AI 가 핵심 3줄 · 할 일로 정리하는 중… (${text.length > 3000 ? '긴 녹음은 30초~1분' : '5~20초'})`, bad: false }));
    const r = await organize(idea);
    set(v => ({ ...v, phase: 'idle', sec: 0, msg: r.ok ? '중요로 정리했습니다 · 할 일에서 "적용"을 누르면 바로 들어갑니다' : `받아 적은 글은 중요로 저장했습니다. AI 정리는 못 했어요: ${r.msg}`, bad: !r.ok }));
  };
  /** 구간 하나 받아쓰기 (실패하면 한 번 더) */
  const sendSeg = async (R, blob, idx) => {
    if (blob.size < 2000) { R.texts[idx] = ''; return; }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(`${API_BASE}/api/ideas/voice`, { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm', Authorization: `Bearer ${sync.conf.token}` }, body: blob });
        const j = await r.json().catch(() => ({}));
        if (r.status === 400 || r.status === 422) { R.texts[idx] = ''; return; }                  // 말소리 없는 구간
        if (!r.ok) throw Object.assign(new Error(r.status === 404 ? '서버 업데이트가 필요합니다 (VPS 에서 update.sh)' : j.error || `받아쓰기 오류 (${r.status})`), { status: r.status });
        R.texts[idx] = j.text; return;
      } catch (e) { R.err = e.message; if (e.status === 404 || e.status === 429 || e.status === 503 || attempt) break; }
    }
    R.texts[idx] = `[${fmtSec(idx * segSec())}~ 구간은 받아 적지 못했습니다]`; R.failed++;
  };
  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return setSt(v => ({ ...v, phase: 'idle', msg: '이 브라우저는 녹음을 지원하지 않습니다. 글로 적어 주세요', bad: true }));
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { return setSt(v => ({ ...v, phase: 'idle', msg: '마이크를 쓸 수 없습니다. 브라우저(휴대폰) 설정에서 마이크를 허용해 주세요', bad: true })); }
    const mimeType = MIME.find(m => MediaRecorder.isTypeSupported?.(m)) || '';
    const R = { stream, texts: [], segs: 0, done: 0, failed: 0, err: '', stopping: false, cancel: false, t0: Date.now(), queue: Promise.resolve(), lock: null };
    try { R.lock = await navigator.wakeLock?.request('screen'); } catch { /* 화면 켜 두기 안 됨 */ }
    const finish = async () => {
      R.lock?.release().catch(() => {});
      const sec = Math.round((R.end - R.t0) / 1000), text = R.texts.filter(Boolean).join('\n').trim();
      if (!text || R.failed === R.segs) return setSt(v => ({ ...v, phase: 'idle', msg: `${R.err || '말소리를 알아듣지 못했습니다'} — 말한 내용을 글로 적어도 됩니다`, bad: true }));
      await save(text, 'voice', sec, !!keyRef?.current);
      if (R.failed) setSt(v => ({ ...v, msg: `${v.msg} (${R.failed}개 구간은 받아 적지 못했습니다)` }));
    };
    const newSeg = () => {
      const mr = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 24000 });
      const chunks = [], idx = R.segs++;
      mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      mr.onstop = () => {
        if (R.cancel) return;
        const blob = new Blob(chunks, { type: (mr.mimeType || mimeType || 'audio/webm').split(';')[0] });
        R.queue = R.queue.then(() => sendSeg(R, blob, idx)).then(() => { R.done++; setSt(v => ({ ...v, done: R.done, segs: R.segs })); });
        if (!R.stopping) newSeg();
        else R.queue = R.queue.then(finish);
      };
      mr.start(1000); R.mr = mr; R.segT0 = Date.now();
      setSt(v => ({ ...v, segs: R.segs }));
    };
    R.timer = setInterval(() => {
      const sec = Math.round((Date.now() - R.t0) / 1000);
      setSt(v => ({ ...v, sec }));
      if (sec >= MAX_SEC) stop();
      else if (Date.now() - R.segT0 >= segSec() * 1000 && R.mr.state === 'recording') R.mr.stop();   // 다음 구간으로 (받아쓰기는 녹음하는 동안 진행)
    }, 500);
    rec.current = R;
    newSeg();
    setSt({ phase: 'rec', sec: 0, segs: 1, done: 0, msg: '', bad: false });
  };
  const stop = (cancel = false) => {
    const R = rec.current; if (!R) return;
    clearInterval(R.timer); rec.current = null;
    R.stopping = true; R.cancel = cancel; R.end = Date.now();
    try { R.mr.stop(); } catch { /* 이미 멈춤 */ }
    R.stream.getTracks().forEach(t => t.stop());
    if (cancel) R.lock?.release().catch(() => {});
    setSt(v => ({ ...v, phase: cancel ? 'idle' : 'stt', msg: cancel ? '녹음을 취소했습니다' : '남은 부분을 받아 적는 중…', bad: false }));
  };
  return { st, start, stop, save, organize };
}

const MIC = s => <svg viewBox="0 0 24 24" width={s} height={s} aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>;

/** 빠른 기록: 한 줄 + 마이크 (Enter 로 저장 → 스침). "바로 중요로" 를 켜면 중요 + AI 정리 */
function Capture({ onSaved, compact, auto }) {
  const keyRef = useRef(false);
  const { st, start, stop, save } = useCapture(onSaved, keyRef);
  const [text, setText] = useState('');
  const [key, setKey] = useState(false);
  keyRef.current = key;
  const inp = useRef(null);
  useEffect(() => { if (auto) inp.current?.focus(); }, [auto]);
  const busy = st.phase === 'stt' || st.phase === 'ai';
  const submit = e => { e.preventDefault(); const t = text.trim(); if (t.length >= 2) { save(t, 'text', 0, key); setText(''); } };
  return (
    <div className={`ib-cap ${compact ? 'compact' : ''}`}>
      {st.phase === 'rec' ? <div className="ib-rec">
        <button className="ib-mic on" onClick={() => stop()} aria-label="녹음 끝내기"><span className="ib-sq" /></button>
        <div><b className="ib-time">{fmtSec(st.sec)}</b><small className="muted"> / 최대 90분 · 끝나면 누르세요{st.done ? ` · 받아 적은 구간 ${st.done}` : ''}</small>
          <div><button className="linkish" onClick={() => stop(true)}>취소</button><small className="muted"> · 2분 넘게 녹음하면 중요로 저장하고 AI 가 정리합니다</small></div></div>
      </div> : <form className="ib-quick" onSubmit={submit}>
        <input ref={inp} value={text} onChange={e => setText(e.target.value)} placeholder={busy ? (st.phase === 'stt' ? `받아 적는 중… (${st.done}/${st.segs} 구간)` : 'AI 가 정리하는 중…') : '스친 생각 한 줄 · #태그'} aria-label="스친 생각 적기" disabled={busy} enterKeyHint="done" />
        <button type="button" className="ib-mic sm" onClick={start} disabled={busy} aria-label="녹음 시작" title="녹음 (짧으면 스침, 2분 넘으면 중요로 정리)">{MIC(20)}</button>
        <button className="btn primary" disabled={busy || text.trim().length < 2}>저장</button>
      </form>}
      <label className="ib-keyopt"><input type="checkbox" checked={key} onChange={e => setKey(e.target.checked)} /> 바로 중요로 (AI 가 핵심 3줄 · 할 일로 정리) <small className="muted">· 회의 녹음 · 긴 메모에</small></label>
      {st.msg && <p className={st.bad ? 'banner' : 'banner ok'} role="status">{st.msg}</p>}
    </div>
  );
}

/** 할 일 한 줄 (적용 방식 · 날짜 · 목표 · 주기 고르기 → 적용) */
function ActRow({ idea, a, goals, upd, updAct, apply, where }) {
  const { store, now } = useCtx();
  return (
    <div className={`ib-act ${a.done ? 'done' : ''}`}>
      <select value={a.type} onChange={e => updAct(a.id, { type: e.target.value })} disabled={!!a.done} aria-label="적용 방식">{Object.entries(TYPES).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
      <input value={a.title} onChange={e => updAct(a.id, { title: e.target.value })} disabled={!!a.done} aria-label="할 일" />
      <span className="ib-opt">
        {a.type === 'event' && <><input type="date" value={a.date || iso(now)} onChange={e => updAct(a.id, { date: e.target.value })} disabled={!!a.done} aria-label="날짜" /><input type="time" value={a.time} onChange={e => updAct(a.id, { time: e.target.value })} disabled={!!a.done} aria-label="시각" /></>}
        {a.type === 'todo' && <select value={a.goal} onChange={e => updAct(a.id, { goal: e.target.value })} disabled={!!a.done} aria-label="목표">
          <option value="">목표 없음 → 체크리스트 수시 항목</option>{goals.map(g => <option key={g.id} value={g.id}>{AREAS[g.a].n} · {g.name}</option>)}</select>}
        {a.type === 'check' && <select value={a.cycle || 'D'} onChange={e => updAct(a.id, { cycle: e.target.value })} disabled={!!a.done} aria-label="주기">{Object.entries(CYC).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>}
        {a.type === 'goal' && <label className="ib-dl">마감<input type="date" value={a.date || `${now.getFullYear()}-12-31`} onChange={e => updAct(a.id, { date: e.target.value })} disabled={!!a.done} /></label>}
      </span>
      {a.done ? <span className="ib-done">✓ 적용함 {where(a)}</span>
        : <span className="ib-btns"><button className="btn sm primary" disabled={!a.title.trim()} onClick={() => apply(a.id)}>{a.type === 'note' ? '확인' : '적용'}</button>
          <button className="tl-del" onClick={() => upd({ actions: idea.actions.filter(x => x.id !== a.id) })} aria-label="빼기">×</button></span>}
      {(a.detail || a.who) && <small className="muted ib-det">{a.who ? `담당: ${a.who}` : ''}{a.who && a.detail ? ' · ' : ''}{a.detail}{a.type === 'todo' && a.goal && !findGoal(store, a.goal) ? ' · (목표를 찾을 수 없어 체크리스트로 들어갑니다)' : ''}</small>}
    </div>
  );
}

/** 아이디어 카드 (중요 · 적용함 · 보관): 핵심 3줄 + 할 일 */
export function IdeaCard({ idea }) {
  const { store, setStore, now, go, openCat, areasAllowed } = useCtx();
  const organize = useOrganize();
  const [copied, setCopied] = useState(false);
  const [edit, setEdit] = useState(false);
  const [tagIn, setTagIn] = useState('');
  const stage = stageOf(idea), P = pointsOf(idea);
  const setPts = pts => upd({ points: pts, minutes: undefined });
  const addTag = () => { const t = tagIn.trim().replace(/^#/, '').replace(/\s+/g, ''); if (t && !idea.tags.includes(t)) upd({ tags: [...idea.tags, t].slice(0, 8) }); setTagIn(''); };
  const asText = () => ideaText(idea, t => TYPES[t] || t);
  const copy = async () => { try { await navigator.clipboard.writeText(asText()); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { window.prompt('복사할 내용', asText()); } };
  const upd = p => setStore(s => ({ ...s, ideas: (s.ideas || []).map(i => (i.id === idea.id ? { ...i, ...p } : i)) }));
  const updAct = (id, p) => upd({ actions: idea.actions.map(a => (a.id === id ? { ...a, ...p } : a)) });
  const apply = id => setStore(s => applyAction(s, idea.id, id, now));
  const goals = contextOf(store, [...(areasAllowed || 'P')]).goals;
  const cats = [...new Set(CATS.filter(r => r.a === idea.area && r.cat !== '목표 관리').map(r => r.cat))];
  const del = () => window.confirm(`"${idea.title}" 아이디어를 지울까요? (이미 적용한 일정 · 할 일은 그대로 남습니다)`) && setStore(s => ({ ...s, ideas: (s.ideas || []).filter(i => i.id !== idea.id) }));
  const where = a => { if (!a.done) return null; const [k, x] = a.done.ref.split(':');
    return k === 'event' ? <button className="linkish" onClick={() => go('home')}>캘린더에서 보기</button>
      : k === 'goal' ? <button className="linkish" onClick={() => { const [ar, c] = x.split('|'); openCat(ar, c); }}>목표에서 보기</button>
      : k === 'check' ? <button className="linkish" onClick={() => go('check')}>체크리스트에서 보기</button> : null; };
  const left = idea.actions.filter(a => !a.done && a.type !== 'note');
  return (
    <article className={`ib-card s-${stage}`} style={{ '--ac': `var(${AREAS[idea.area]?.v || '--a1'})` }}>
      <div className="ib-h">
        <input className="ib-title" value={idea.title} onChange={e => upd({ title: e.target.value })} aria-label="아이디어 제목" />
        <span className={`tag ib-st ${stage}`}>{STAGES[stage]}</span>
      </div>
      <div className="ib-meta">
        <small className="muted">{fmtAt(idea.at)} · {idea.src === 'voice' ? `녹음${idea.sec ? ` ${Math.max(1, Math.round(idea.sec / 60))}분` : ''}` : '글'}</small>
        <select value={idea.area} onChange={e => upd({ area: e.target.value, cat: '' })} aria-label="영역">{[...(areasAllowed || 'P')].map(a => <option key={a} value={a}>{AREAS[a].n}</option>)}</select>
        <select value={idea.cat} onChange={e => upd({ cat: e.target.value })} aria-label="카테고리"><option value="">카테고리 없음</option>{cats.map(c => <option key={c} value={c}>{c}</option>)}</select>
        {idea.tags.map(t => <span key={t} className="ib-tag">#{t}<button className="ib-tx" onClick={() => upd({ tags: idea.tags.filter(x => x !== t) })} aria-label={`${t} 태그 빼기`}>×</button></span>)}
        <input className="ib-tagin" value={tagIn} onChange={e => setTagIn(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} onBlur={addTag} placeholder="+ 태그" aria-label="태그 추가" />
      </div>
      <div className="ib-pts"><div className="ib-ah"><b className="ib-lb">핵심</b>{!idea.aiBusy && <button className="linkish" onClick={() => { if (!edit && !idea.points?.length && P.length) setPts(P); if (edit) setPts((idea.points || []).map(x => x.trim()).filter(Boolean)); setEdit(v => !v); }}>{edit ? '다 고쳤어요' : '고치기'}</button>}</div>
        {idea.aiBusy ? <p className="muted">AI 가 핵심 3줄 · 할 일로 정리하는 중…</p>
          : edit ? <div className="ib-pe">{(idea.points || []).map((p, i) => (
              <div key={i} className="ib-pe-r"><input value={p} onChange={e => setPts(idea.points.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`핵심 ${i + 1}`} />
                <button className="tl-del" onClick={() => setPts(idea.points.filter((_, j) => j !== i))} aria-label="이 줄 빼기">×</button></div>))}
              <button className="btn sm" onClick={() => setPts([...(idea.points || []), ''])}>+ 줄 추가</button></div>
          : P.filter(Boolean).length ? <ul>{P.filter(Boolean).map((p, i) => <li key={i}>{p}</li>)}</ul>
          : <p className="muted ib-sum">{idea.text.length > 300 ? `${idea.text.slice(0, 300)}…` : idea.text}</p>}
        {idea.aiErr && !idea.aiBusy && <small className="ib-err">AI 정리를 못 했어요: {idea.aiErr}</small>}
      </div>
      <div className="ib-acts">
        <div className="ib-ah"><b className="ib-lb">할 일</b>{left.length > 1 && <button className="btn sm primary" onClick={() => left.forEach(a => apply(a.id))}>모두 적용 ({left.length})</button>}</div>
        {idea.actions.map(a => <ActRow key={a.id} {...{ idea, a, goals, upd, updAct, apply, where }} />)}
        {!idea.actions.length && <p className="muted">{idea.ai ? 'AI 가 바로 할 일을 찾지 못했어요. "+ 할 일"로 직접 넣어 주세요' : '"AI 로 정리"를 누르거나 "+ 할 일"로 직접 넣어 주세요'}</p>}
      </div>
      {(P.length > 0 || idea.ai) && <details className="ib-raw"><summary>받아 적은 글 그대로 보기</summary><p>{idea.text}</p></details>}
      <div className="ib-foot">
        <button className="btn sm" onClick={() => upd({ actions: [...idea.actions, { id: uid(), type: 'event', title: '', date: iso(now), time: '', cycle: '', goal: '', detail: '', done: null }] })}>+ 할 일</button>
        <button className="btn sm" disabled={!!idea.aiBusy} onClick={() => organize(idea)}>{idea.aiBusy ? '정리 중…' : idea.ai ? 'AI 로 다시 정리' : 'AI 로 정리'}</button>
        <button className="btn sm" onClick={copy}>{copied ? '복사했습니다' : '복사'}</button>
        <WishPick idea={idea} />
        <span className="grow-r" />
        <button className="linkish" onClick={() => upd({ status: stage === 'archived' ? (idea.actions.some(a => a.done) ? 'applied' : 'key') : 'archived' })}>{stage === 'archived' ? '꺼내기' : '보관'}</button>
        <button className="tl-del" onClick={del}>삭제</button>
      </div>
    </article>
  );
}

/** 스침 한 줄 (정리 대기 · 확인함 · 버림) */
function MergePick({ idea, onDone }) {
  const { store, setStore } = useCtx();
  const keys = (store.ideas || []).filter(i => stageOf(i) === 'key' && i.id !== idea.id);
  if (!keys.length) return null;
  return (
    <select className="ib-merge" value="" onChange={e => { if (e.target.value) { setStore(s => mergeIdea(s, idea.id, e.target.value)); onDone?.(); } }} aria-label="중요 카드에 합치기">
      <option value="">합치기…</option>{keys.map(k => <option key={k.id} value={k.id}>{k.title}</option>)}
    </select>
  );
}

function InboxRow({ idea }) {
  const { setStore } = useCtx();
  const organize = useOrganize();
  const stage = stageOf(idea);
  const upd = p => setStore(s => ({ ...s, ideas: (s.ideas || []).map(i => (i.id === idea.id ? { ...i, ...p } : i)) }));
  const del = () => setStore(s => ({ ...s, ideas: (s.ideas || []).filter(i => i.id !== idea.id) }));
  const left = stage === 'dropped' && idea.droppedAt ? Math.max(0, 30 - Math.floor((Date.now() - new Date(idea.droppedAt)) / 864e5)) : null;
  return (
    <div className={`ib-row s-${stage}`}>
      <small className="ib-rt">{fmtAt(idea.at)}{idea.src === 'voice' ? ' · 음성' : ''}</small>
      <span className="ib-rx">{idea.text}</span>
      <span className="ib-rb">
        {stage === 'inbox' && <><button className="btn sm ok" onClick={() => upd({ status: 'seen' })}>체크</button><button className="btn sm star" onClick={() => organize(idea)}>중요</button><MergePick idea={idea} /><WishPick idea={idea} /><button className="btn sm" onClick={() => upd({ status: 'dropped', droppedAt: new Date().toISOString() })}>버리기</button></>}
        {stage === 'seen' && <><button className="btn sm star" onClick={() => organize(idea)}>중요로 올리기</button><MergePick idea={idea} /><WishPick idea={idea} /><button className="linkish" onClick={() => upd({ status: 'inbox' })}>정리 대기로</button><button className="btn sm" onClick={() => upd({ status: 'dropped', droppedAt: new Date().toISOString() })}>버리기</button></>}
        {stage === 'dropped' && <><small className="muted">{left} 일 뒤 삭제</small><button className="btn sm" onClick={() => upd({ status: 'inbox', droppedAt: undefined })}>되살리기</button><button className="tl-del" onClick={del}>지금 삭제</button></>}
      </span>
    </div>
  );
}

/** 정리하기: 스침을 한 장씩 → 체크 · 중요 · 나중에 · 버리기 */
export function Triage({ onClose }) {
  const { store, setStore, now, go } = useCtx();
  const organize = useOrganize();
  const today = iso(now);
  const [ids] = useState(() => toTriage(store, today).map(i => i.id));
  const [n, setN] = useState(0);
  const [res, setRes] = useState({ ok: 0, star: 0, merge: 0, wish: 0, later: 0, drop: 0 });
  const [starred, setStarred] = useState([]);
  const [pick, setPick] = useState(false);
  const [wpick, setWpick] = useState(false);
  const { areasAllowed } = useCtx();
  const wishes = (store.wishes || []).filter(w => w.stage < 5);
  const keys = (store.ideas || []).filter(i => stageOf(i) === 'key');
  const cur = n < ids.length ? (store.ideas || []).find(i => i.id === ids[n]) : null;
  const upd = (id, p) => setStore(s => ({ ...s, ideas: (s.ideas || []).map(i => (i.id === id ? { ...i, ...p } : i)) }));
  let act = k => {
    if (!cur) return;
    if (k === 'ok') upd(cur.id, { status: 'seen' });
    if (k === 'later') upd(cur.id, { later: today });
    if (k === 'drop') upd(cur.id, { status: 'dropped', droppedAt: new Date().toISOString() });
    if (k === 'star') { setStarred(v => [...v, cur.id]); organize(cur); }
    if (k.startsWith('merge:')) { setStore(s => mergeIdea(s, cur.id, k.slice(6))); k = 'merge'; }
    if (k.startsWith('wish:')) { const wid = k.slice(5); setStore(s => ideaToWish(s, cur, wid === 'new' ? '' : wid, (areasAllowed || 'P')[0])); k = 'wish'; }
    setPick(false); setWpick(false);
    setRes(v => ({ ...v, [k]: (v[k] || 0) + 1 }));
    setN(v => v + 1);
  };
  useEffect(() => { if (n < ids.length && !cur) setN(v => v + 1); }, [n, cur, ids.length]);   // 그사이 지운 것은 건너뜀
  useEffect(() => {
    if (!cur) return undefined;
    const k = e => { if (pick || wpick || e.target.closest('input, textarea, select')) return; const m = { 1: 'ok', 2: 'star', 3: 'later', 4: 'drop' }[e.key]; if (m) act(m); else if (e.key === '5' && keys.length) setPick(true); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  });
  const stars = starred.map(id => (store.ideas || []).find(i => i.id === id)).filter(Boolean);
  return (
    <Popup title="정리하기" sub="스친 생각을 한 장씩 보고 버튼 하나로 정리합니다" onClose={onClose}>
      <div className="ib-tri">
        <div className="ib-tri-h"><div className="pbar"><i style={{ width: `${ids.length ? Math.min(n, ids.length) / ids.length * 100 : 100}%` }} /></div><small className="muted">{cur ? `${n + 1} / ${ids.length}` : '완료'}</small></div>
        {cur ? <>
          <div className="ib-tri-card"><small className="muted">{fmtAt(cur.at)} · {cur.src === 'voice' ? `음성${cur.sec ? ` ${cur.sec}초` : ''}` : '글'}</small><p>{cur.text}</p></div>
          <div className="ib-tri-b">
            <button className="btn ok" onClick={() => act('ok')}>체크 (봤음)</button>
            <button className="btn star" onClick={() => act('star')}>중요로 올리기</button>
            <button className="btn" onClick={() => act('later')}>나중에</button>
            <button className="btn" onClick={() => act('drop')}>버리기</button>
            {keys.length > 0 && <button className={`btn ib-tri-m ${pick ? 'on' : ''}`} onClick={() => { setPick(v => !v); setWpick(false); }}>중요 카드에 합치기</button>}
            <button className={`btn ib-tri-m ws-tri ${wpick ? 'on' : ''}`} onClick={() => { setWpick(v => !v); setPick(false); }}>숙원으로 보내기</button>
          </div>
          {wpick && <ul className="ib-tri-pick"><li><button className="btn sm primary" onClick={() => act('wish:new')}>+ 새 숙원으로 만들기</button></li>
            {wishes.map(w => <li key={w.id}><button className="btn sm" onClick={() => act(`wish:${w.id}`)}>{w.title}</button><small className="muted">{['', '씨앗', '탐색', '구체화', '준비'][w.stage]} · 자료로 붙임</small></li>)}</ul>}
          {pick && <ul className="ib-tri-pick">{keys.map(k => <li key={k.id}><button className="btn sm" onClick={() => act(`merge:${k.id}`)}>{k.title}</button><small className="muted">{(k.tags || []).map(t => `#${t}`).join(' ')}</small></li>)}</ul>}
          <small className="muted">체크: 본 것으로 남김 · 중요: AI 가 핵심 3줄 · 할 일로 정리 · 나중에: 내일 다시 · 버리기: 30일 뒤 삭제 · 합치기: 이미 있는 중요 카드의 핵심에 한 줄로 · 숙원으로: 언젠가 할 일로 모아 두기 · 키보드 1~5</small>
        </> : <div className="ib-tri-done">
          <b>{ids.length ? '정리 끝' : '정리할 스침이 없습니다'}</b>
          {ids.length > 0 && <span>{[['ok', '체크'], ['star', '중요'], ['merge', '합침'], ['wish', '숙원으로'], ['later', '나중에'], ['drop', '버리기']].filter(([k]) => res[k]).map(([k, t]) => `${t} ${res[k]}`).join(' · ') || '처리한 것 없음'}</span>}
          {stars.length > 0 && <ul className="ib-tri-s">{stars.map(i => <li key={i.id}><span className="tag ib-st key">중요</span>{i.title}<small className="muted">{i.aiBusy ? ' · AI 정리 중…' : i.aiErr ? ' · AI 정리 못 함' : i.ai ? ' · 정리됨' : ''}</small></li>)}</ul>}
          <div className="ib-tri-b">{stars.length > 0 && <button className="btn primary" onClick={() => { onClose(); go('ideas'); }}>중요 카드에서 할 일 적용하기</button>}<button className="btn" onClick={onClose}>닫기</button></div>
        </div>}
      </div>
    </Popup>
  );
}

/** 정리 알림 설정 (밤 11시 기본) */
function RemindSet() {
  const { store, setStore } = useCtx();
  const R = ideaRemindOf(store);
  const set = p => setStore(s => ({ ...s, notify: { ...(s.notify || {}), idea: { ...R, ...p } } }));
  return (
    <span className="ib-rem">
      <label><input type="checkbox" checked={R.on} onChange={e => set({ on: e.target.checked })} /> 정리 알림</label>
      <input type="time" value={R.time} onChange={e => e.target.value && set({ time: e.target.value })} disabled={!R.on} aria-label="정리 알림 시각" />
      <small className="muted">정리할 스침이 있을 때만</small>
    </span>
  );
}

const GUIDE = [['스치면 바로 적기', '어느 화면에서든 오른쪽 아래 버튼 → 한 줄 또는 짧은 녹음. AI 없이 바로 저장됩니다.'],
  ['하루 한 번 정리', '밤 11시 알림 → 카드를 넘기며 체크 · 중요 · 나중에 · 버리기.'],
  ['중요한 것은 실행으로', '중요로 올리면 AI 가 핵심 3줄 · 할 일로 정리 → 캘린더 · 목표 · 체크리스트에 바로 적용.']];

/** 아이디어 뱅크 화면 */
export default function IdeaBank() {
  const { store, setStore, now } = useCtx();
  const today = iso(now);
  const [tri, setTri] = useState(false);
  const [f, setF] = useState('seen');
  const [q, setQ] = useState('');
  const [moreIn, setMoreIn] = useState(false);
  const [tag, setTag] = useState('');
  const all = store.ideas || [];
  const S = ideaStats(store, today);
  useEffect(() => { const k = purgeDropped(all); if (k.length !== all.length) setStore(s => ({ ...s, ideas: purgeDropped(s.ideas || []) })); }, []);   // 버린 지 30일 지난 것 정리
  const by = st => all.filter(i => stageOf(i) === st);
  const inbox = by('inbox').sort((a, b) => b.at.localeCompare(a.at));
  const keys = by('key');
  const todos = all.filter(i => ['key', 'applied'].includes(stageOf(i))).flatMap(i => i.actions.filter(a => !a.done && a.type !== 'note').map(a => ({ i, a })));
  const qq = q.trim().toLowerCase();
  const past = qq ? all.filter(i => `${i.title} ${i.summary} ${i.text} ${i.tags.join(' ')} ${(i.points || []).join(' ')}`.toLowerCase().includes(qq)) : by(f);
  const N = { seen: by('seen').length, applied: by('applied').length, archived: by('archived').length, dropped: by('dropped').length };
  const tags = tagCounts(store);
  const tagged = tag ? all.filter(i => stageOf(i) !== 'dropped' && (i.tags || []).includes(tag)) : [];
  const jump = id => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <div className="catv ib">
      <header className="page-h"><h1>아이디어 뱅크</h1><p className="muted">스친 생각은 한 줄로 남기고, 하루 한 번 정리해서, 중요한 것만 핵심 3줄 · 할 일로 실행합니다</p></header>
      {!store.ideaGuided && <section className="panel ib-guide" aria-label="아이디어 뱅크 사용법">
        <h2>이렇게 써 보세요</h2>
        <ol>{GUIDE.map(([t, d]) => <li key={t}><b>{t}</b><span className="muted">{d}</span></li>)}</ol>
        <button className="btn primary" onClick={() => setStore(s => ({ ...s, ideaGuided: true }))}>알겠어요, 시작하기</button>
      </section>}
      <section className="panel"><Capture /></section>
      <div className="ib-stats">
        {[['오늘 스침', S.today, 'ib-in'], ['정리 대기', S.inbox, 'ib-in'], ['중요', S.key, 'ib-key'], ['할 일 대기', S.todo, 'ib-todo']].map(([t, v, id]) => (
          <button key={t} onClick={() => jump(id)}><b>{v}</b><span>{t}</span></button>))}
      </div>
      {tags.length > 0 && <div className="ib-tags" role="group" aria-label="태그로 모아 보기"><small className="muted">태그</small>
        {tags.slice(0, 20).map(([t, c]) => <button key={t} aria-pressed={tag === t} onClick={() => setTag(tag === t ? '' : t)}>#{t} <small>{c}</small></button>)}</div>}
      {tag && <section className="panel ib-tagv">
        <div className="csum-h"><h2>#{tag} {tagged.length}</h2><span className="muted">이 태그가 붙은 아이디어 모두 (단계 상관없이)</span><button className="btn sm grow-r" onClick={() => setTag('')}>닫기</button></div>
        <div className="ib-list">{tagged.map(i => (['inbox', 'seen'].includes(stageOf(i)) ? <InboxRow key={i.id} idea={i} /> : <IdeaCard key={i.id} idea={i} />))}</div>
      </section>}

      <section className="panel" id="ib-in">
        <div className="csum-h"><h2>정리할 스침 {S.inbox}</h2><RemindSet /><button className="btn primary grow-r" disabled={!toTriage(store, today).length} onClick={() => setTri(true)}>정리 시작</button></div>
        {inbox.length ? <div className="ib-rows">{(moreIn ? inbox : inbox.slice(0, 3)).map(i => <InboxRow key={i.id} idea={i} />)}
          {inbox.length > 3 && <button className="linkish" onClick={() => setMoreIn(v => !v)}>{moreIn ? '접기' : `${inbox.length - 3}개 더 보기`}</button>}</div>
          : <p className="muted">정리할 스침이 없습니다. 생각이 스치면 위에 한 줄 적어 두세요.</p>}
        {inbox.length > 0 && !toTriage(store, today).length && <small className="muted">오늘 "나중에"로 넘긴 것만 남았습니다. 내일 다시 나옵니다.</small>}
      </section>

      <section className="panel" id="ib-key">
        <div className="csum-h"><h2>중요 {keys.length}</h2><span className="muted">핵심 3줄 + 할 일 · 할 일을 모두 적용하면 "적용함"으로 옮겨집니다</span></div>
        {keys.length ? <div className="ib-list">{keys.map(i => <IdeaCard key={i.id} idea={i} />)}</div> : <p className="muted">중요로 올린 아이디어가 없습니다. 정리할 때 "중요로 올리기"를 눌러 보세요.</p>}
      </section>

      <section className="panel" id="ib-todo">
        <div className="csum-h"><h2>할 일 대기 {todos.length}</h2><span className="muted">중요 아이디어에서 아직 적용하지 않은 할 일</span></div>
        {todos.length ? <ul className="ib-todos">{todos.map(({ i, a }) => (
          <li key={a.id}><span className="tag">{TYPES[a.type]}</span><span className="grow">{a.title || '(제목 없음)'}<small className="muted"> · {i.title}{a.date ? ` · ${a.date}${a.time ? ` ${a.time}` : ''}` : ''}</small></span>
            <button className="btn sm primary" disabled={!a.title.trim()} onClick={() => setStore(s => applyAction(s, i.id, a.id, now))}>적용</button></li>))}</ul>
          : <p className="muted">적용할 할 일이 없습니다.</p>}
      </section>

      <section className="panel">
        <div className="csum-h"><h2>지난 기록</h2>
          {!qq && <div className="chips" role="group" aria-label="보기">{['seen', 'applied', 'archived', 'dropped'].map(k => <button key={k} aria-pressed={f === k} onClick={() => setF(k)}>{STAGES[k]} {N[k]}</button>)}</div>}
          <input className="ib-q" value={q} onChange={e => setQ(e.target.value)} placeholder="찾기 (전체 · 제목 · 내용 · 태그)" aria-label="아이디어 찾기" /></div>
        {past.length ? <div className="ib-list">{past.map(i => (['inbox', 'seen', 'dropped'].includes(stageOf(i)) ? <InboxRow key={i.id} idea={i} /> : <IdeaCard key={i.id} idea={i} />))}</div>
          : <p className="muted ib-empty">{qq ? '찾는 아이디어가 없습니다.' : f === 'dropped' ? '버린 것이 없습니다. 버린 것은 30일 뒤 지워집니다.' : '여기에 해당하는 아이디어가 없습니다.'}</p>}
      </section>
      {tri && <Triage onClose={() => setTri(false)} />}
    </div>
  );
}

/** 대시보드 칸: 오늘 스친 생각 · 정리 대기 · 빠른 입력 · 정리하기 */
export function IdeaHome() {
  const { store, now, go } = useCtx();
  const [tri, setTri] = useState(false);
  const today = iso(now), S = ideaStats(store, today), n = toTriage(store, today).length;
  return (
    <section className="panel ib-home" aria-label="아이디어">
      <div className="csum-h"><h2>아이디어</h2><span className="muted">오늘 스침 {S.today} · 정리 대기 {S.inbox} · 중요 {S.key}{S.todo ? ` · 할 일 대기 ${S.todo}` : ''}</span>
        <span className="ib-hb grow-r"><button className="btn sm primary" disabled={!n} onClick={() => setTri(true)}>정리하기{n ? ` (${n})` : ''}</button><button className="btn sm" onClick={() => go('ideas')}>아이디어 뱅크</button></span></div>
      <Capture compact />
      {tri && <Triage onClose={() => setTri(false)} />}
    </section>
  );
}

/** 어느 화면에서든 바로 기록: 오른쪽 아래 버튼 → 팝업 (한 줄 · 녹음) */
export function IdeaFab() {
  const { store, go } = useCtx();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(null);
  const idea = saved && (store.ideas || []).find(i => i.id === saved);
  return (<>
    <button className="ib-fab" onClick={() => { setSaved(null); setOpen(true); }} aria-label="스친 생각 기록하기" title="스친 생각 기록하기 (아이디어 뱅크)">{MIC(24)}</button>
    {open && <Popup wide title="스친 생각 기록" sub="한 줄 또는 녹음 → 바로 저장됩니다. 정리는 하루 한 번 (밤 11시 알림)" onClose={() => setOpen(false)}
      actions={<button className="btn sm" onClick={() => { setOpen(false); go('ideas'); }}>아이디어 뱅크</button>}>
      <Capture compact auto onSaved={setSaved} />
      {idea && stageOf(idea) === 'key' && <IdeaCard idea={idea} />}
    </Popup>}
  </>);
}
