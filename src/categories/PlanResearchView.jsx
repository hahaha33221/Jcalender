import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { iso } from '../data.js';
import { areaVar, useCtx } from '../shared.jsx';
import { daysBetween } from './goals.js';

/* 근로 › 기획·조사 전용 화면 (탭 2개)
   plan = {
     ui: { tab: 'research' | 'plan' },
     topics:  [{ id, title, purpose, due, status('조사 중'|'정리 완료'), summary, created }],
     sources: [{ id, topicId, title, url, from(출처), date, memo, tags: [], star(1~3) }],
     plans:   [{ id, title, status, due, topicIds: [], sec: { s1..s6 }, created, updated }],
   }
   - 조사: 주제별로 자료 카드(링크·메모)를 모으고 "알게 된 것 · 결론"을 정리 → "기획안으로" 버튼으로 기획서 초안 생성
   - 기획: 상태 보드(아이디어 → 초안 → 검토 → 확정, 보류) + 기획서(1.개요 ~ 6.기타) + PDF
   파일 첨부는 두지 않는다 (링크와 메모만) */
export const PLAN_STATUS = ['아이디어', '초안', '검토', '확정', '보류'];
export const SECTIONS = [['s1', '개요'], ['s2', '안건'], ['s3', '안건 별 주요 내용'], ['s4', '결론'], ['s5', '향후 진행 사항'], ['s6', '기타']];
const EMPTY = { ui: { tab: 'research' }, topics: [], sources: [], plans: [] };
const uid = () => Math.random().toString(36).slice(2, 10);
const dot = s => (s ? `${s.slice(0, 4)}. ${s.slice(5, 7)}. ${s.slice(8, 10)}.` : '-');
const md = s => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
const stars = n => '★'.repeat(n) + '☆'.repeat(3 - n);
/** 마감까지 남은 날 (마감 없으면 null) */
export const ddayOf = (due, today) => (due ? daysBetween(today, due) : null);
export const ddayText = d => (d == null ? '' : d === 0 ? 'D-day' : d > 0 ? `D-${d}` : `D+${-d}`);
/** 대시보드용: 마감이 7일 이내(지난 것 포함)인 진행 중 기획·조사 */
export function planDueSoon(plan, today, days = 7) {
  const P = plan || EMPTY;
  const list = [
    ...P.topics.filter(t => t.status !== '정리 완료' && t.due).map(t => ({ id: t.id, kind: '조사', title: t.title, status: t.status, due: t.due })),
    ...P.plans.filter(p => p.status !== '확정' && p.status !== '보류' && p.due).map(p => ({ id: p.id, kind: '기획', title: p.title, status: p.status, due: p.due })),
  ].map(x => ({ ...x, d: ddayOf(x.due, today) })).filter(x => x.d <= days);
  return list.sort((a, b) => a.d - b.d);
}

export default function PlanResearchView({ area, cat }) {
  const { store, setStore, now } = useCtx();
  const today = iso(now);
  const P = { ...EMPTY, ...(store.plan || {}) };
  const set = fn => setStore(s => ({ ...s, plan: fn({ ...EMPTY, ...(s.plan || {}) }) }));
  const tab = P.ui?.tab || 'research';
  const setTab = t => set(x => ({ ...x, ui: { ...(x.ui || {}), tab: t } }));
  const [openPlan, setOpenPlan] = useState(null);

  const active = P.plans.filter(p => p.status !== '확정' && p.status !== '보류');
  const soon = planDueSoon(P, today);

  /** 조사 주제를 기획서 초안으로 옮긴다 */
  const toPlan = t => {
    const id = uid();
    const refs = P.sources.filter(s => s.topicId === t.id).sort((a, b) => b.star - a.star);
    const s3 = refs.filter(r => r.memo).map(r => `- ${r.title}: ${r.memo}`).join('\n');
    set(x => ({
      ...x, ui: { ...(x.ui || {}), tab: 'plan' },
      plans: [...x.plans, { id, title: t.title, status: '초안', due: t.due || '', topicIds: [t.id], created: today, updated: today,
        sec: { s1: t.purpose || '', s2: '', s3, s4: t.summary || '', s5: '', s6: '' } }],
    }));
    setOpenPlan(id);
  };

  return (
    <div className="catv pr" style={{ '--ac': areaVar(area) }}>
      <header className="page-h"><h1 className="area-title">{cat}</h1></header>

      <div className="hv-stats">
        <div className="hv-stat sl"><span className="muted">조사 주제</span><b>{P.topics.length}개</b><span className="hv-sub">조사 중 {P.topics.filter(t => t.status !== '정리 완료').length}개</span></div>
        <div className="hv-stat sl"><span className="muted">모은 자료</span><b>{P.sources.length}건</b><span className="hv-sub">중요(★3) {P.sources.filter(s => s.star === 3).length}건</span></div>
        <div className="hv-stat ex"><span className="muted">진행 중 기획</span><b>{active.length}건</b><span className="hv-sub">확정 {P.plans.filter(p => p.status === '확정').length}건</span></div>
        <div className={`hv-stat ${soon.length ? 'over' : 'ex'}`}><span className="muted">마감 임박 (7일)</span><b>{soon.length}건</b><span className="hv-sub">{soon[0] ? `${ddayText(soon[0].d)} ${soon[0].title}` : '없음'}</span></div>
      </div>

      <div className="fv-tabs" role="tablist" aria-label="기획·조사">
        <button role="tab" aria-selected={tab === 'research'} className={tab === 'research' ? 'on' : ''} onClick={() => setTab('research')}>조사</button>
        <button role="tab" aria-selected={tab === 'plan'} className={tab === 'plan' ? 'on' : ''} onClick={() => setTab('plan')}>기획</button>
      </div>

      {tab === 'research'
        ? <Research P={P} set={set} today={today} toPlan={toPlan} />
        : <Plans P={P} set={set} today={today} openId={openPlan} setOpenId={setOpenPlan} />}
    </div>
  );
}

/* ───────── 조사 탭 ───────── */
function Research({ P, set, today, toPlan }) {
  const [sel, setSel] = useState(P.topics[P.topics.length - 1]?.id || null);
  const [nt, setNt] = useState({ title: '', purpose: '', due: '' });
  const topic = P.topics.find(t => t.id === sel) || null;

  const addTopic = () => {
    if (!nt.title.trim()) return;
    const id = uid();
    set(x => ({ ...x, topics: [...x.topics, { id, title: nt.title.trim(), purpose: nt.purpose.trim(), due: nt.due, status: '조사 중', summary: '', created: today }] }));
    setNt({ title: '', purpose: '', due: '' }); setSel(id);
  };
  const updTopic = patch => set(x => ({ ...x, topics: x.topics.map(t => (t.id === sel ? { ...t, ...patch } : t)) }));
  const [arm, setArm] = useState(null);
  const delTopic = () => {
    set(x => ({ ...x, topics: x.topics.filter(t => t.id !== sel), sources: x.sources.filter(s => s.topicId !== sel), plans: x.plans.map(p => ({ ...p, topicIds: (p.topicIds || []).filter(i => i !== sel) })) }));
    setSel(null); setArm(null);
  };
  const count = id => P.sources.filter(s => s.topicId === id).length;
  const topics = [...P.topics].sort((a, b) => (a.status === b.status ? (a.due || '9').localeCompare(b.due || '9') : a.status === '조사 중' ? -1 : 1));

  return (
    <div className="pr-grid">
      <section className="panel pr-topics">
        <div className="csum-h"><h2>조사 주제</h2><span className="muted">{P.topics.length}개</span></div>
        <div className="pr-add">
          <input value={nt.title} onChange={e => setNt({ ...nt, title: e.target.value })} onKeyDown={e => e.key === 'Enter' && addTopic()} placeholder="주제 (예: 경쟁사 가격 정책)" aria-label="새 조사 주제" />
          <input value={nt.purpose} onChange={e => setNt({ ...nt, purpose: e.target.value })} placeholder="목적 (무엇을 알고 싶은지)" aria-label="조사 목적" />
          <div className="row2"><label className="pr-due">마감<input type="date" value={nt.due} onChange={e => setNt({ ...nt, due: e.target.value })} aria-label="조사 마감" /></label>
            <button className="btn primary" onClick={addTopic} disabled={!nt.title.trim()}>주제 추가</button></div>
        </div>
        <ul className="pr-tlist">{topics.map(t => {
          const d = ddayOf(t.due, today);
          return (
            <li key={t.id}><button className={`pr-ti ${t.id === sel ? 'on' : ''}`} onClick={() => { setSel(t.id); setArm(null); }} aria-pressed={t.id === sel}>
              <b>{t.title}</b>
              <span className="pr-tm"><span className={`pr-st ${t.status === '정리 완료' ? 'done' : ''}`}>{t.status}</span> 자료 {count(t.id)}건
                {d != null && t.status !== '정리 완료' && <span className={`pr-dd ${d < 0 ? 'late' : d <= 3 ? 'soon' : ''}`}>{ddayText(d)}</span>}</span>
            </button></li>);
        })}</ul>
        {!P.topics.length && <p className="muted">조사할 주제를 먼저 추가하세요.</p>}
      </section>

      {topic ? (
        <section className="panel pr-detail">
          <div className="csum-h">
            <input className="pr-title" value={topic.title} onChange={e => updTopic({ title: e.target.value })} aria-label="주제 제목" />
            <span className="chips">{['조사 중', '정리 완료'].map(s => <button key={s} aria-pressed={topic.status === s} onClick={() => updTopic({ status: s })}>{s}</button>)}</span>
          </div>
          <div className="pr-meta">
            <label>목적<input value={topic.purpose} onChange={e => updTopic({ purpose: e.target.value })} placeholder="무엇을 알고 싶은지" /></label>
            <label className="pr-due">마감<input type="date" value={topic.due || ''} onChange={e => updTopic({ due: e.target.value })} /></label>
          </div>
          <Sources P={P} set={set} topic={topic} today={today} />
          <h3 className="pr-h3">알게 된 것 · 결론</h3>
          <textarea rows={4} value={topic.summary} onChange={e => updTopic({ summary: e.target.value })} placeholder="자료를 보고 알게 된 것, 결론을 적어 두면 기획서 4.결론으로 옮겨집니다" aria-label="알게 된 것 · 결론" />
          <div className="pr-foot">
            {arm === 'del'
              ? <><button className="btn danger sm" onClick={delTopic}>정말 삭제할까요? (자료 {count(topic.id)}건 포함)</button><button className="btn sm" onClick={() => setArm(null)}>취소</button></>
              : <button className="btn sm" onClick={() => setArm('del')}>주제 삭제</button>}
            <span className="grow" />
            <button className="btn primary" onClick={() => toPlan(topic)}>기획안으로 만들기</button>
          </div>
        </section>
      ) : (
        <section className="panel pr-detail"><p className="muted">왼쪽에서 조사 주제를 고르거나 새로 추가하세요.</p></section>
      )}
    </div>
  );
}

/** 주제에 달린 자료 카드: 추가 · 검색 · 태그 필터 · 중요도 */
function Sources({ P, set, topic, today }) {
  const blank = { title: '', url: '', from: '', date: today, memo: '', tags: '', star: 2 };
  const [n, setN] = useState(blank);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState('');
  const [edit, setEdit] = useState(null);
  const [arm, setArm] = useState(null);
  const mine = P.sources.filter(s => s.topicId === topic.id);
  const tags = [...new Set(mine.flatMap(s => s.tags))].sort();
  const list = mine.filter(s => (!tag || s.tags.includes(tag)) && (!q || `${s.title} ${s.memo} ${s.from} ${s.url} ${s.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => b.star - a.star || (b.date || '').localeCompare(a.date || ''));
  const toTags = v => v.split(',').map(x => x.trim()).filter(Boolean);
  const add = () => {
    if (!n.title.trim() && !n.url.trim()) return;
    set(x => ({ ...x, sources: [...x.sources, { id: uid(), topicId: topic.id, title: n.title.trim() || n.url.trim(), url: n.url.trim(), from: n.from.trim(), date: n.date, memo: n.memo.trim(), tags: toTags(n.tags), star: n.star }] }));
    setN({ ...blank, tags: n.tags });
  };
  const upd = (id, patch) => set(x => ({ ...x, sources: x.sources.map(s => (s.id === id ? { ...s, ...patch } : s)) }));
  const del = id => { set(x => ({ ...x, sources: x.sources.filter(s => s.id !== id) })); setArm(null); };
  const href = u => (/^https?:\/\//i.test(u) ? u : `https://${u}`);

  return (
    <>
      <h3 className="pr-h3">자료 <span className="muted">{mine.length}건</span></h3>
      <div className="pr-sadd">
        <input value={n.title} onChange={e => setN({ ...n, title: e.target.value })} placeholder="자료 제목" aria-label="자료 제목" />
        <input value={n.url} onChange={e => setN({ ...n, url: e.target.value })} placeholder="링크 (https://...)" aria-label="자료 링크" />
        <input value={n.from} onChange={e => setN({ ...n, from: e.target.value })} placeholder="출처 (기관·매체·사람)" aria-label="출처" />
        <input type="date" value={n.date} onChange={e => setN({ ...n, date: e.target.value })} aria-label="자료 날짜" />
        <input value={n.tags} onChange={e => setN({ ...n, tags: e.target.value })} placeholder="태그 (쉼표로 구분)" aria-label="태그" />
        <span className="pr-star" role="radiogroup" aria-label="중요도">{[1, 2, 3].map(k => <button key={k} role="radio" aria-checked={n.star === k} className={n.star >= k ? 'on' : ''} onClick={() => setN({ ...n, star: k })} title={`중요도 ${k}`}>★</button>)}</span>
        <textarea rows={2} value={n.memo} onChange={e => setN({ ...n, memo: e.target.value })} placeholder="메모 (핵심 내용, 숫자, 인용)" aria-label="자료 메모" />
        <button className="btn primary" onClick={add} disabled={!n.title.trim() && !n.url.trim()}>자료 추가</button>
      </div>
      {mine.length > 0 && (
        <div className="pr-filter">
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="자료 검색" aria-label="자료 검색" />
          {tags.length > 0 && <span className="chips"><button aria-pressed={!tag} onClick={() => setTag('')}>전체</button>{tags.map(t => <button key={t} aria-pressed={tag === t} onClick={() => setTag(tag === t ? '' : t)}>{t}</button>)}</span>}
        </div>
      )}
      <ul className="pr-cards">{list.map(s => (
        <li key={s.id} className="pr-card">
          {edit === s.id ? (
            <div className="pr-sedit">
              <input value={s.title} onChange={e => upd(s.id, { title: e.target.value })} aria-label="자료 제목 수정" />
              <input value={s.url} onChange={e => upd(s.id, { url: e.target.value })} placeholder="링크" aria-label="링크 수정" />
              <input value={s.from} onChange={e => upd(s.id, { from: e.target.value })} placeholder="출처" aria-label="출처 수정" />
              <input type="date" value={s.date || ''} onChange={e => upd(s.id, { date: e.target.value })} aria-label="날짜 수정" />
              <input defaultValue={s.tags.join(', ')} onBlur={e => upd(s.id, { tags: toTags(e.target.value) })} placeholder="태그" aria-label="태그 수정" />
              <textarea rows={3} value={s.memo} onChange={e => upd(s.id, { memo: e.target.value })} aria-label="메모 수정" />
              <button className="btn sm primary" onClick={() => setEdit(null)}>완료</button>
            </div>
          ) : (
            <>
              <div className="pr-ch">
                <button className="pr-stars" onClick={() => upd(s.id, { star: s.star % 3 + 1 })} title="눌러서 중요도 바꾸기" aria-label={`중요도 ${s.star}`}>{stars(s.star)}</button>
                <b className="grow">{s.url ? <a href={href(s.url)} target="_blank" rel="noreferrer">{s.title}</a> : s.title}</b>
                <button className="btn sm" onClick={() => setEdit(s.id)}>수정</button>
                {arm === s.id ? <button className="btn sm danger" onClick={() => del(s.id)}>정말 삭제?</button> : <button className="btn sm" onClick={() => setArm(s.id)}>삭제</button>}
              </div>
              <div className="pr-cm">{[s.from, s.date && dot(s.date)].filter(Boolean).join(' · ')}{s.tags.map(t => <span key={t} className="tag">{t}</span>)}</div>
              {s.memo && <p className="pr-memo">{s.memo}</p>}
            </>
          )}
        </li>))}</ul>
      {mine.length > 0 && !list.length && <p className="muted">조건에 맞는 자료가 없습니다.</p>}
    </>
  );
}

/* ───────── 기획 탭 ───────── */
function Plans({ P, set, today, openId, setOpenId }) {
  const [nt, setNt] = useState({ title: '', due: '' });
  const [printing, setPrinting] = useState(false);
  const plan = P.plans.find(p => p.id === openId) || null;
  const add = () => {
    if (!nt.title.trim()) return;
    const id = uid();
    set(x => ({ ...x, plans: [...x.plans, { id, title: nt.title.trim(), status: '아이디어', due: nt.due, topicIds: [], sec: {}, created: today, updated: today }] }));
    setNt({ title: '', due: '' }); setOpenId(id);
  };
  const upd = (id, patch) => set(x => ({ ...x, plans: x.plans.map(p => (p.id === id ? { ...p, ...patch, updated: today } : p)) }));
  const move = (p, k) => { const i = PLAN_STATUS.indexOf(p.status) + k; if (i >= 0 && i < 4) upd(p.id, { status: PLAN_STATUS[i] }); };

  useEffect(() => { if (openId) document.getElementById('pr-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [openId]);

  return (
    <>
      <section className="panel">
        <div className="csum-h"><h2>기획 보드</h2><span className="muted">카드를 누르면 기획서를 엽니다 · ◀ ▶ 로 단계 이동</span></div>
        <div className="pr-add pr-add-row">
          <input value={nt.title} onChange={e => setNt({ ...nt, title: e.target.value })} onKeyDown={e => e.key === 'Enter' && add()} placeholder="새 기획 제목" aria-label="새 기획 제목" />
          <label className="pr-due">마감<input type="date" value={nt.due} onChange={e => setNt({ ...nt, due: e.target.value })} aria-label="기획 마감" /></label>
          <button className="btn primary" onClick={add} disabled={!nt.title.trim()}>기획 추가</button>
        </div>
        <div className="pr-board">{PLAN_STATUS.map(st => {
          const col = P.plans.filter(p => p.status === st).sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));
          return (
            <div key={st} className={`pr-col ${st === '보류' ? 'hold' : ''}`} aria-label={st}>
              <h3>{st} <span className="muted">{col.length}</span></h3>
              {col.map(p => {
                const d = ddayOf(p.due, today), live = st !== '확정' && st !== '보류';
                return (
                  <div key={p.id} className={`pr-kc ${p.id === openId ? 'on' : ''}`}>
                    <button className="pr-kt" onClick={() => setOpenId(p.id === openId ? null : p.id)}>{p.title}</button>
                    <div className="pr-km">
                      {d != null && <span className={`pr-dd ${live && d < 0 ? 'late' : live && d <= 3 ? 'soon' : ''}`}>{live ? ddayText(d) : md(p.due)}</span>}
                      {(p.topicIds || []).length > 0 && <span className="muted">조사 {p.topicIds.length}</span>}
                      <span className="grow" />
                      {live && <><button className="btn xs" onClick={() => move(p, -1)} disabled={st === '아이디어'} aria-label="이전 단계">◀</button>
                        <button className="btn xs" onClick={() => move(p, 1)} aria-label="다음 단계">▶</button></>}
                    </div>
                  </div>);
              })}
            </div>);
        })}</div>
        {!P.plans.length && <p className="muted">아직 기획이 없습니다. 제목을 적어 추가하거나, 조사 탭에서 "기획안으로 만들기"를 누르세요.</p>}
      </section>

      {plan && <Editor key={plan.id} P={P} plan={plan} upd={patch => upd(plan.id, patch)} set={set} close={() => setOpenId(null)} onPrint={() => setPrinting(true)} />}
      {plan && printing && <PlanPrint P={P} plan={plan} today={today} onClose={() => setPrinting(false)} />}
    </>
  );
}

function Editor({ P, plan, upd, set, close, onPrint }) {
  const [arm, setArm] = useState(false);
  const sec = plan.sec || {};
  const refs = P.sources.filter(s => (plan.topicIds || []).includes(s.topicId)).sort((a, b) => b.star - a.star);
  const toggleTopic = id => upd({ topicIds: (plan.topicIds || []).includes(id) ? plan.topicIds.filter(i => i !== id) : [...(plan.topicIds || []), id] });
  const del = () => { set(x => ({ ...x, plans: x.plans.filter(p => p.id !== plan.id) })); close(); };
  return (
    <section className="panel pr-editor" id="pr-editor" aria-label="기획서">
      <div className="csum-h">
        <input className="pr-title" value={plan.title} onChange={e => upd({ title: e.target.value })} aria-label="기획 제목" />
        <button className="btn primary sm" onClick={onPrint}>PDF로 저장</button>
        <button className="btn sm" onClick={close}>닫기</button>
      </div>
      <div className="pr-meta">
        <label>상태<select value={plan.status} onChange={e => upd({ status: e.target.value })}>{PLAN_STATUS.map(s => <option key={s}>{s}</option>)}</select></label>
        <label className="pr-due">마감<input type="date" value={plan.due || ''} onChange={e => upd({ due: e.target.value })} /></label>
        <span className="muted">작성 {md(plan.created)} · 수정 {md(plan.updated)}</span>
      </div>
      <div className="pr-secs">{SECTIONS.map(([k, name], i) => (
        <label key={k} className="pr-sec"><b>{i + 1}. {name}</b>
          <textarea rows={k === 's3' ? 6 : 3} value={sec[k] || ''} onChange={e => upd({ sec: { ...sec, [k]: e.target.value } })} placeholder={HINTS[k]} /></label>))}</div>
      <h3 className="pr-h3">참고 조사</h3>
      {P.topics.length ? <div className="chips pr-links">{P.topics.map(t => <button key={t.id} aria-pressed={(plan.topicIds || []).includes(t.id)} onClick={() => toggleTopic(t.id)}>{t.title}</button>)}</div>
        : <p className="muted">조사 탭에서 주제를 만들면 여기서 연결할 수 있습니다.</p>}
      {refs.length > 0 && <ul className="pr-refs">{refs.map(s => <li key={s.id}><span className="pr-stars">{stars(s.star)}</span> {s.title}{s.from ? ` · ${s.from}` : ''}</li>)}</ul>}
      <div className="pr-foot">
        {arm ? <><button className="btn danger sm" onClick={del}>정말 이 기획을 삭제할까요?</button><button className="btn sm" onClick={() => setArm(false)}>취소</button></>
          : <button className="btn sm" onClick={() => setArm(true)}>기획 삭제</button>}
      </div>
    </section>
  );
}
const HINTS = {
  s1: '배경과 목적 (왜 하는지)',
  s2: '다룰 안건을 한 줄씩',
  s3: '안건마다 핵심 내용 · 근거 자료',
  s4: '결론 · 결정 사항',
  s5: '담당 · 일정 · 다음 단계',
  s6: '예산, 리스크, 참고 사항 등',
};

/** 기획서 1건 A4 인쇄 (글자 검은색, 음영 없음, 내용은 모두 테두리 칸 안) */
function PlanPrint({ P, plan, today, onClose }) {
  const sec = plan.sec || {};
  const topics = P.topics.filter(t => (plan.topicIds || []).includes(t.id));
  const refs = P.sources.filter(s => (plan.topicIds || []).includes(s.topicId)).sort((a, b) => b.star - a.star || (a.date || '').localeCompare(b.date || ''));
  useEffect(() => {
    document.body.classList.add('report-open');
    const esc = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => { document.body.classList.remove('report-open'); window.removeEventListener('keydown', esc); };
  }, []);
  const print = () => {
    const t = document.title;
    document.title = `plan_${today.replace(/-/g, '')}`;                     // PDF 파일 이름 (영문)
    window.print();
    setTimeout(() => { document.title = t; }, 500);
  };
  return createPortal(
    <div className="rp-wrap" role="dialog" aria-label="기획서 미리보기">
      <div className="rp-bar no-print">
        <b>기획서</b><span className="grow" />
        <button className="btn primary" onClick={print}>PDF로 저장</button>
        <button className="btn" onClick={onClose}>닫기</button>
        <small>인쇄 창에서 대상을 "PDF로 저장"으로 고르세요.</small>
      </div>
      <article className="rp">
        <header className="rp-head">
          <p className="rp-kicker">근로 · 기획·조사</p>
          <h1>{plan.title}</h1>
          <table className="rp-meta"><tbody><tr>
            <th>상태</th><td>{plan.status}</td><th>마감</th><td>{dot(plan.due)}</td><th>작성일</th><td>{dot(today)}</td>
          </tr></tbody></table>
        </header>
        {SECTIONS.map(([k, name], i) => (
          <React.Fragment key={k}>
            <h2><span>{i + 1}</span>{name}</h2>
            <div className="rp-box"><p className="rp-pre">{(sec[k] || '').trim() || '-'}</p></div>
          </React.Fragment>))}
        {refs.length > 0 && <>
          <h2><span>참고</span>조사 자료 ({topics.map(t => t.title).join(', ')})</h2>
          <table className="rp-table"><thead><tr><th>No.</th><th>중요도</th><th>제목</th><th>출처</th><th>날짜</th><th>메모</th></tr></thead>
            <tbody>{refs.map((s, n) => (
              <tr key={s.id}><td className="c">{n + 1}</td><td className="c">{stars(s.star)}</td><td>{s.title}{s.url && <><br /><small className="pr-url">{s.url}</small></>}</td>
                <td>{s.from || '-'}</td><td className="c">{s.date ? md(s.date) : '-'}</td><td>{s.memo || '-'}</td></tr>))}</tbody></table>
        </>}
        <p className="rp-foot">Jcalender · 기획·조사</p>
      </article>
    </div>,
    document.body,
  );
}
