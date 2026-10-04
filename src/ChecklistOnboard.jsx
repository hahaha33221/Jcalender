import React, { useMemo, useState } from 'react';
import { AREAS, BASE_ROWS, CYCLES } from './data.js';
import { areaVar, useCtx } from './shared.jsx';

/* 체크리스트 온보딩: 클릭만으로 추천받아 만들기
   1) 관리할 것 고르기(영역별 주제) → 2) 체크 리듬 고르기 → 3) 추천 항목 확인 · 빼기 → 만들기
   추천 = 주제에 묶인 기본 항목(앱에 들어 있는 항목, 자동화 · 전용 화면과 연결) + 간단한 생활 루틴(내 항목으로 추가)
   결과는 store.checklist 에 저장 (data.js applyCategories): 고른 기본 항목만 보이게 hide 를 다시 계산, 생활 루틴은 custom */
const T = (id, a, label, desc, cats, extras = []) => ({ id, a, label, desc, cats, extras });
const X = (c, cat, action, detail = '') => ({ c, cat, action, detail });
export const TOPICS = [
  T('health', 'P', '건강 · 운동', '운동 · 수면 · 식단 기록, 병원 · 검진', ['건강 관리'], [X('D', '건강 관리', '물 2L 마시기'), X('D', '건강 관리', '스트레칭 10분')]),
  T('money', 'P', '돈 관리', '지출 입력 · 예산 · 카드값 · 고정비', ['개인 재무'], [X('M', '개인 재무', '카드값 · 고정비 확인', '구독 · 자동이체가 예상과 같은지')]),
  T('study', 'P', '공부 · 자기계발', '학습 기록 · 독서', ['자기계발/학습'], [X('D', '자기계발/학습', '책 20쪽 읽기')]),
  T('people', 'P', '사람 · 기념일', '연락 챙기기 · 생일 · 기념일', ['인맥 관리', '기념일 관리']),
  T('journal', 'P', '일기 · 회고', '하루 기록 · 주간 회고', ['저널링'], [X('D', '저널링', '하루 한 줄 일기')]),
  T('life', 'P', '생활 · 집안일', '정리 · 장보기 · 공과금', [], [X('D', '생활 관리', '정리정돈 10분'), X('W', '생활 관리', '장보기 목록 정리'), X('W', '생활 관리', '분리수거 · 쓰레기 버리기'), X('M', '생활 관리', '공과금 · 관리비 납부 확인')]),
  T('leisure', 'P', '여가 · 취미', '여행 · 취미 · 문화생활 계획', ['여가 관리']),
  T('pgoal', 'P', '개인 목표', '목표 세우기 · 진행률 점검', ['목표 관리']),
  T('work', 'W', '업무 할 일', '오늘 할 일 · 프로젝트 진행', ['업무 할일/프로젝트'], [X('D', '업무 할일/프로젝트', '오늘 꼭 할 일 3개 정하기'), X('D', '업무 할일/프로젝트', '퇴근 전 내일 할 일 적기')]),
  T('wdocs', 'W', '문서 · 기획', '문서 정리 · 기획 · 조사', ['업무 문서', '기획·조사']),
  T('wcontact', 'W', '업무 연락처', '명함 · 연락처 정리', ['업무 연락처']),
  T('wgoal', 'W', '업무 목표', '업무 목표 · 진행률', ['목표 관리']),
  T('sales', 'B', '매출 · 세금', '매출 · 매입 기록, 부가세 · 정산', ['매출/매입', '세금/정산']),
  T('customer', 'B', '고객 · 거래처', '문의 응대 · 고객 · 거래처 관리', ['고객 관리', '파트너/거래처']),
  T('content', 'B', '콘텐츠 · 마케팅', '콘텐츠 발행 · 광고 · 영업', ['콘텐츠 관리', '마케팅/영업']),
  T('project', 'B', '프로젝트 · 일정', '외주 · 사업 할 일 · 일정', ['프로젝트/외주', '사업 할일/일정', '사업 일정/캘린더']),
  T('stock', 'B', '재고 · 상품', '재고 확인 · 발주 · 상품 관리', ['재고/상품']),
  T('fund', 'B', '계약 · 자금', '계약서 · 자금 · 투자', ['계약서/문서', '사업 자금/투자']),
  T('bgoal', 'B', '사업 목표 · 회고', '사업 목표 · 주간 회고', ['목표 관리', '사업 목표 관리', '리뷰/회고']),
];
export const RHYTHM = {
  light: { label: '가볍게', desc: '매일 할 것 위주 · 주제마다 3개까지', cycles: ['D', 'W'], max: 3 },
  basic: { label: '기본', desc: '매일 + 주간 · 월간 점검', cycles: ['D', 'W', 'M', 'S'], max: 6 },
  full: { label: '꼼꼼하게', desc: '연간 점검까지 모두', cycles: ['D', 'S', 'W', 'M', 'Y'], max: 99 },
};
const ORDER = { D: 0, W: 1, M: 2, S: 3, Y: 4 };
const uid = () => `u${Math.random().toString(36).slice(2, 10)}`;
const key = (a, cat, action) => `${a}|${cat}|${action}`;

/** 고른 주제 · 리듬 → 추천 항목 [{ topic, items: [{ k, base?, row?, extra? }] }] */
export function recommend(topicIds, rhythm) {
  const R = RHYTHM[rhythm] || RHYTHM.basic, base = BASE_ROWS();
  return TOPICS.filter(t => topicIds.includes(t.id)).map(t => {
    const ex = t.extras.filter(x => R.cycles.includes(x.c)).map(x => ({ k: `x:${t.id}:${x.action}`, a: t.a, c: x.c, cat: x.cat, action: x.action, detail: x.detail, extra: x }));
    const rows = base.filter(r => r.a === t.a && t.cats.includes(r.cat) && R.cycles.includes(r.c))
      .sort((x, y) => ORDER[x.c] - ORDER[y.c]).map(r => ({ k: r.id, a: r.a, c: r.c, cat: r.cat, action: r.action.replace(' (제안)', ''), detail: r.detail, row: r }));
    return { topic: t, items: [...ex, ...rows].slice(0, Math.max(R.max, ex.length)) };
  }).filter(g => g.items.length);
}

/** 고른 항목을 체크리스트에 반영 (mode: add 지금 목록에 더하기 · replace 새로 만들기) */
export function applyPicks(cl, picks, mode) {
  const C = cl || {}, base = BASE_ROWS().map(r => r.id);
  const pickedBase = new Set(picks.filter(p => p.row).map(p => p.row.id));
  const before = C.base === 'none' ? new Set() : new Set(base.filter(id => !(C.hide || []).includes(id)));
  const after = mode === 'replace' ? pickedBase : new Set([...before, ...pickedBase]);
  const oldCustom = mode === 'replace' ? [] : (C.custom || []);
  const have = new Set(oldCustom.map(r => key(r.a, r.cat, r.action)));
  const added = picks.filter(p => p.extra && !have.has(key(p.a, p.cat, p.action)))
    .map(p => ({ id: uid(), a: p.a, c: p.c, cat: p.cat, item: p.cat, action: p.action, detail: p.detail || '' }));
  const next = { ...C, custom: [...oldCustom, ...added], hide: base.filter(id => !after.has(id)) };
  if (after.size) delete next.base; else next.base = 'none';
  return next;
}

export default function ChecklistOnboard({ onDone, onCancel }) {
  const { setStore } = useCtx();
  const [step, setStep] = useState(1);
  const [topics, setTopics] = useState([]);
  const [rhythm, setRhythm] = useState('basic');
  const [off, setOff] = useState(new Set());               // 추천에서 뺀 항목
  const [mode, setMode] = useState('add');
  const { store } = useCtx();
  const hasList = useMemo(() => {
    const C = store.checklist || {};
    return (C.custom || []).length > 0 || C.base !== 'none';
  }, [store.checklist]);
  const recs = useMemo(() => recommend(topics, rhythm), [topics, rhythm]);
  const all = recs.flatMap(g => g.items), picked = all.filter(i => !off.has(i.k));
  const toggleTopic = id => setTopics(t => (t.includes(id) ? t.filter(x => x !== id) : [...t, id]));
  const toggle = k => setOff(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const setGroup = (g, on) => setOff(s => { const n = new Set(s); g.items.forEach(i => (on ? n.delete(i.k) : n.add(i.k))); return n; });
  const create = () => {
    setStore(s => ({ ...s, checklist: applyPicks(s.checklist, picked, hasList ? mode : 'replace') }));
    onDone(picked.length);
  };

  const Steps = (
    <ol className="cob-steps" aria-label="단계">
      {['관리할 것', '체크 리듬', '추천 확인'].map((n, i) => <li key={n} className={step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''}><b>{i + 1}</b>{n}</li>)}
    </ol>
  );

  return (
    <section className="panel cob" aria-label="체크리스트 추천받기">
      <div className="cob-h"><h2>체크리스트 추천받기</h2><span className="muted">클릭만 하면 나에게 맞는 체크리스트를 만들어 드려요</span>
        <button className="btn sm grow-r" onClick={onCancel}>닫기</button></div>
      {Steps}

      {step === 1 && <>
        <p className="cob-q">무엇을 챙기고 싶나요? <span className="muted">여러 개 골라도 됩니다</span></p>
        {Object.entries(AREAS).map(([a, A]) => (
          <div key={a} className="cob-area" style={{ '--ac': areaVar(a) }}>
            <h3><i className="dot" />{A.n}</h3>
            <div className="cob-cards">{TOPICS.filter(t => t.a === a).map(t => (
              <button key={t.id} type="button" className={`cob-card ${topics.includes(t.id) ? 'on' : ''}`} aria-pressed={topics.includes(t.id)} onClick={() => toggleTopic(t.id)}>
                <b>{t.label}</b><small>{t.desc}</small><span className="cob-tick" aria-hidden="true">{topics.includes(t.id) ? '✓' : '+'}</span></button>))}</div>
          </div>))}
        <div className="cob-foot"><span className="muted">{topics.length ? `${topics.length}개 골랐어요` : '하나 이상 골라 주세요'}</span>
          <button className="btn primary" disabled={!topics.length} onClick={() => setStep(2)}>다음</button></div>
      </>}

      {step === 2 && <>
        <p className="cob-q">얼마나 자주 체크할까요?</p>
        <div className="cob-cards cob-rhythm">{Object.entries(RHYTHM).map(([k, R]) => {
          const n = recommend(topics, k).reduce((s, g) => s + g.items.length, 0);
          return (
            <button key={k} type="button" className={`cob-card ${rhythm === k ? 'on' : ''}`} aria-pressed={rhythm === k} onClick={() => { setRhythm(k); setOff(new Set()); }}>
              <b>{R.label}</b><small>{R.desc}</small><small className="cob-n">추천 {n}개 · {R.cycles.map(c => CYCLES[c].replace('체크', '').replace('-루틴', '')).join(' · ')}</small>
              <span className="cob-tick" aria-hidden="true">{rhythm === k ? '✓' : ''}</span></button>);
        })}</div>
        <div className="cob-foot"><button className="btn" onClick={() => setStep(1)}>이전</button>
          <button className="btn primary grow-r" onClick={() => setStep(3)}>추천 보기</button></div>
      </>}

      {step === 3 && <>
        <p className="cob-q">이렇게 추천해요 <span className="muted">필요 없는 항목은 눌러서 빼세요 · 나중에 "체크리스트 편집"에서 언제든 고칠 수 있어요</span></p>
        <div className="cob-recs">{recs.map(g => {
          const on = g.items.filter(i => !off.has(i.k)).length;
          return (
            <div key={g.topic.id} className="cob-group" style={{ '--ac': areaVar(g.topic.a) }}>
              <div className="cob-gh"><i className="dot" /><b>{AREAS[g.topic.a].n} · {g.topic.label}</b><span className="muted">{on}/{g.items.length}</span>
                <button className="linkish grow-r" onClick={() => setGroup(g, on < g.items.length)}>{on < g.items.length ? '모두 넣기' : '모두 빼기'}</button></div>
              {g.items.map(i => (
                <label key={i.k} className={`cob-item ${off.has(i.k) ? 'off' : ''}`}>
                  <input type="checkbox" checked={!off.has(i.k)} onChange={() => toggle(i.k)} />
                  <span className="grow"><b>{i.action}</b>{i.detail && <small className="muted"> · {i.detail}</small>}</span>
                  <span className={`cyc c-${i.c}`}>{CYCLES[i.c].replace('체크', '').replace('-루틴', '')}</span>
                </label>))}
            </div>);
        })}</div>
        {hasList && <div className="cob-mode" role="radiogroup" aria-label="만드는 방법">
          <label><input type="radio" name="cob-mode" checked={mode === 'add'} onChange={() => setMode('add')} /> 지금 체크리스트에 더하기</label>
          <label><input type="radio" name="cob-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} /> 이 추천으로 새로 만들기 <small className="muted">(지금 목록은 빼고, 체크 기록은 남음)</small></label>
        </div>}
        <div className="cob-foot"><button className="btn" onClick={() => setStep(2)}>이전</button>
          <button className="btn primary grow-r" disabled={!picked.length} onClick={create}>{picked.length}개로 체크리스트 만들기</button></div>
      </>}
    </section>
  );
}
