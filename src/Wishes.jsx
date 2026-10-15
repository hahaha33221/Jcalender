import React, { useEffect, useState } from 'react';
import { AREAS, iso } from './data.js';
import { Popup, useCtx } from './shared.jsx';
import { QS, STAGES, STAGE_NOTE, addRef, addWish, answered, daysIdle, gate, idleText, ideaToWish, launchWish, newWish, nextHint, patchWish } from './wishes.js';
import { stalestWish, wishRemindOf } from './wishRemind.js';

/* 숙원 사업: 언젠가 꼭 하고 싶은데 아직 아이디어 단계인 일을 모아 두고, 5단계(씨앗 → 탐색 → 구체화 → 준비 → 착수)로 키워 목표 관리로 옮긴다 (src/wishes.js)
   - 목록: 단계별로 보기 · 카드마다 단계 막대 · 다음 작은 일 · 구체화 n/7 · 오래 멈춤 표시
   - 상세: 다음 작은 일 · 구체화 질문 7가지 · 첫 실험 날짜 · 자료(메모 · 링크 · 아이디어 뱅크) · AI 로 구체화(server/ideas.mjs /api/wishes/shape) · 기록
   - 아이디어 뱅크의 스침 · 중요 카드 · 정리하기에서 "숙원으로" (WishPick)
   - 매월 첫 일요일 저녁 8시 돌아보기 알림 (wishRemind.js) · 대시보드 "이번 달 숙원 하나" (WishHome) */
let openNext = null;                                             // 다른 화면에서 숙원 하나를 열고 들어올 때
export const openWishLater = id => { openNext = id; };
const fmtD = s => { const d = new Date(s); return `${d.getMonth() + 1}/${String(d.getDate()).padStart(2, '0')}`; };

function Meter({ stage }) {
  return <span className="ws-meter" aria-label={`${stage}/5 단계`}>{[1, 2, 3, 4, 5].map(i => <i key={i} className={i <= stage ? 'f' : ''} />)}</span>;
}
const Chip = ({ stage }) => <span className={`ws-chip s${stage}`}>{STAGES[stage]}</span>;

/** 숙원 카드 (목록) */
function WishCard({ w, onOpen }) {
  const idle = daysIdle(w);
  return (
    <button className={`ws-card s${w.stage}`} onClick={() => onOpen(w.id)}>
      <span className="ws-ct"><b>{w.title}</b><Chip stage={w.stage} /></span>
      <Meter stage={w.stage} />
      <span className="ws-cm"><span>{w.stage === 5 ? '목표 관리에서 진행 중' : `다음: ${nextHint(w)}`}</span>
        <span>{w.stage < 5 && idle >= 30 ? <b className="ws-stale">{idle}일째 그대로</b> : `구체화 ${answered(w)}/7 · 자료 ${(w.refs || []).length}`}</span></span>
    </button>
  );
}

/** 숙원 상세 (팝업) */
function WishDetail({ id, onClose }) {
  const { store, setStore, now, sync, openCat, go } = useCtx();
  const w = (store.wishes || []).find(x => x.id === id);
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [end, setEnd] = useState(() => { const d = new Date(now); d.setMonth(d.getMonth() + 6); return iso(d); });
  const [sure, setSure] = useState(false);
  if (!w) return null;
  const G = gate(w);
  const set = (p, t) => setStore(s => patchWish(s, w.id, p, t));
  const setQ = (k, v) => set({ q: { ...(w.q || {}), [k]: v } });
  const addR = () => { const t = ref.trim(); if (!t) return; const url = /^https?:\/\/\S+$/.test(t) ? t : ''; setStore(s => addRef(s, w.id, { kind: url ? 'link' : 'note', text: t, url })); setRef(''); };
  const ai = async () => {
    setBusy(true); setErr('');
    try {
      const refs = (w.refs || []).map(r => r.kind === 'idea' ? `${r.text} ${((store.ideas || []).find(i => i.id === r.ideaId)?.points || []).join(' / ')}` : r.text);
      const r = await sync.request('/api/wishes/shape', { method: 'POST', body: { title: w.title, stage: w.stage, q: w.q || {}, refs, today: iso(now) } });
      set({ ai: { fill: r.fill || {}, next: r.next || [], cases: r.cases || [], at: new Date().toISOString() } }, 'AI 로 구체화 제안 받음');
    } catch (e) { setErr(e.status === 404 ? '서버 업데이트가 필요합니다 (VPS 에서 update.sh)' : e.message); }
    setBusy(false);
  };
  const up = () => { if (!G.ok) return; if (w.stage === 4) { setSure(true); return; } set({ stage: w.stage + 1 }, `${STAGES[w.stage + 1]} 단계로 올라감`); };
  const fill = w.ai?.fill || {};
  const goalOf = w.goal && store.goals?.boards?.[w.goal.key]?.items?.find(i => i.id === w.goal.id);
  return (
    <Popup wide title={w.title} sub={`${STAGES[w.stage]} 단계 · ${STAGE_NOTE[w.stage]}`} onClose={onClose}
      actions={<select className="ws-stsel" value={w.stage} onChange={e => set({ stage: Number(e.target.value) }, `단계를 ${STAGES[e.target.value]}(으)로 바꿈`)} aria-label="단계 직접 바꾸기">{[1, 2, 3, 4, 5].map(i => <option key={i} value={i}>{i}. {STAGES[i]}</option>)}</select>}>
      <div className="ws-d">
        <div className="ws-top"><Meter stage={w.stage} /><small className="muted">구체화 {answered(w)}/7 · 자료 {(w.refs || []).length} · {fmtD(w.at)} 추가</small></div>
        <label className="ws-name">이름<input value={w.title} onChange={e => set({ title: e.target.value })} aria-label="숙원 이름" /></label>
        {w.stage < 5 && <div className="ws-next"><b>다음 작은 일</b><input value={w.next || ''} onChange={e => set({ next: e.target.value })} placeholder={nextHint({ ...w, next: '' })} aria-label="다음 작은 일" /></div>}
        {w.stage === 5 && <div className="ws-next done"><b>착수함</b><span>{goalOf ? `목표 "${goalOf.name}" · 마감 ${goalOf.end}` : '목표 관리로 옮겼습니다'}</span>
          <button className="btn sm" onClick={() => { onClose(); w.goal ? openCat(w.goal.key.split('|')[0], '목표 관리') : go('home'); }}>목표에서 보기</button></div>}

        <h4>구체화 질문 <small className="muted">{answered(w)}/7</small></h4>
        <div className="ws-qs">{QS.map(([k, n, ph]) => (
          <label key={k} className={`ws-q ${(w.q?.[k] || '').trim() ? 'on' : ''}`}>
            <span className="ws-qk">{n}{(w.q?.[k] || '').trim() ? <small>답함</small> : <small className="muted">비어 있음</small>}</span>
            <textarea rows={2} value={w.q?.[k] || ''} onChange={e => setQ(k, e.target.value)} placeholder={ph} aria-label={n} />
            {!(w.q?.[k] || '').trim() && fill[k] && <span className="ws-sug"><span>AI 제안: {fill[k]}</span><button type="button" className="btn sm" onClick={e => { e.preventDefault(); setQ(k, fill[k]); }}>넣기</button></span>}
            {k === 'first' && <span className="ws-fd">첫 실험 날짜<input type="date" value={w.firstDate || ''} min={iso(now)} onChange={e => set({ firstDate: e.target.value }, e.target.value ? `첫 실험 날짜 ${e.target.value}` : '첫 실험 날짜 지움')} aria-label="첫 실험 날짜" /></span>}
          </label>))}</div>

        <h4>자료 <small className="muted">{(w.refs || []).length}개 · 메모 · 링크 · 아이디어 뱅크에서 보낸 것</small></h4>
        <ul className="ws-refs">{(w.refs || []).map(r => (
          <li key={r.id}><span className={`ws-rk ${r.kind}`}>{r.kind === 'idea' ? '아이디어' : r.kind === 'link' ? '링크' : '메모'}</span>
            {r.url ? <a href={r.url} target="_blank" rel="noreferrer">{r.text}</a> : <span className="ws-rt">{r.text}</span>}
            <small className="muted">{fmtD(r.at)}</small>
            <button className="tl-del" onClick={() => set({ refs: w.refs.filter(x => x.id !== r.id) })} aria-label="자료 빼기">×</button></li>))}</ul>
        <form className="ws-addref" onSubmit={e => { e.preventDefault(); addR(); }}>
          <input value={ref} onChange={e => setRef(e.target.value)} placeholder="메모 한 줄 또는 링크(https://…)" aria-label="자료 추가" />
          <button className="btn sm" disabled={!ref.trim()}>자료 추가</button></form>

        <div className="ws-ai">
          <div className="ws-ai-h"><b>AI 로 구체화</b><small className="muted">빈 칸 제안 · 다음 작은 일 3개 · 비슷한 사례</small>
            <button className="btn sm grow-r" disabled={busy || w.stage === 5} onClick={ai}>{busy ? '생각하는 중…' : w.ai ? '다시 받기' : '제안 받기'}</button></div>
          {err && <small className="ib-err">{err}</small>}
          {w.ai && <>
            {w.ai.next.length > 0 && <ul className="ws-ai-l">{w.ai.next.map((x, i) => <li key={i}><span>{x}</span><button className="linkish" onClick={() => set({ next: x }, `다음 작은 일: ${x}`)}>다음 작은 일로</button></li>)}</ul>}
            {w.ai.cases.length > 0 && <ul className="ws-ai-c">{w.ai.cases.map((x, i) => <li key={i}>{x}</li>)}</ul>}
            {Object.values(fill).some(Boolean) && <small className="muted">빈 질문 칸 아래에 AI 제안이 있습니다. "넣기"를 누르면 들어갑니다.</small>}
          </>}
        </div>

        {w.stage < 5 && <div className="ws-gate">
          {sure ? <div className="ws-launch"><b>착수하기</b><span>목표 관리에 "{w.title}" 목표를 만들고, 첫 실험 · 다음 작은 일을 To do 로 넣습니다.</span>
              <label>목표 마감<input type="date" value={end} min={iso(now)} onChange={e => setEnd(e.target.value)} /></label>
              <span className="ws-lb"><button className="btn primary" onClick={() => { setStore(s => launchWish(s, w.id, end, now)); setSure(false); }}>착수</button><button className="btn" onClick={() => setSure(false)}>취소</button></span></div>
            : <><span className={G.ok ? 'ok' : 'muted'}>{G.ok ? `준비됐어요 → ${STAGES[w.stage + 1]}` : G.need}</span>
              <button className="btn primary" disabled={!G.ok} onClick={up}>{w.stage === 4 ? '착수하기' : '다음 단계로'}</button></>}
        </div>}

        <details className="ws-log"><summary>기록 {(w.log || []).length}</summary>
          <ul>{(w.log || []).map((l, i) => <li key={i}><span>{fmtD(l.at)}</span>{l.t}</li>)}</ul></details>
        <div className="ws-foot"><span className="grow-r" /><button className="tl-del" onClick={() => { if (window.confirm(`"${w.title}" 숙원을 지울까요?`)) { setStore(s => ({ ...s, wishes: (s.wishes || []).filter(x => x.id !== w.id) })); onClose(); } }}>숙원 삭제</button></div>
      </div>
    </Popup>
  );
}

/** 돌아보기 알림 설정 */
function RemindSet() {
  const { store, setStore } = useCtx();
  const R = wishRemindOf(store);
  const set = p => setStore(s => ({ ...s, notify: { ...(s.notify || {}), wish: { ...R, ...p } } }));
  return (
    <span className="ib-rem">
      <label><input type="checkbox" checked={R.on} onChange={e => set({ on: e.target.checked })} /> 돌아보기 알림</label>
      <small className="muted">매월 첫 일요일</small>
      <input type="time" value={R.time} onChange={e => e.target.value && set({ time: e.target.value })} disabled={!R.on} aria-label="돌아보기 알림 시각" />
    </span>
  );
}

/** 숙원 사업 화면 */
export default function Wishes() {
  const { store, setStore, areasAllowed } = useCtx();
  const [f, setF] = useState(0);
  const [open, setOpen] = useState(null);
  const [title, setTitle] = useState('');
  const [area, setArea] = useState((areasAllowed || 'P')[0] || 'P');
  useEffect(() => { if (openNext) { setOpen(openNext); openNext = null; } }, []);
  const all = store.wishes || [];
  const list = all.filter(w => !f || w.stage === f).sort((a, b) => (a.stage === 5) - (b.stage === 5) || b.stage - a.stage || (b.touched || b.at).localeCompare(a.touched || a.at));
  const add = e => { e.preventDefault(); const t = title.trim(); if (t.length < 2) return; const w = newWish(t, area); setStore(s => addWish(s, w)); setTitle(''); setOpen(w.id); };
  return (
    <div className="catv ws">
      <header className="page-h"><h1>숙원 사업</h1><p className="muted">언젠가 꼭 하고 싶은 일을 씨앗 → 탐색 → 구체화 → 준비 → 착수로 조금씩 키워, 준비되면 목표로 옮깁니다. 마감은 없고 "다음 작은 일" 하나만 챙깁니다.</p></header>
      <section className="panel">
        <form className="ws-add" onSubmit={add}>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="언젠가 하고 싶은 일 (예: 작은 북카페 열기)" aria-label="숙원 이름" />
          {(areasAllowed || 'P').length > 1 && <select value={area} onChange={e => setArea(e.target.value)} aria-label="영역">{[...(areasAllowed || 'P')].map(a => <option key={a} value={a}>{AREAS[a].n}</option>)}</select>}
          <button className="btn primary" disabled={title.trim().length < 2}>+ 숙원 추가</button>
        </form>
        <div className="ws-bar">
          <div className="chips" role="group" aria-label="단계별 보기">{[0, 1, 2, 3, 4, 5].map(i => <button key={i} aria-pressed={f === i} onClick={() => setF(i)}>{i ? STAGES[i] : '전체'} {i ? all.filter(w => w.stage === i).length : all.length}</button>)}</div>
          <RemindSet />
        </div>
      </section>
      {list.length ? <div className="ws-list">{list.map(w => <WishCard key={w.id} w={w} onOpen={setOpen} />)}</div>
        : <section className="panel ws-empty"><p>{all.length ? '이 단계의 숙원이 없습니다.' : '아직 숙원이 없습니다. 위에 "언젠가 하고 싶은 일"을 한 줄 적어 보세요.'}</p>
          {!all.length && <ol className="muted"><li>씨앗: 한 줄로 적고 "왜"만 채워도 충분합니다</li><li>탐색: 아이디어 뱅크에서 떠오른 생각을 "숙원으로" 보내 모읍니다</li><li>구체화 · 준비: 7가지 질문과 첫 실험 날짜를 정하면 "착수"로 목표가 됩니다</li></ol>}</section>}
      {open && <WishDetail id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** 아이디어 → 숙원 고르기 (새 숙원 · 있는 숙원의 자료로) */
export function WishPick({ idea, onDone, className = 'ib-merge' }) {
  const { store, setStore, areasAllowed } = useCtx();
  const ws = (store.wishes || []).filter(w => w.stage < 5);
  if (idea.wish && (store.wishes || []).some(w => w.id === idea.wish)) return <small className="ws-linked">숙원: {(store.wishes || []).find(w => w.id === idea.wish).title}</small>;
  return (
    <select className={className} value="" onChange={e => { const v = e.target.value; if (!v) return; setStore(s => ideaToWish(s, idea, v === 'new' ? '' : v, (areasAllowed || 'P')[0])); onDone?.(); }} aria-label="숙원으로 보내기">
      <option value="">숙원으로…</option><option value="new">+ 새 숙원으로 만들기</option>{ws.map(w => <option key={w.id} value={w.id}>{w.title} 의 자료로</option>)}
    </select>
  );
}

/** 대시보드: 이번 달 숙원 하나 (가장 오래 멈춘 것) */
export function WishHome() {
  const { store, go } = useCtx();
  const w = stalestWish(store);
  const n = (store.wishes || []).filter(x => x.stage < 5).length;
  if (!n) return null;
  return (
    <section className="panel ws-home" aria-label="이번 달 숙원 하나">
      <div className="csum-h"><h2>이번 달 숙원 하나</h2><span className="muted">숙원 {n}개 중 가장 오래 멈춘 것</span>
        <button className="btn sm grow-r" onClick={() => go('wishes')}>숙원 사업</button></div>
      <button className="ws-card wide" onClick={() => { openWishLater(w.id); go('wishes'); }}>
        <span className="ws-ct"><b>{w.title}</b><Chip stage={w.stage} /></span><Meter stage={w.stage} />
        <span className="ws-cm"><span>다음: {nextHint(w)}</span><span>{idleText(w)}</span></span>
      </button>
    </section>
  );
}
