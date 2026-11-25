/* 대시보드 맨 아래 · 녹음 · 회의록 (관리자만) — server/recordings.mjs
   - 휴대폰 녹음이 녹음 서버에 올라오면 서버가 받아 적고(STT) AI 가 회의록(1. 개요 ~ 6. 기타)으로 정리한다
   - 화면이 보이는 동안 30초마다 (처리 중인 것이 있으면 10초마다) 목록을 다시 받아 저절로 바뀐다
   - 회의록 창: 녹음 듣기 · 회의록 · 전문 · 복사 · 다시 만들기 · 지우기 · 할 일을 캘린더 일정으로 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { iso } from './data.js';
import { Popup, useCtx } from './shared.jsx';
import { API_BASE } from './serverSync.js';
import { uid } from './ideas.js';

const STATUS = { idle: '수동', queued: '대기', stt: '받아쓰는 중', summary: '정리 중', done: '완료', failed: '실패', skipped: '건너뜀' };
const BUSY = ['queued', 'stt', 'summary'];
const VIEWS = { all: '전체', done: '완료', busy: '진행 중', todo: '실패 · 수동' };
const inView = (v, s) => v === 'all' || (v === 'done' && s === 'done') || (v === 'busy' && BUSY.includes(s)) || (v === 'todo' && ['idle', 'failed', 'skipped'].includes(s));
const PAGE = 10;
const p2 = n => String(n).padStart(2, '0');
const fmtAt = s => { if (!s) return ''; const d = new Date(s); return `${d.getMonth() + 1}/${d.getDate()} ${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const fmtLen = s => (s == null ? '' : s >= 3600 ? `${Math.floor(s / 3600)}시간 ${Math.round((s % 3600) / 60)}분` : s >= 60 ? `${Math.round(s / 60)}분` : `${Math.round(s)}초`);
const nameOf = it => it.title || String(it.filename || '').replace(/\.\w+$/, '') || `녹음 ${it.id}`;

/** 회의록 → 보고서 형식 글 (복사용) */
export function minutesText(m, it) {
  if (!m) return '';
  const L = [];
  const list = (a, mark = '-') => (a?.length ? a.map(x => `${mark} ${x}`) : ['- 없음']);
  L.push(m.title || nameOf(it || {}), '');
  L.push('1. 개요', `- 일시: ${m.overview?.when || fmtAt(it?.at)}`, `- 참석자: ${(m.overview?.participants || []).join(', ') || '확인 필요'}`, `- 목적: ${m.overview?.purpose || m.summary || ''}`, '');
  L.push('2. 안건', ...(m.agenda?.length ? m.agenda.map((a, i) => `${i + 1}) ${a}`) : ['- 없음']), '');
  L.push('3. 안건 별 주요 내용');
  (m.details || []).forEach((d, i) => { L.push(`${i + 1}) ${d.agenda}`, ...d.points.map(p => `  - ${p}`)); });
  if (!m.details?.length) L.push('- 없음');
  L.push('', '4. 결론', ...list(m.conclusion), '');
  L.push('5. 향후 진행 사항', ...(m.next_steps?.length ? m.next_steps.map(x => `- ${x.task}${x.owner ? ` (담당: ${x.owner})` : ''}${x.due ? ` · 기한 ${x.due}${x.time ? ` ${x.time}` : ''}` : ''}`) : ['- 없음']), '');
  L.push('6. 기타', ...list(m.etc));
  return L.join('\n');
}

function useMinutes() {
  const { sync } = useCtx();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(async () => {
    try { setData(await sync.request('/api/minutes')); setErr(''); }
    catch (e) { setErr(e.status === 404 && e.server ? '서버 업데이트가 필요합니다 (맥북에서 bash server/deploy/update.sh)' : e.message); }
  }, [sync]);
  const busy = !!data?.items?.some(i => BUSY.includes(i.status));
  useEffect(() => {
    load();
    let t = null;
    const loop = () => { clearTimeout(t); t = setTimeout(() => { if (document.visibilityState === 'visible') load(); loop(); }, busy ? 10000 : 30000); };
    loop();
    const vis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearTimeout(t); document.removeEventListener('visibilitychange', vis); };
  }, [load, busy]);
  return { data, err, load };
}

export function RecordingsHome() {
  const { data, err, load } = useMinutes();
  const [view, setView] = useState('all');
  const [q, setQ] = useState('');
  const [n, setN] = useState(PAGE);
  const [open, setOpen] = useState(null);
  const [msg, setMsg] = useState('');
  const { sync } = useCtx();
  const items = data?.items || [];
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    return items.filter(i => inView(view, i.status) && (!k || `${i.title} ${i.summary} ${i.filename} ${i.device}`.toLowerCase().includes(k)));
  }, [items, view, q]);
  const counts = useMemo(() => Object.fromEntries(Object.keys(VIEWS).map(v => [v, items.filter(i => inView(v, i.status)).length])), [items]);
  const run = async id => {
    setMsg('');
    try { await sync.request('/api/minutes/process', { method: 'POST', body: { id } }); await load(); }
    catch (e) { setMsg(e.message); }
  };
  const r = data?.ready;
  const missing = r && [!r.api && '녹음 서버 토큰(RECORDING_API_TOKEN)', !r.stt && '받아쓰기용 OpenAI 키', !r.ai && '회의록용 AI 키'].filter(Boolean);
  return (
    <section className="panel rec-home" aria-label="녹음 · 회의록">
      <div className="csum-h"><h2>녹음 · 회의록</h2>
        <span className="muted">{data ? `${items.length}건 · 완료 ${counts.done}${counts.busy ? ` · 진행 중 ${counts.busy}` : ''}${data.auto ? ` · 자동 정리 오늘 ${data.today}/${data.limit}` : ' · 자동 정리 꺼짐'}` : '불러오는 중…'}</span>
        <button className="btn sm" onClick={load}>새로고침</button></div>
      {err && <p className="rec-msg bad">{err}</p>}
      {!!missing?.length && <p className="rec-msg">서버 설정이 더 필요합니다: {missing.join(' · ')}. 기획서 5번(향후 진행 사항) 순서대로 넣으면 새 녹음부터 자동으로 회의록이 만들어집니다.</p>}
      {msg && <p className="rec-msg bad">{msg}</p>}
      {data && (<>
        <div className="rec-tools">
          <div className="chips">{Object.entries(VIEWS).map(([k, label]) => <button key={k} aria-pressed={view === k} onClick={() => { setView(k); setN(PAGE); }}>{label} <small>{counts[k]}</small></button>)}</div>
          <input className="rec-q" value={q} onChange={e => { setQ(e.target.value); setN(PAGE); }} placeholder="제목 · 요약 · 파일 이름 검색" aria-label="녹음 검색" />
        </div>
        {list.length ? (
          <ul className="rec-list">{list.slice(0, n).map(it => (
            <li key={it.id} className={`rec-row st-${it.status}`}>
              <button className="rec-open" onClick={() => setOpen(it.id)} aria-label={`${nameOf(it)} 회의록 열기`}>
                <span className="rec-at">{fmtAt(it.at)}</span>
                <span className="rec-main">
                  <span className="rec-t">{nameOf(it)}{it.kind && <span className="tag">{it.kind}</span>}{it.steps > 0 && <span className="tag">할 일 {it.steps}</span>}</span>
                  <span className="rec-s muted">{it.status === 'done' ? it.summary : it.error || (it.status === 'idle' ? '자동 정리 범위 밖 · 버튼으로 만들기' : `${it.device ? `${it.device} · ` : ''}${fmtLen(it.duration) || it.filename}`)}</span>
                </span>
              </button>
              <span className={`rec-st st-${it.status}`}>{STATUS[it.status] || it.status}</span>
              {['idle', 'failed', 'skipped'].includes(it.status) && <button className="btn sm" onClick={() => run(it.id)}>{it.status === 'idle' ? '회의록 만들기' : '다시 시도'}</button>}
            </li>))}</ul>
        ) : <p className="muted rec-empty">{items.length ? '조건에 맞는 녹음이 없습니다.' : '아직 올라온 녹음이 없습니다. 휴대폰에서 녹음이 올라오면 여기에 저절로 나타납니다.'}</p>}
        {list.length > n && <button className="btn sm rec-more" onClick={() => setN(n + PAGE)}>더 보기 ({list.length - n})</button>}
      </>)}
      {open && <MinutesPopup id={open} onClose={() => setOpen(null)} onChanged={load} />}
    </section>
  );
}

function MinutesPopup({ id, onClose, onChanged }) {
  const { sync, setStore, now } = useCtx();
  const [it, setIt] = useState(null);
  const [err, setErr] = useState('');
  const [full, setFull] = useState(false);
  const [audio, setAudio] = useState(null);
  const [note, setNote] = useState('');
  const [added, setAdded] = useState({});
  const urlRef = useRef(null);
  const get = useCallback(async () => {
    try { setIt((await sync.request(`/api/minutes/item?id=${id}`)).item); setErr(''); } catch (e) { setErr(e.message); }
  }, [sync, id]);
  useEffect(() => { get(); }, [get]);
  useEffect(() => {                                              // 처리 중이면 끝날 때까지 10초마다
    if (!it || !BUSY.includes(it.status)) return undefined;
    const t = setInterval(get, 10000);
    return () => clearInterval(t);
  }, [it, get]);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);
  const listen = async () => {
    setAudio('loading');
    try {
      const r = await fetch(`${API_BASE}/api/minutes/audio?id=${id}`, { headers: { Authorization: `Bearer ${sync.conf.token}` } });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `녹음을 받지 못했습니다 (${r.status})`);
      urlRef.current = URL.createObjectURL(await r.blob());
      setAudio(urlRef.current);
    } catch (e) { setAudio(null); setNote(e.message); }
  };
  const redo = async () => {
    try { await sync.request('/api/minutes/process', { method: 'POST', body: { id } }); setNote('다시 만드는 중입니다. 1~2분 뒤 저절로 바뀝니다.'); await get(); onChanged(); }
    catch (e) { setNote(e.message); }
  };
  const remove = async () => {
    if (!window.confirm('이 녹음 파일과 회의록을 지울까요? 되돌릴 수 없습니다.')) return;
    try { await sync.request('/api/minutes/delete', { method: 'POST', body: { id } }); onChanged(); onClose(); }
    catch (e) { setNote(e.message); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(minutesText(it.minutes, it)); setNote('회의록을 복사했습니다.'); } catch { setNote('복사하지 못했습니다. 전문 아래 글을 직접 골라 복사하세요.'); }
  };
  const toCalendar = (x, i) => {
    const m = it.minutes;
    setStore(s => ({ ...s, events: [...(s.events || []), { id: uid(), date: x.due || iso(now), time: x.time || '', end: '', title: x.task, area: m.kind === '통화' || m.kind === '회의' ? 'W' : 'P', memo: `회의록: ${m.title}${x.owner ? ` · 담당 ${x.owner}` : ''}` }] }));
    setAdded(a => ({ ...a, [i]: true }));
  };
  const m = it?.minutes;
  const sub = it ? [fmtAt(it.at), fmtLen(it.duration), it.device, STATUS[it.status], it.aiModel].filter(Boolean).join(' · ') : '';
  return (
    <Popup wide title={it ? nameOf(it) : '회의록'} sub={sub} onClose={onClose}
      actions={it && <span className="rec-acts">
        {m && <button className="btn sm" onClick={copy}>회의록 복사</button>}
        {!BUSY.includes(it.status) && <button className="btn sm" onClick={redo}>{m ? '다시 만들기' : '회의록 만들기'}</button>}
        {!['stt', 'summary'].includes(it.status) && <button className="btn sm danger" onClick={remove}>지우기</button>}
      </span>}>
      {err && <p className="rec-msg bad">{err}</p>}
      {note && <p className="rec-msg">{note}</p>}
      {it && (<div className="rec-pop">
        <div className="rec-audio">{typeof audio === 'string' && audio !== 'loading' ? <audio controls autoPlay src={audio} /> : <button className="btn sm" disabled={audio === 'loading'} onClick={listen}>{audio === 'loading' ? '녹음 받는 중…' : '녹음 듣기'}</button>}
          <span className="muted">{it.filename}</span></div>
        {it.error && <p className="rec-msg bad">{it.error}</p>}
        {!m && BUSY.includes(it.status) && <p className="muted">{STATUS[it.status]}입니다. 끝나면 이 창이 저절로 바뀝니다.</p>}
        {m && (<div className="rec-min">
          {m.summary && <p className="rec-sum">{m.summary}</p>}
          <h3>1. 개요</h3>
          <ul><li>일시: {m.overview?.when || fmtAt(it.at)}</li><li>참석자: {(m.overview?.participants || []).join(', ') || '확인 필요'}</li>{m.overview?.purpose && <li>목적: {m.overview.purpose}</li>}</ul>
          <h3>2. 안건</h3>
          {m.agenda?.length ? <ol>{m.agenda.map((a, i) => <li key={i}>{a}</li>)}</ol> : <p className="muted">없음</p>}
          <h3>3. 안건 별 주요 내용</h3>
          {m.details?.length ? m.details.map((d, i) => <div key={i} className="rec-det"><b>{i + 1}) {d.agenda}</b><ul>{d.points.map((p, j) => <li key={j}>{p}</li>)}</ul></div>) : <p className="muted">없음</p>}
          <h3>4. 결론</h3>
          {m.conclusion?.length ? <ul>{m.conclusion.map((c, i) => <li key={i}>{c}</li>)}</ul> : <p className="muted">없음</p>}
          <h3>5. 향후 진행 사항</h3>
          {m.next_steps?.length ? <ul className="rec-steps">{m.next_steps.map((x, i) => (
            <li key={i}><span className="grow">{x.task}{x.owner && <span className="tag">{x.owner}</span>}{x.due && <span className="tag">{x.due.slice(5).replace('-', '/')}{x.time ? ` ${x.time}` : ''}</span>}</span>
              <button className="btn sm" disabled={added[i]} onClick={() => toCalendar(x, i)}>{added[i] ? '추가함' : '캘린더에 추가'}</button></li>))}</ul> : <p className="muted">없음</p>}
          <h3>6. 기타</h3>
          {m.etc?.length ? <ul>{m.etc.map((c, i) => <li key={i}>{c}</li>)}</ul> : <p className="muted">없음</p>}
        </div>)}
        {it.transcript && <div className="rec-full">
          <button className="btn sm" onClick={() => setFull(!full)}>{full ? '전문 접기' : `전문 보기 (${it.transcript.length.toLocaleString('ko-KR')}자)`}</button>
          {full && <pre className="rec-tr">{it.transcript}</pre>}
        </div>}
        {(it.sttModel || it.aiModel) && <p className="muted rec-model">받아쓰기 {it.sttModel || '-'} · 회의록 {it.aiModel || '-'}</p>}
      </div>)}
    </Popup>
  );
}
