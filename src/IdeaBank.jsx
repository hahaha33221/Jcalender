import React, { useEffect, useRef, useState } from 'react';
import { AREAS, CATS, iso } from './data.js';
import { Popup, useCtx } from './shared.jsx';
import { API_BASE } from './serverSync.js';
import { CYC, TYPES, applyAction, contextOf, findGoal, newIdea, uid, withAi } from './ideas.js';

/* 아이디어 뱅크: 떠오른 아이디어를 녹음(또는 글)으로 남기면 → 서버가 받아 적고(server/ideas.mjs) → AI 가 정리 · 다음 행동으로 나눔
   → 행동마다 "적용"을 누르면 캘린더 · 목표 To do · 체크리스트 · 새 목표로 바로 들어감 (src/ideas.js)
   - 어느 화면에서든 오른쪽 아래 마이크 버튼(IdeaFab)으로 바로 녹음
   - 녹음 파일은 서버에서 받아 적은 뒤 버림. 저장되는 것은 글(원문) · 정리 · 행동뿐 */
const MAX_SEC = 300;
const MIME = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];
const fmtSec = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const fmtAt = s => { const d = new Date(s); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** 녹음 → 받아쓰기 → 저장 → AI 정리. onSaved(id) */
function useCapture(onSaved) {
  const { store, setStore, sync, areasAllowed, now } = useCtx();
  const [st, setSt] = useState({ phase: 'idle', sec: 0, msg: '', bad: false });
  const rec = useRef(null);
  const storeRef = useRef(store); storeRef.current = store;
  useEffect(() => () => { rec.current?.stream.getTracks().forEach(t => t.stop()); clearInterval(rec.current?.timer); }, []);

  /** 글 → 저장하고 AI 로 정리 */
  const save = async (text, src) => {
    const area = (areasAllowed || 'P')[0] || 'P';
    const idea = newIdea(text, src, area);
    setStore(s => ({ ...s, ideas: [idea, ...(s.ideas || [])] }));
    onSaved?.(idea.id);
    await organize(idea);
  };
  const organize = async idea => {
    setSt(v => ({ ...v, phase: 'ai', msg: 'AI 가 아이디어를 정리하고 바로 할 일로 나누는 중… (5~20초)', bad: false }));
    try {
      const r = await sync.request('/api/ideas/structure', { method: 'POST', body: { text: idea.text, today: iso(now), ...contextOf(storeRef.current, [...(areasAllowed || 'P')]) } });
      setStore(s => ({ ...s, ideas: (s.ideas || []).map(i => (i.id === idea.id ? withAi(i, r) : i)) }));
      setSt({ phase: 'idle', sec: 0, msg: `정리했습니다 · 아래에서 "적용"을 누르면 바로 들어갑니다`, bad: false });
    } catch (e) { setSt({ phase: 'idle', sec: 0, msg: `아이디어는 저장했습니다. AI 정리는 못 했어요: ${e.status === 404 ? '서버 업데이트가 필요합니다 (update.sh)' : e.message}`, bad: true }); }
  };
  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return setSt({ phase: 'idle', sec: 0, msg: '이 브라우저는 녹음을 지원하지 않습니다. 글로 적어 주세요', bad: true });
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { return setSt({ phase: 'idle', sec: 0, msg: '마이크를 쓸 수 없습니다. 브라우저(휴대폰) 설정에서 마이크를 허용해 주세요', bad: true }); }
    const mimeType = MIME.find(m => MediaRecorder.isTypeSupported?.(m)) || '';
    const mr = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32000 });
    const chunks = [];
    mr.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = () => upload(new Blob(chunks, { type: (mr.mimeType || mimeType || 'audio/webm').split(';')[0] }));
    const t0 = Date.now();
    const timer = setInterval(() => { const sec = Math.round((Date.now() - t0) / 1000); setSt(v => ({ ...v, sec })); if (sec >= MAX_SEC) stop(); }, 500);
    rec.current = { mr, stream, timer };
    mr.start(1000);
    setSt({ phase: 'rec', sec: 0, msg: '', bad: false });
  };
  const stop = (cancel = false) => {
    const r = rec.current; if (!r) return;
    clearInterval(r.timer); rec.current = null;
    if (cancel) r.mr.onstop = null;
    try { r.mr.stop(); } catch { /* 이미 멈춤 */ }
    r.stream.getTracks().forEach(t => t.stop());
    setSt(v => ({ ...v, phase: cancel ? 'idle' : 'stt', msg: cancel ? '녹음을 취소했습니다' : '받아 적는 중… (녹음 길이에 따라 5~30초)', bad: false }));
  };
  const upload = async blob => {
    try {
      const r = await fetch(`${API_BASE}/api/ideas/voice`, { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm', Authorization: `Bearer ${sync.conf.token}` }, body: blob });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(r.status === 404 ? '서버 업데이트가 필요합니다 (VPS 에서 update.sh)' : j.error || `받아쓰기 오류 (${r.status})`), { status: r.status });
      await save(j.text, 'voice');
    } catch (e) { setSt({ phase: 'idle', sec: 0, msg: `${e.message} — 말한 내용을 글로 적어도 됩니다`, bad: true }); }
  };
  return { st, start, stop, save, organize };
}

/** 녹음 · 글로 적기 */
function Capture({ onSaved, compact }) {
  const { st, start, stop, save } = useCapture(onSaved);
  const [text, setText] = useState('');
  const busy = st.phase === 'stt' || st.phase === 'ai';
  return (
    <div className={`ib-cap ${compact ? 'compact' : ''}`}>
      <div className="ib-rec">
        {st.phase === 'rec' ? <>
          <button className="ib-mic on" onClick={() => stop()} aria-label="녹음 끝내기"><span className="ib-sq" /></button>
          <div><b className="ib-time">{fmtSec(st.sec)}</b><small className="muted"> / {fmtSec(MAX_SEC)} · 말하고 나서 누르면 받아 적어요</small>
            <div><button className="linkish" onClick={() => stop(true)}>취소</button></div></div>
        </> : <>
          <button className="ib-mic" onClick={start} disabled={busy} aria-label="녹음 시작"><svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
          <div><b>{busy ? (st.phase === 'stt' ? '받아 적는 중…' : 'AI 정리 중…') : '눌러서 말하기'}</b>
            <small className="muted"> 떠오른 아이디어를 편하게 말하세요 · 최대 5분</small></div>
        </>}
      </div>
      <form className="ib-text" onSubmit={e => { e.preventDefault(); if (text.trim().length >= 4) { save(text.trim(), 'text'); setText(''); } }}>
        <textarea rows={compact ? 2 : 2} value={text} onChange={e => setText(e.target.value)} placeholder="또는 글로 적기 (예: 주말마다 동네 러닝 모임을 만들면 꾸준히 뛸 수 있을 것 같아)" aria-label="아이디어 글로 적기" disabled={busy || st.phase === 'rec'} />
        <button className="btn primary" disabled={busy || text.trim().length < 4}>저장 · 정리</button>
      </form>
      {st.msg && <p className={st.bad ? 'banner' : 'banner ok'} role="status">{st.msg}</p>}
    </div>
  );
}

/** 아이디어 카드: 정리 · 다음 행동(적용) */
export function IdeaCard({ idea, open: open0 = false }) {
  const { store, setStore, now, go, openCat, areasAllowed, sync } = useCtx();
  const [open, setOpen] = useState(open0);
  const [busy, setBusy] = useState('');
  const upd = p => setStore(s => ({ ...s, ideas: (s.ideas || []).map(i => (i.id === idea.id ? { ...i, ...p } : i)) }));
  const updAct = (id, p) => upd({ actions: idea.actions.map(a => (a.id === id ? { ...a, ...p } : a)) });
  const apply = id => setStore(s => applyAction(s, idea.id, id, now));
  const goals = contextOf(store, [...(areasAllowed || 'P')]).goals;
  const cats = [...new Set(CATS.filter(r => r.a === idea.area && r.cat !== '목표 관리').map(r => r.cat))];
  const reAi = async () => {
    setBusy('ai');
    try { const r = await sync.request('/api/ideas/structure', { method: 'POST', body: { text: idea.text, today: iso(now), ...contextOf(store, [...(areasAllowed || 'P')]) } }); setStore(s => ({ ...s, ideas: (s.ideas || []).map(i => (i.id === idea.id ? withAi(i, r) : i)) })); }
    catch (e) { window.alert(e.message); }
    setBusy('');
  };
  const del = () => window.confirm(`"${idea.title}" 아이디어를 지울까요? (이미 적용한 일정 · 할 일은 그대로 남습니다)`) && setStore(s => ({ ...s, ideas: (s.ideas || []).filter(i => i.id !== idea.id) }));
  const where = a => { if (!a.done) return null; const [k, x, y] = a.done.ref.split(':');
    return k === 'event' ? <button className="linkish" onClick={() => go('home')}>캘린더에서 보기</button>
      : k === 'goal' ? <button className="linkish" onClick={() => { const [ar, c] = x.split('|'); openCat(ar, c); }}>목표에서 보기</button>
      : k === 'check' ? <button className="linkish" onClick={() => go('check')}>체크리스트에서 보기</button> : null; };
  const left = idea.actions.filter(a => !a.done && a.type !== 'note');
  return (
    <article className={`ib-card s-${idea.status}`} style={{ '--ac': `var(${AREAS[idea.area]?.v || '--a1'})` }}>
      <div className="ib-h">
        <input className="ib-title" value={idea.title} onChange={e => upd({ title: e.target.value })} aria-label="아이디어 제목" />
        <span className={`tag ib-st ${idea.status}`}>{idea.status === 'applied' ? '적용함' : idea.status === 'archived' ? '보관' : '새 아이디어'}</span>
      </div>
      <div className="ib-meta">
        <small className="muted">{fmtAt(idea.at)} · {idea.src === 'voice' ? '녹음' : '글'}</small>
        <select value={idea.area} onChange={e => upd({ area: e.target.value, cat: '' })} aria-label="영역">{[...(areasAllowed || 'P')].map(a => <option key={a} value={a}>{AREAS[a].n}</option>)}</select>
        <select value={idea.cat} onChange={e => upd({ cat: e.target.value })} aria-label="카테고리"><option value="">카테고리 없음</option>{cats.map(c => <option key={c} value={c}>{c}</option>)}</select>
        {idea.tags.map(t => <span key={t} className="ib-tag">#{t}</span>)}
      </div>
      {idea.summary ? <p className="ib-sum">{idea.summary}</p> : <p className="muted ib-sum">{idea.text}</p>}
      {idea.summary && <details className="ib-raw" open={open} onToggle={e => setOpen(e.target.open)}><summary>말한 그대로 보기</summary><p>{idea.text}</p></details>}
      <div className="ib-acts">
        <div className="ib-ah"><b>바로 할 일</b>{left.length > 1 && <button className="btn sm primary" onClick={() => left.forEach(a => apply(a.id))}>모두 적용 ({left.length})</button>}</div>
        {idea.actions.map(a => (
          <div key={a.id} className={`ib-act ${a.done ? 'done' : ''}`}>
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
            {a.detail && <small className="muted ib-det">{a.detail}{a.type === 'todo' && a.goal && !findGoal(store, a.goal) ? ' · (목표를 찾을 수 없어 체크리스트로 들어갑니다)' : ''}</small>}
          </div>))}
        {!idea.actions.length && <p className="muted">{idea.ai ? 'AI 가 바로 할 일을 찾지 못했어요. 직접 넣어 주세요' : '아직 정리 전입니다. "AI 로 정리"를 누르거나 직접 넣어 주세요'}</p>}
      </div>
      <div className="ib-foot">
        <button className="btn sm" onClick={() => upd({ actions: [...idea.actions, { id: uid(), type: 'event', title: '', date: iso(now), time: '', cycle: '', goal: '', detail: '', done: null }] })}>+ 할 일</button>
        <button className="btn sm" disabled={busy === 'ai'} onClick={reAi}>{busy === 'ai' ? '정리 중…' : idea.ai ? 'AI 로 다시 정리' : 'AI 로 정리'}</button>
        <span className="grow-r" />
        <button className="linkish" onClick={() => upd({ status: idea.status === 'archived' ? (idea.actions.some(a => a.done) ? 'applied' : 'new') : 'archived' })}>{idea.status === 'archived' ? '꺼내기' : '보관'}</button>
        <button className="tl-del" onClick={del}>삭제</button>
      </div>
    </article>
  );
}

/** 아이디어 뱅크 화면 */
export default function IdeaBank() {
  const { store } = useCtx();
  const [f, setF] = useState('new');
  const [q, setQ] = useState('');
  const all = store.ideas || [];
  const N = { all: all.filter(i => i.status !== 'archived').length, new: all.filter(i => i.status === 'new').length, applied: all.filter(i => i.status === 'applied').length, archived: all.filter(i => i.status === 'archived').length };
  const list = all.filter(i => (f === 'all' ? i.status !== 'archived' : i.status === f))
    .filter(i => !q.trim() || `${i.title} ${i.summary} ${i.text} ${i.tags.join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="catv ib">
      <header className="page-h"><h1>아이디어 뱅크</h1><p className="muted">떠오른 아이디어를 말로 남기면 AI 가 정리하고, 바로 할 일로 나눠 캘린더 · 목표 · 체크리스트에 넣어 드립니다</p></header>
      <section className="panel"><Capture onSaved={() => setF('new')} /></section>
      <div className="ib-filter">
        <div className="chips" role="group" aria-label="보기">{[['new', '새 아이디어'], ['applied', '적용함'], ['all', '전체'], ['archived', '보관']].map(([k, n]) => <button key={k} aria-pressed={f === k} onClick={() => setF(k)}>{n} {N[k]}</button>)}</div>
        <input className="ib-q" value={q} onChange={e => setQ(e.target.value)} placeholder="찾기 (제목 · 내용 · 태그)" aria-label="아이디어 찾기" />
      </div>
      {list.length ? <div className="ib-list">{list.map(i => <IdeaCard key={i.id} idea={i} />)}</div>
        : <p className="muted ib-empty">{all.length ? '여기에 해당하는 아이디어가 없습니다.' : '아직 아이디어가 없습니다. 위의 마이크를 눌러 말해 보세요.'}</p>}
    </div>
  );
}

/** 어느 화면에서든 바로 녹음: 오른쪽 아래 마이크 버튼 → 팝업 */
export function IdeaFab() {
  const { store, go } = useCtx();
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(null);
  const idea = saved && (store.ideas || []).find(i => i.id === saved);
  return (<>
    <button className="ib-fab" onClick={() => { setSaved(null); setOpen(true); }} aria-label="아이디어 녹음하기" title="아이디어 녹음하기 (아이디어 뱅크)">
      <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {open && <Popup wide title="아이디어 남기기" sub="말하거나 적으면 아이디어 뱅크에 저장되고 AI 가 바로 할 일로 나눠 줍니다" onClose={() => setOpen(false)}
      actions={<button className="btn sm" onClick={() => { setOpen(false); go('ideas'); }}>아이디어 뱅크</button>}>
      <Capture compact onSaved={setSaved} />
      {idea && <IdeaCard idea={idea} />}
    </Popup>}
  </>);
}
