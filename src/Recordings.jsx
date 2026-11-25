/* 대시보드 맨 아래 · 녹음 · 회의록 (관리자만) — server/recordings.mjs
   - 휴대폰 녹음이 녹음 서버에 올라오면 서버가 받아 적고(STT) AI 가 회의록(1. 개요 ~ 6. 기타)으로 정리한다
   - 화면이 보이는 동안 30초마다 (처리 중인 것이 있으면 10초마다) 목록을 다시 받아 저절로 바뀐다
   - 회의록 창: 녹음 듣기 · 회의록 · 전문 · 복사 · 다시 만들기 · 지우기 · 할 일을 캘린더 일정으로
   - 예전 녹음 올리기: 여러 파일 · 폴더 고르기 → 3MB 조각으로 차례로 올림 (파일별 진행), 같은 내용은 "이미 있음", 기본은 회의록 안 만듦
     TXT(받아 적은 글 · 메모)도 같이: 한글 인코딩(UTF-8 · UTF-16 · EUC-KR/CP949)을 풀어 글로 보냄 → 받아쓰기 없이 회의록
     녹음을 먼저 올리고 TXT 는 나중에 (같은 이름의 녹음이 있으면 그 녹음의 받아쓴 글로 붙음)
   - 설정 창: 녹음 서버 연결 상태 · 휴대폰 업로드 주소 · 토큰, OpenAI · Anthropic 키 넣기, 회의록 모델 · 자동 정리 (터미널 없이) */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { iso } from './data.js';
import { Popup, useCtx } from './shared.jsx';
import { API_BASE } from './serverSync.js';
import { uid } from './ideas.js';
import { unzipSync, strFromU8 } from 'fflate';
import { writeXlsx, download } from './xlsx.js';
/** 표 → 엑셀 시트 (머리글 굵게, 내용은 테두리 · 줄바꿈, 셀 병합 없음) */
const xsheet = (name, rows, cols) => ({ name, rows, cols, rowStyle: Object.fromEntries(rows.map((_, i) => [i, i === 0 ? 1 : 2])) });

const STATUS = { idle: '수동', queued: '대기', stt: '받아쓰는 중', summary: '정리 중', done: '완료', failed: '실패', skipped: '건너뜀' };
const BUSY = ['queued', 'stt', 'summary'];
const VIEWS = { all: '전체', done: '완료', busy: '진행 중', todo: '실패 · 수동' };
const inView = (v, s) => v === 'all' || (v === 'done' && s === 'done') || (v === 'busy' && BUSY.includes(s)) || (v === 'todo' && ['idle', 'failed', 'skipped'].includes(s));
const PAGE = 10;
const p2 = n => String(n).padStart(2, '0');
const ymd = s => { if (!s) return ''; const d = new Date(s); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
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

/* 할 일 보기 기간 (YYYY-MM-DD 문자열로 계산, 주는 월요일 시작) */
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const dOf = k => new Date(`${k}T00:00:00`);
const addDays = (k, n) => { const x = dOf(k); x.setDate(x.getDate() + n); return iso(x); };
const addMonths = (k, n) => { const x = dOf(k); x.setDate(1); x.setMonth(x.getMonth() + n); return iso(x); };
const dayLabel = (k, yr) => { const x = dOf(k); return `${yr || x.getFullYear() !== new Date().getFullYear() ? `${x.getFullYear()}. ` : ''}${x.getMonth() + 1}/${x.getDate()} (${WD[x.getDay()]})`; };
export function taskSpan(mode, k) {
  const x = dOf(k);
  if (mode === 'day') return { from: k, to: k, label: dayLabel(k, true) };
  if (mode === 'week') { const from = addDays(k, -((x.getDay() + 6) % 7)), to = addDays(from, 6); return { from, to, label: `${dayLabel(from)} ~ ${dayLabel(to)}` }; }
  if (mode === 'month') { const from = `${k.slice(0, 7)}-01`, to = addDays(addMonths(from, 1), -1); return { from, to, label: `${x.getFullYear()}년 ${x.getMonth() + 1}월` }; }
  return null;
}

/** 회의록 대시보드: 숫자 · 할 일 모음(끝냄 · 캘린더) · 종류 · 월별 · 자주 만난 사람 · 최근 회의록 */
const NONE = '미선정';
const DEFAULT_CATS = ['업무', '거래처', '개인'];
const tkey = t => `${t.id}|${t.i}`;
const monthOfTask = t => (t.due || ymd(t.at)).slice(0, 7);
const ymLabel = m => `${m.slice(0, 4)}년 ${Number(m.slice(5))}월`;

function MinutesDash({ version, onOpen, onFind }) {
  const { sync, store, setStore, now } = useCtx();
  const cats = Array.isArray(store.taskCats) ? store.taskCats : DEFAULT_CATS;   // 할 일 분류 (직접 추가 · 수정, 앱 데이터로 저장 · 동기화)
  const catOf = t => { const c = store.taskCatOf?.[tkey(t)]; return c && cats.includes(c) ? c : NONE; };
  const setCat = (t, c) => setStore(s => { const m = { ...(s.taskCatOf || {}) }; if (c === NONE) delete m[tkey(t)]; else m[tkey(t)] = c; return { ...s, taskCatOf: m }; });
  const [catF, setCatF] = useState('all');
  const [pick, setPick] = useState('');
  const [editCats, setEditCats] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [xm, setXm] = useState(() => iso(now).slice(0, 7));     // 엑셀로 받을 달
  const [xmsg, setXmsg] = useState('');
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [tf, setTf] = useState('open');                        // open(전체) · late(기한 지남) · month · week · day
  const [tn, setTn] = useState(10);
  const [anchor, setAnchor] = useState(() => iso(now));          // 월 · 주 · 일 보기의 기준 날짜
  const [added, setAdded] = useState({});
  const load = useCallback(async () => {
    try { setD(await sync.request('/api/minutes/dashboard')); setErr(''); }
    catch (e) { setErr(e.status === 404 && e.server ? '서버 업데이트가 필요합니다 (맥북에서 bash server/deploy/update.sh)' : e.message); }
  }, [sync]);
  useEffect(() => { load(); }, [load, version]);
  const done = async t => {
    try { await sync.request('/api/minutes/step', { method: 'POST', body: { id: t.id, i: t.i, done: true } }); await load(); } catch (e) { setErr(e.message); }
  };
  const toCal = t => {
    setStore(s => ({ ...s, events: [...(s.events || []), { id: uid(), date: t.due || iso(now), time: t.time || '', end: '', title: t.task, area: 'W', memo: `회의록: ${t.title}${t.owner ? ` · 담당 ${t.owner}` : ''}` }] }));
    setAdded(a => ({ ...a, [`${t.id}|${t.i}`]: true }));
  };
  if (err) return <p className="rec-msg bad">{err}</p>;
  if (!d) return <p className="muted">회의록 대시보드를 불러오는 중…</p>;
  if (!d.total) return <p className="muted rec-empty">아직 완료된 회의록이 없습니다. 녹음이 정리되거나, "예전 녹음 · 회의록 올리기"로 Word 회의록을 올리면 여기에 모입니다.</p>;
  const span = taskSpan(tf, anchor);
  const inView = d.tasks.list.filter(t => (tf === 'late' ? t.due && t.due < d.today : span ? t.due && t.due >= span.from && t.due <= span.to : true));
  const catCount = c => inView.filter(t => catOf(t) === c).length;
  const tasks = catF === 'all' ? inView : inView.filter(t => catOf(t) === catF);
  const undated = tf === 'open' ? tasks.filter(t => !t.due) : [];
  const dated = tf === 'open' ? tasks.filter(t => t.due) : tasks;
  // 날짜별 묶음 (주 보기는 빈 날도 보여 줌)
  const groups = [];
  if (tf === 'week') for (let i = 0; i < 7; i++) { const k = addDays(span.from, i); groups.push({ key: k, items: dated.filter(t => t.due === k) }); }
  else for (const t of dated.slice(0, tf === 'month' || tf === 'day' ? 1000 : tn)) { const g = groups[groups.length - 1]; if (g?.key === t.due) g.items.push(t); else groups.push({ key: t.due, items: [t] }); }
  const row = t => (
    <li key={`${t.id}|${t.i}`} className={t.due && t.due < d.today ? 'late' : ''}>
      <input type="checkbox" aria-label="끝냄" onChange={() => done(t)} />
      <span className="grow"><button className={`md-cat${catOf(t) === NONE ? ' none' : ''}`} aria-expanded={pick === tkey(t)} title="분류 바꾸기" onClick={() => setPick(pick === tkey(t) ? '' : tkey(t))}>{catOf(t)}</button><span>{t.task}</span>{t.owner && <span className="tag">{t.owner}</span>}{t.time && <span className="tag">{t.time}</span>}
        <button className="md-src" onClick={() => onOpen(t.id)}>{t.title}</button>
        {pick === tkey(t) && <span className="md-pick">{[...cats, NONE].map(c => <button key={c} className={`md-cat${c === NONE ? ' none' : ''}`} aria-pressed={catOf(t) === c} onClick={() => { setCat(t, c); setPick(''); }}>{c}</button>)}</span>}</span>
      <button className="btn sm" disabled={added[`${t.id}|${t.i}`]} onClick={() => toCal(t)}>{added[`${t.id}|${t.i}`] ? '추가함' : '캘린더에'}</button>
    </li>);
  const addCat = () => { const c = newCat.trim().slice(0, 20); if (!c || c === NONE || cats.includes(c)) { setNewCat(''); return; } setStore(s => ({ ...s, taskCats: [...cats, c] })); setNewCat(''); };
  const removeCat = c => setStore(s => ({ ...s, taskCats: cats.filter(x => x !== c) }));
  const renameCat = (from, to) => {
    to = String(to || '').trim().slice(0, 20);
    if (!to || to === from || to === NONE || cats.includes(to)) return;
    setStore(s => ({ ...s, taskCats: cats.map(x => (x === from ? to : x)), taskCatOf: Object.fromEntries(Object.entries(s.taskCatOf || {}).map(([k, v]) => [k, v === from ? to : v])) }));
    if (catF === from) setCatF(to);
  };
  // 엑셀: 그 달의 할 일 (기한이 그 달, 기한이 없으면 회의 날짜로) · 의사결정 (회의록 "4. 결론")
  const allTasks = [...d.tasks.list, ...(d.tasks.doneList || [])];
  const xMonths = [...new Set([iso(now).slice(0, 7), ...d.months.map(x => x.month), ...allTasks.map(monthOfTask), ...(d.decisions || []).map(x => ymd(x.at).slice(0, 7))])].filter(Boolean).sort().reverse();
  const exportTodos = () => {
    const list = allTasks.filter(t => monthOfTask(t) === xm).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || String(a.at).localeCompare(String(b.at)));
    if (!list.length) { setXmsg(`${ymLabel(xm)}에 할 일이 없습니다.`); return; }
    const rows = [['번호', '기한', '시간', '할 일', '담당', '분류', '상태', '회의록', '회의 날짜'],
      ...list.map((t, n) => [n + 1, t.due || '기한 없음', t.time || '', t.task, t.owner || '', catOf(t), t.done ? '끝냄' : t.due && t.due < d.today ? '기한 지남' : '남음', t.title, ymd(t.at)])];
    const byCat = [...cats, NONE].map(c => { const x = list.filter(t => catOf(t) === c); return [c, x.length, x.filter(t => !t.done).length, x.filter(t => t.done).length]; });
    download(writeXlsx([
      xsheet(`할 일 ${Number(xm.slice(5))}월`, rows, [6, 12, 7, 50, 10, 10, 10, 30, 12]),
      xsheet('분류별', [['분류', '전체', '남음', '끝냄'], ...byCat, ['합계', list.length, list.filter(t => !t.done).length, list.filter(t => t.done).length]], [14, 8, 8, 8]),
    ]), `todos_${xm}.xlsx`);
    setXmsg(`${ymLabel(xm)} 할 일 ${list.length}건을 엑셀로 받았습니다${d.tasks.doneList ? '' : ' (끝낸 할 일은 서버 업데이트 뒤에 들어갑니다)'}.`);
  };
  const exportDecisions = () => {
    if (!d.decisions) { setXmsg('의사결정 엑셀은 서버 업데이트 뒤에 쓸 수 있습니다 (맥북에서 bash server/deploy/update.sh).'); return; }
    const list = d.decisions.filter(x => ymd(x.at).slice(0, 7) === xm).sort((a, b) => String(a.at).localeCompare(String(b.at)));
    if (!list.length) { setXmsg(`${ymLabel(xm)}에 결론(의사결정)이 적힌 회의록이 없습니다.`); return; }
    let n = 0;
    const rows = [['번호', '회의 날짜', '회의록', '종류', '참석자', '안건', '결정 내용', '출처'], ...list.flatMap(x => x.conclusion.map(c => [++n, ymd(x.at), x.title, x.kind, x.participants, x.agenda, c, x.source]))];
    download(writeXlsx([
      xsheet(`의사결정 ${Number(xm.slice(5))}월`, rows, [6, 12, 30, 8, 22, 30, 60, 12]),
      xsheet('회의별', [['회의 날짜', '회의록', '참석자', '목적', '결정 수', '결정 내용', '할 일 수'], ...list.map(x => [ymd(x.at), x.title, x.participants, x.purpose, x.conclusion.length, x.conclusion.map(c => `- ${c}`).join('\n'), x.steps])], [12, 30, 22, 30, 8, 60, 8]),
    ]), `decisions_${xm}.xlsx`);
    setXmsg(`${ymLabel(xm)} 의사결정 ${n}건 (회의 ${list.length}개)을 엑셀로 받았습니다.`);
  };
  const move = n => setAnchor(a => (tf === 'month' ? addMonths(a, n) : addDays(a, tf === 'week' ? 7 * n : n)));
  const maxM = Math.max(1, ...d.months.map(x => x.n));
  return (
    <div className="md">
      <div className="md-stats">
        <div><b>{d.total}</b><span>전체 회의록</span></div>
        <div><b>{d.thisMonth}</b><span>이번 달</span></div>
        <div><b>{d.thisWeek}</b><span>이번 주</span></div>
        <div><b>{d.tasks.open}</b><span>남은 할 일</span></div>
        <div className={d.tasks.overdue ? 'md-late' : ''}><b>{d.tasks.overdue}</b><span>기한 지남</span></div>
      </div>
      <div className="md-xbar">
        <span>엑셀로 받기</span>
        <select value={xm} onChange={e => { setXm(e.target.value); setXmsg(''); }} aria-label="받을 달">{xMonths.map(m => <option key={m} value={m}>{ymLabel(m)}</option>)}</select>
        <button className="btn sm" onClick={exportTodos}>할 일 엑셀</button>
        <button className="btn sm" onClick={exportDecisions}>의사결정 엑셀</button>
        {xmsg && <span className="muted">{xmsg}</span>}
      </div>
      <div className="md-grid">
        <section className="md-card md-tasks"><h3>할 일 모음 <small className="muted">회의록의 "5. 향후 진행 사항" · 끝낸 것 {d.tasks.done}</small></h3>
          <div className="md-tbar">
            <div className="chips">{[['open', '전체'], ['month', '월'], ['week', '주'], ['day', '일'], ['late', '기한 지남']].map(([k, l]) => <button key={k} aria-pressed={tf === k} onClick={() => { setTf(k); setTn(10); }}>{l}</button>)}</div>
            {span && <div className="md-nav"><button className="btn sm" aria-label="이전" onClick={() => move(-1)}>‹</button><b>{span.label}</b><button className="btn sm" aria-label="다음" onClick={() => move(1)}>›</button>
              <button className="btn sm" onClick={() => setAnchor(iso(now))}>{tf === 'month' ? '이번 달' : tf === 'week' ? '이번 주' : '오늘'}</button><span className="muted">{tasks.length}건</span></div>}
          </div>
          <div className="md-cbar">
            <span className="muted">분류</span>
            <div className="chips">{[['all', `전체 ${inView.length}`], ...cats.map(c => [c, `${c} ${catCount(c)}`]), [NONE, `${NONE} ${catCount(NONE)}`]].map(([k, l]) => <button key={k} aria-pressed={catF === k} onClick={() => setCatF(k)}>{l}</button>)}</div>
            <button className="btn sm" onClick={() => setEditCats(!editCats)}>{editCats ? '분류 편집 닫기' : '분류 편집'}</button>
          </div>
          {editCats && <div className="md-cedit">
            {cats.map((c, i) => <span key={c} className="md-crow"><input defaultValue={c} aria-label={`분류 ${c} 이름`} onBlur={e => renameCat(c, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} /><button className="btn sm" aria-label={`${c} 지우기`} onClick={() => removeCat(c)}>×</button></span>)}
            <span className="md-crow"><input value={newCat} placeholder="새 분류 이름" onChange={e => setNewCat(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addCat(); }} /><button className="btn sm primary" onClick={addCat}>추가</button></span>
            <small className="muted">분류를 지우면 그 분류의 할 일은 "미선정"이 됩니다. 각 할 일 앞의 분류 버튼을 눌러 바꿉니다.</small>
          </div>}
          {groups.some(g => g.items.length) || undated.length ? (<>
            {groups.map(g => (tf === 'day' ? <ul key={g.key} className="md-tl">{g.items.map(row)}</ul> : (
              <div key={g.key} className={`md-day${g.key === d.today ? ' today' : ''}${g.key < d.today ? ' past' : ''}`}>
                <h4>{dayLabel(g.key)}{g.key === d.today && <span className="tag">오늘</span>}<small className="muted">{g.items.length ? `${g.items.length}건` : ''}</small></h4>
                {g.items.length ? <ul className="md-tl">{g.items.map(row)}</ul> : <p className="muted md-none">없음</p>}
              </div>)))}
            {tf === 'open' && dated.length > tn && <button className="btn sm rec-more" onClick={() => setTn(tn + 20)}>더 보기 ({dated.length - tn})</button>}
            {!!undated.length && <div className="md-day"><h4>기한 없음<small className="muted">{undated.length}건</small></h4><ul className="md-tl">{undated.slice(0, 10).map(row)}</ul>{undated.length > 10 && <p className="muted">외 {undated.length - 10}건 (회의록 창에서 확인)</p>}</div>}
          </>) : <p className="muted">{span ? `${span.label}에 기한인 할 일이 없습니다.` : '남은 할 일이 없습니다.'}</p>}
        </section>
        <section className="md-card"><h3>최근 회의록</h3>
          <ul className="md-recent">{d.recent.map(r => (
            <li key={r.id}><button onClick={() => onOpen(r.id)}><span className="md-at">{fmtAt(r.at)}</span><b>{r.title}</b>{r.kind && <span className="tag">{r.kind}</span>}<span className="muted md-sum">{r.summary}</span></button></li>))}</ul>
        </section>
        <section className="md-card"><h3>월별 회의록 <small className="muted">최근 12개월</small></h3>
          <ul className="md-bars">{d.months.map(x => (
            <li key={x.month}><button onClick={() => onFind(x.month)} title={`${x.month} 회의록 보기`}><span>{Number(x.month.slice(5))}월</span><i style={{ width: `${(x.n / maxM) * 100}%` }} /><em>{x.n}</em></button></li>))}</ul>
        </section>
        <section className="md-card"><h3>종류 · 자주 만난 사람</h3>
          <div className="md-chips">{d.kinds.map(k => <button key={k.kind} className="tag" onClick={() => onFind(k.kind)}>{k.kind} {k.n}</button>)}</div>
          {d.people.length ? <div className="md-chips">{d.people.map(p => <button key={p.name} className="tag" onClick={() => onFind(p.name)}>{p.name} {p.n}</button>)}</div> : <p className="muted">참석자가 적힌 회의록이 아직 없습니다.</p>}
        </section>
      </div>
    </div>
  );
}

/** 녹음 서버 상태 한 줄: 휴대폰 녹음이 안 보일 때 어디가 막혔는지 */
function RecDiag({ rec, openSetup }) {
  if (!rec) return <p className="rec-msg bad">VPS 서버가 아직 옛 버전입니다. 맥북 터미널에서 <code>cd ~/Jcalender &amp;&amp; git pull &amp;&amp; bash server/deploy/update.sh</code> 를 한 번 실행하세요.</p>;
  const t = rec.at ? new Date(rec.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '';
  if (!rec.ok) return <p className="rec-msg bad">녹음 서버: {rec.msg}{t ? ` (${t} 확인)` : ''} <button className="btn sm" onClick={openSetup}>설정 열기</button></p>;
  if (!rec.version) return <p className="rec-msg bad">녹음 서버가 옛 버전이라 TXT · mp4 · 확장자 없는 파일을 거절합니다 (MacroDroid 결과 415). 맥북 터미널에서 <code>cd ~/Jcalender &amp;&amp; git pull &amp;&amp; bash server/deploy/update.sh</code> 를 실행하세요. (지금 녹음 서버에 {rec.total}건)</p>;
  return <p className="muted rec-diag">녹음 서버 {rec.version} 연결됨 · 녹음 서버에 {rec.total}건{t ? ` · ${t} 확인` : ''}{rec.total === 0 ? ' · 휴대폰에서 아직 한 건도 올라오지 않았습니다 (MacroDroid 알림의 결과가 201 또는 200 이어야 올라간 것)' : ''}</p>;
}

export function RecordingsHome() {
  const { data, err, load } = useMinutes();
  const [view, setView] = useState('all');
  const [q, setQ] = useState('');
  const [n, setN] = useState(PAGE);
  const [open, setOpen] = useState(null);
  const [msg, setMsg] = useState('');
  const [setup, setSetup] = useState(false);
  const [up, setUp] = useState(false);
  const [tab, setTab] = useState('dash');
  const { sync } = useCtx();
  const items = data?.items || [];
  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    return items.filter(i => inView(view, i.status) && (!k || `${i.title} ${i.summary} ${i.filename} ${i.device} ${i.people || ''} ${ymd(i.at)}`.toLowerCase().includes(k)));
  }, [items, view, q]);
  const counts = useMemo(() => Object.fromEntries(Object.keys(VIEWS).map(v => [v, items.filter(i => inView(v, i.status)).length])), [items]);
  const run = async id => {
    setMsg('');
    try { await sync.request('/api/minutes/process', { method: 'POST', body: { id } }); await load(); }
    catch (e) { setMsg(e.message); }
  };
  const runMany = async rows => {
    if (!window.confirm(`수동 녹음 ${rows.length}건의 회의록을 만들까요?\n한 건씩 차례로 만들고, 비용은 녹음 1시간에 약 500원입니다 (위에서 검색 · 보기로 먼저 골라 둘 수 있습니다).`)) return;
    setMsg('');
    try { const r = await sync.request('/api/minutes/process', { method: 'POST', body: { ids: rows.map(x => x.id) } }); setMsg(`${r.queued}건을 대기열에 넣었습니다.`); await load(); }
    catch (e) { setMsg(e.message); }
  };
  const r = data?.ready;
  const missing = r && [!r.api && '녹음 서버 토큰(RECORDING_API_TOKEN)', !r.stt && '받아쓰기용 OpenAI 키', !r.ai && '회의록용 AI 키'].filter(Boolean);
  return (
    <section className="panel rec-home" aria-label="녹음 · 회의록">
      <div className="csum-h"><h2>녹음 · 회의록</h2>
        <span className="muted">{data ? `${items.length}건 · 완료 ${counts.done}${counts.busy ? ` · 진행 중 ${counts.busy}` : ''}${data.auto ? ` · 자동 정리 오늘 ${data.today}/${data.limit}` : ' · 자동 정리 꺼짐'}` : '불러오는 중…'}</span>
        <span className="ib-hb grow-r"><button className="btn sm" onClick={load}>새로고침</button><button className="btn sm" onClick={() => setUp(true)}>예전 녹음 · 회의록 올리기</button><button className="btn sm" onClick={() => setSetup(true)}>설정</button></span></div>
      {err && <p className="rec-msg bad">{err}</p>}
      {!!missing?.length && <p className="rec-msg">설정이 더 필요합니다: {missing.join(' · ')}. <button className="btn sm primary" onClick={() => setSetup(true)}>설정 열기</button></p>}
      {msg && <p className="rec-msg bad">{msg}</p>}
      {data && <RecDiag rec={data.rec} openSetup={() => setSetup(true)} />}
      {data && <div className="chips rec-tabs" role="tablist">
        <button role="tab" aria-pressed={tab === 'dash'} onClick={() => setTab('dash')}>회의록 대시보드</button>
        <button role="tab" aria-pressed={tab === 'list'} onClick={() => setTab('list')}>목록 <small>{items.length}</small></button></div>}
      {data && tab === 'dash' && <MinutesDash version={`${counts.done}|${items.length}`} onOpen={setOpen} onFind={k => { setQ(k); setView('all'); setTab('list'); setN(PAGE); }} />}
      {data && tab === 'list' && (<>
        <div className="rec-tools">
          <div className="chips">{Object.entries(VIEWS).map(([k, label]) => <button key={k} aria-pressed={view === k} onClick={() => { setView(k); setN(PAGE); }}>{label} <small>{counts[k]}</small></button>)}</div>
          <input className="rec-q" value={q} onChange={e => { setQ(e.target.value); setN(PAGE); }} placeholder="제목 · 요약 · 사람 · 날짜(2024-03) 검색" aria-label="녹음 검색" />
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
        {(() => { const idle = list.filter(i => i.status === 'idle'); return idle.length > 1 && (
          <p className="muted rec-bulk">회의록이 없는 수동 녹음 {idle.length}건 <button className="btn sm" onClick={() => runMany(idle)}>모두 회의록 만들기</button></p>); })()}
      </>)}
      {open && <MinutesPopup id={open} onClose={() => setOpen(null)} onChanged={load} />}
      {setup && <SettingsPopup onClose={() => { setSetup(false); load(); }} />}
      {up && <UploadPopup onClose={() => { setUp(false); load(); }} onUploaded={load} />}
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
  const [raw, setRaw] = useState(false);
  const toggleStep = async (i, done) => {
    try { const r = await sync.request('/api/minutes/step', { method: 'POST', body: { id, i, done } }); setIt(x => ({ ...x, minutes: { ...x.minutes, done_steps: r.done } })); onChanged(); }
    catch (e) { setNote(e.message); }
  };
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
        {!BUSY.includes(it.status) && (it.audio || it.hasText || m?.raw) && <button className="btn sm" onClick={redo}>{m?.source === 'file' ? 'AI 로 다시 정리' : m ? '다시 만들기' : '회의록 만들기'}</button>}
        {!['stt', 'summary'].includes(it.status) && <button className="btn sm danger" onClick={remove}>지우기</button>}
      </span>}>
      {err && <p className="rec-msg bad">{err}</p>}
      {note && <p className="rec-msg">{note}</p>}
      {it && (<div className="rec-pop">
        <div className="rec-audio">{it.audio === false ? <span className="rec-st">TXT</span> : typeof audio === 'string' && audio !== 'loading' ? <audio controls autoPlay src={audio} /> : <button className="btn sm" disabled={audio === 'loading'} onClick={listen}>{audio === 'loading' ? '녹음 받는 중…' : '녹음 듣기'}</button>}
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
            <li key={i} className={m.done_steps?.includes(i) ? 'rec-step-done' : ''}><input type="checkbox" aria-label="끝냄" checked={!!m.done_steps?.includes(i)} onChange={e => toggleStep(i, e.target.checked)} /><span className="grow">{x.task}{x.owner && <span className="tag">{x.owner}</span>}{x.due && <span className="tag">{x.due.slice(5).replace('-', '/')}{x.time ? ` ${x.time}` : ''}</span>}</span>
              <button className="btn sm" disabled={added[i]} onClick={() => toCalendar(x, i)}>{added[i] ? '추가함' : '캘린더에 추가'}</button></li>))}</ul> : <p className="muted">없음</p>}
          <h3>6. 기타</h3>
          {m.etc?.length ? <ul>{m.etc.map((c, i) => <li key={i}>{c}</li>)}</ul> : <p className="muted">없음</p>}
        </div>)}
        {m?.raw && <div className="rec-full">
          <button className="btn sm" onClick={() => setRaw(!raw)}>{raw ? '원문 접기' : '올린 회의록 원문 보기'}</button>
          {raw && <pre className="rec-tr">{m.raw}</pre>}
        </div>}
        {it.transcript && <div className="rec-full">
          <button className="btn sm" onClick={() => setFull(!full)}>{full ? '전문 접기' : `전문 보기 (${it.transcript.length.toLocaleString('ko-KR')}자)`}</button>
          {full && <pre className="rec-tr">{it.transcript}</pre>}
        </div>}
        {(it.sttModel || it.aiModel) && <p className="muted rec-model">받아쓰기 {it.sttModel || '-'} · 회의록 {it.aiModel || '-'}</p>}
      </div>)}
    </Popup>
  );
}

/** 녹음 · 회의록 설정 (관리자): 키는 서버 파일에만 저장되고 화면에는 가린 값만 보인다 */
function SettingsPopup({ onClose }) {
  const { sync } = useCtx();
  const [st, setSt] = useState(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [oa, setOa] = useState('');
  const [an, setAn] = useState('');
  const [rt, setRt] = useState('');
  const [show, setShow] = useState(false);
  const get = useCallback(async () => {
    try { setSt(await sync.request('/api/minutes/settings')); setErr(''); }
    catch (e) { setErr(e.status === 404 && e.server ? '서버 업데이트가 필요합니다 (이번 한 번만 맥북에서 bash server/deploy/update.sh)' : e.message); }
  }, [sync]);
  useEffect(() => { get(); }, [get]);
  const save = async (what, body, after) => {
    setBusy(what); setNote(''); setErr('');
    try { const r = await sync.request('/api/minutes/settings', { method: 'POST', body }); after?.(); setNote(['저장했습니다.', ...(r.notes || [])].join(' ')); await get(); }
    catch (e) { setErr(e.message); }
    finally { setBusy(''); }
  };
  const copy = async (t, label) => { try { await navigator.clipboard.writeText(t); setNote(`${label}를 복사했습니다.`); } catch { setNote('복사하지 못했습니다. 글자를 길게 눌러 직접 복사하세요.'); } };
  const FROM = { site: '사이트에서 넣음', server: '서버 설정 파일', '': '' };
  const keyRow = ({ label, help, k, val, setVal, ph, clearKey }) => {   // 함수로 부름 (컴포넌트로 쓰면 글자마다 입력 칸이 새로 생겨 포커스가 풀림)
    const cur = st?.[k];
    return (
      <div className="rs-key" key={k}>
        <div className="rs-kh"><b>{label}</b><span className={`rec-st ${cur?.set ? 'st-done' : 'st-failed'}`}>{cur?.set ? `설정됨 ${cur.masked}` : '없음'}</span>{cur?.from && <span className="muted">{FROM[cur.from]}</span>}</div>
        <p className="muted">{help}</p>
        <div className="rs-in">
          <input type="password" autoComplete="off" value={val} onChange={e => setVal(e.target.value)} placeholder={ph} aria-label={`${label} 입력`} />
          <button className="btn sm primary" disabled={!val.trim() || !!busy} onClick={() => save(k, { [k === 'openai' ? 'openaiKey' : 'anthropicKey']: val.trim() }, () => setVal(''))}>{busy === k ? '확인 중…' : cur?.set ? '바꾸기' : '저장'}</button>
          {cur?.from === 'site' && <button className="btn sm" disabled={!!busy} onClick={() => save(k, { clear: [clearKey] })}>사이트 값 지우기</button>}
        </div>
      </div>
    );
  };
  const r = st?.recording;
  return (
    <Popup wide title="녹음 · 회의록 설정" sub="키와 토큰은 서버에만 저장되고, 화면에는 가린 값만 보입니다." onClose={onClose}
      actions={<button className="btn sm" onClick={get}>다시 확인</button>}>
      {err && <p className="rec-msg bad">{err}</p>}
      {note && <p className="rec-msg">{note}</p>}
      {!st && !err && <p className="muted">불러오는 중…</p>}
      {st && (<div className="rs">
        <h3>1. 녹음 서버 (휴대폰 → 서버)</h3>
        <div className="rs-kh"><b>연결 상태</b>
          <span className={`rec-st ${r.auth ? 'st-done' : 'st-failed'}`}>{r.auth ? `연결됨 · 녹음 ${r.total ?? 0}건` : r.health ? '켜져 있음 · 토큰 확인 필요' : '응답 없음'}</span></div>
        {r.msg && <p className="muted">{r.msg}{!r.health ? ' · 서버 업데이트(update.sh)를 한 번 하면 녹음 서버도 함께 설치됩니다.' : ''}</p>}
        <p className="muted">휴대폰 MacroDroid 의 HTTP 요청(POST)에 아래 두 값을 넣으면 새 녹음이 자동으로 올라옵니다 (recording-api/macrodroid-guide.md).</p>
        <div className="rs-copy"><span className="rs-l">업로드 주소</span><code>{r.uploadUrl}?filename=[파일 이름]</code><button className="btn sm" onClick={() => copy(r.uploadUrl, '업로드 주소')}>복사</button></div>
        <div className="rs-copy"><span className="rs-l">헤더</span>
          {r.token ? <><code>Authorization: Bearer {show ? r.token : `${r.token.slice(0, 4)}••••••••${r.token.slice(-4)}`}</code>
            <button className="btn sm" onClick={() => setShow(!show)}>{show ? '가리기' : '보기'}</button>
            <button className="btn sm" onClick={() => copy(`Bearer ${r.token}`, '헤더 값')}>복사</button></> : <span className="muted">토큰 없음</span>}</div>
        <details className="rs-more"><summary>토큰 직접 넣기 (녹음 서버를 따로 설치한 경우)</summary>
          <div className="rs-in"><input type="password" autoComplete="off" value={rt} onChange={e => setRt(e.target.value)} placeholder="녹음 서버 API_TOKEN" aria-label="녹음 서버 토큰" />
            <button className="btn sm primary" disabled={!rt.trim() || !!busy} onClick={() => save('rec', { recToken: rt.trim() }, () => setRt(''))}>저장</button>
            {r.tokenFrom === 'site' && <button className="btn sm" disabled={!!busy} onClick={() => save('rec', { clear: ['recToken'] })}>사이트 값 지우기</button>}</div>
        </details>

        <h3>2. AI 키</h3>
        {keyRow({ label: 'OpenAI (받아쓰기)', k: 'openai', val: oa, setVal: setOa, ph: 'sk-proj-…', clearKey: 'openai',
          help: 'platform.openai.com › API keys 에서 만든 키. 녹음을 글로 받아 적을 때 씁니다 (아이디어 뱅크 받아쓰기 · 숏폼도 같이 씀).' })}
        {keyRow({ label: 'Anthropic (회의록 정리)', k: 'anthropic', val: an, setVal: setAn, ph: 'sk-ant-…', clearKey: 'anthropic',
          help: 'console.anthropic.com › API Keys 에서 만든 키. 받아쓴 글을 회의록으로 정리할 때 씁니다. 넣으면 그 회사에 바로 확인하고, 틀린 키는 저장하지 않습니다.' })}

        <h3>3. 회의록 만들기</h3>
        <div className="rs-in">
          <label className="rs-l" htmlFor="rs-model">회의록 모델</label>
          <select id="rs-model" value={st.model} disabled={!!busy} onChange={e => save('model', { model: e.target.value })}>
            {!st.models.some(m => m.id === st.model) && <option value={st.model}>{st.model}</option>}
            {st.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        </div>
        <div className="rs-in">
          <label className="rs-l" htmlFor="rs-stt">받아쓰기 모델</label>
          <select id="rs-stt" value={st.sttModel} disabled={!!busy} onChange={e => save('stt', { sttModel: e.target.value })}>
            {!st.sttModels.some(m => m.id === st.sttModel) && <option value={st.sttModel}>{st.sttModel}</option>}
            {st.sttModels.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        </div>
        <label className="rs-chk"><input type="checkbox" checked={st.auto} disabled={!!busy} onChange={e => save('auto', { auto: e.target.checked })} /> 새 녹음이 올라오면 자동으로 회의록 만들기 <small className="muted">(하루 {st.daily}건까지, 끄면 목록에서 버튼으로)</small></label>
        {st.provider !== 'anthropic' && <p className="muted">Anthropic 키가 없어서 지금은 ChatGPT 로 회의록을 만듭니다.</p>}
      </div>)}
    </Popup>
  );
}

/* ── 예전 녹음 올리기 ── */
const EXT_OK = /\.(m4a|mp4|m4b|mp3|amr|awb|wav|3gp|3ga|ogg|oga|opus|aac|flac|webm|wma)$/i;
const TXT_OK = /\.(txt|md|docx)$/i;
/** Word(docx) → 글: 문단 · 제목 · 목록(들여쓰기) · 표(칸은 " | ") */
export function docxText(buf) {
  const files = unzipSync(new Uint8Array(buf), { filter: f => f.name === 'word/document.xml' });
  const xml = files['word/document.xml'];
  if (!xml) throw new Error('Word 파일이 아니거나 손상되었습니다');
  const doc = new DOMParser().parseFromString(strFromU8(xml), 'application/xml');
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  if (!body) throw new Error('Word 내용을 읽지 못했습니다');
  const runText = p => {
    let t = '';
    const walk = n => { for (const c of n.childNodes) { if (c.namespaceURI !== W) continue; if (c.localName === 't') t += c.textContent; else if (c.localName === 'tab') t += ' '; else if (c.localName === 'br' || c.localName === 'cr') t += '\n'; else if (c.localName !== 'pPr' && c.localName !== 'rPr') walk(c); } };
    walk(p); return t;
  };
  // 목록 단계: 문단의 번호 매기기(numPr) 또는 "List Number 2" 같은 목록 스타일 (null = 목록 아님)
  const levelOf = p => {
    const pr = [...p.childNodes].find(c => c.localName === 'pPr');
    if (!pr) return null;
    const num = pr.getElementsByTagNameNS(W, 'numPr')[0];
    if (num) return Number(num.getElementsByTagNameNS(W, 'ilvl')[0]?.getAttributeNS(W, 'val') || 0);
    const st = pr.getElementsByTagNameNS(W, 'pStyle')[0]?.getAttributeNS(W, 'val') || '';
    const m = st.match(/^(?:List|ListBullet|ListNumber|ListParagraph|목록)\D*(\d)?$/i);
    return m ? Math.max(0, Number(m[1] || 1) - 1) : null;
  };
  const paras = [...body.getElementsByTagNameNS(W, 'p')];
  const deep = paras.some(p => (levelOf(p) || 0) > 0);
  const out = [], cnt = {};
  const para = p => {
    const t = runText(p).trim();
    if (!t) { cnt.reset = true; return; }
    const lv = levelOf(p);
    if (lv != null) {
      if (lv === 0 && deep) { if (cnt.reset) cnt.n = 0; cnt.n = (cnt.n || 0) + 1; cnt.reset = false; out.push(`${cnt.n}) ${t}`); }
      else out.push(`${'  '.repeat(Math.max(lv, deep ? 1 : 0))}- ${t}`);
    } else { cnt.n = 0; out.push(t); }
  };
  for (const n of body.childNodes) {
    if (n.namespaceURI !== W) continue;
    if (n.localName === 'p') para(n);
    else if (n.localName === 'tbl') {
      for (const tr of n.getElementsByTagNameNS(W, 'tr')) {
        const cells = [...tr.getElementsByTagNameNS(W, 'tc')].map(tc => [...tc.getElementsByTagNameNS(W, 'p')].map(runText).map(x => x.trim()).filter(Boolean).join(' / '));
        if (cells.some(Boolean)) out.push(cells.length === 2 && cells[0].length <= 10 ? `${cells[0]}: ${cells[1]}` : cells.join(' | '));
      }
    }
  }
  return out.join('\n');
}
/** TXT 글 읽기: BOM → UTF-8 (틀리면) → EUC-KR/CP949 (옛 한글 메모장 · 윈도) */
export function decodeText(buf) {
  const b = new Uint8Array(buf);
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b);
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(b); } catch { /* 한글 윈도 인코딩 */ }
  try { return new TextDecoder('euc-kr').decode(b); } catch { return new TextDecoder('utf-8').decode(b); }
}
const CHUNK = 3 * 1024 * 1024;   // Vercel 을 거쳐도 넉넉한 크기
const fmtMB = b => (b >= 1048576 ? `${(b / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(b / 1024))}KB`);
/** 녹음 시각: 파일 이름의 날짜(삼성 "…_241125_103015") → 없으면 파일 수정 시각 (유닉스 초) */
export function recordedAtOf(file) {
  const m = String(file.name).match(/(?:^|[^\d])(\d{2}|20\d{2})(\d{2})(\d{2})[_ -]?(\d{2})(\d{2})(\d{2})(?!\d)/);
  if (m) {
    const y = m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1]);
    const d = new Date(y, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
    if (!Number.isNaN(d.getTime()) && Number(m[2]) <= 12 && Number(m[3]) <= 31 && Number(m[4]) < 24 && d <= new Date()) return Math.floor(d / 1000);
  }
  return file.lastModified ? Math.floor(file.lastModified / 1000) : '';
}
async function sendChunk(url, token, blob) {
  for (let t = 0; ; t++) {                                      // 끊기면 두 번까지 다시
    try {
      const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' }, body: blob });
      const j = await r.json().catch(() => ({}));
      if (r.ok) return j;
      if (r.status < 500 || t >= 2) throw new Error(j.error || `실패 (${r.status})`);
    } catch (e) { if (t >= 2 || e.message?.startsWith('실패') || e.message?.includes(' ')) throw e; }
    await new Promise(res => setTimeout(res, 1500 * (t + 1)));
  }
}

function UploadPopup({ onClose, onUploaded }) {
  const { sync } = useCtx();
  const [rows, setRows] = useState([]);
  const [make, setMake] = useState(false);
  const [txtKind, setTxtKind] = useState('auto');
  const [running, setRunning] = useState(false);
  const pick = useRef(null), folder = useRef(null), stop = useRef(false);
  const add = files => {
    const all = [...files], ok = all.filter(f => EXT_OK.test(f.name) || TXT_OK.test(f.name));
    setRows(r => [...r.filter(x => x.state !== 'wait'), ...r.filter(x => x.state === 'wait'), ...ok.map(f => ({ f, key: `${f.name}|${f.size}|${f.lastModified}`, pct: 0, state: 'wait', msg: '' }))]
      .filter((x, i, a) => a.findIndex(y => y.key === x.key) === i));
    if (all.length > ok.length) setNoteSkip(all.length - ok.length);
  };
  const [skip, setNoteSkip] = useState(0);
  const start = async () => {
    setRunning(true); stop.current = false;
    const set = (key, p) => setRows(r => r.map(x => (x.key === key ? { ...x, ...p } : x)));
    const todo = rows.filter(x => x.state === 'wait' || x.state === 'fail');
    for (const row of [...todo.filter(x => !TXT_OK.test(x.f.name)), ...todo.filter(x => TXT_OK.test(x.f.name))]) {   // 녹음 먼저 → TXT (같은 이름 녹음에 붙도록)
      if (stop.current) break;
      if (TXT_OK.test(row.f.name)) {
        set(row.key, { state: 'up', pct: 0, msg: '' });
        try {
          const isDoc = /\.docx$/i.test(row.f.name);
          if (row.f.size > (isDoc ? 30 : 5) * 1048576) throw new Error(`${isDoc ? '30' : '5'}MB 가 넘는 파일은 올릴 수 없습니다`);
          const buf = await row.f.arrayBuffer();
          const text = (isDoc ? docxText(buf) : decodeText(buf)).slice(0, 400000);
          const res = await sync.request('/api/minutes/text', { method: 'POST', body: { name: row.f.name, at: recordedAtOf(row.f), text, make, kind: txtKind } });
          set(row.key, { state: res.duplicate ? 'dup' : res.minutes ? 'min' : res.paired ? 'pair' : 'ok', pct: 100 });
        } catch (e) { set(row.key, { state: 'fail', msg: e.message }); }
        continue;
      }
      const { f, key } = row, n = Math.max(1, Math.ceil(f.size / CHUNK));
      const u = Array.from(crypto.getRandomValues(new Uint8Array(10)), b => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
      const at = recordedAtOf(f);
      set(key, { state: 'up', pct: 0, msg: '' });
      try {
        if (f.size > 200 * 1048576) throw new Error('200MB 가 넘어 올릴 수 없습니다');
        let res = null;
        for (let i = 0; i < n; i++) {
          const q = `u=${u}&i=${i}&n=${n}&name=${encodeURIComponent(f.name)}&at=${at}&make=${make ? 1 : 0}`;
          res = await sendChunk(`${API_BASE}/api/minutes/upload?${q}`, sync.conf.token, f.slice(i * CHUNK, (i + 1) * CHUNK));
          set(key, { pct: Math.round(((i + 1) / n) * 100) });
        }
        set(key, { state: res?.duplicate ? 'dup' : 'ok', pct: 100 });
      } catch (e) { set(key, { state: 'fail', msg: e.message }); }
    }
    setRunning(false); onUploaded();
  };
  const cnt = k => rows.filter(x => x.state === k).length;
  const total = rows.reduce((a, x) => a + x.f.size, 0);
  const LABEL = { wait: '대기', up: '올리는 중', ok: '올림', pair: '녹음에 붙임', min: '회의록으로 저장', dup: '이미 있음', fail: '실패' };
  return (
    <Popup wide title="예전 녹음 · 회의록 올리기" sub="녹음 파일, TXT(받아 적은 글), 이미 만든 회의록(Word · TXT)을 골라 한꺼번에 올립니다. 이미 올린 것과 같은 파일은 건너뜁니다." onClose={() => { stop.current = true; onClose(); }}>
      <div className="ru-pick">
        <button className="btn primary" disabled={running} onClick={() => pick.current?.click()}>파일 고르기 (여러 개)</button>
        <button className="btn" disabled={running} onClick={() => folder.current?.click()}>폴더 통째로 고르기</button>
        <input ref={pick} type="file" multiple hidden accept="audio/*,video/mp4,.m4a,.mp4,.mp3,.amr,.wav,.3gp,.ogg,.opus,.aac,.flac,.webm,.txt,.md,.docx,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={e => { add(e.target.files); e.target.value = ''; }} />
        <input ref={folder} type="file" multiple hidden webkitdirectory="" directory="" onChange={e => { add(e.target.files); e.target.value = ''; }} />
      </div>
      <p className="muted">휴대폰: "파일 고르기" → 내 파일 › Recordings › Call(통화) · Voice Recorder(음성)에서 길게 눌러 여러 개 선택. 컴퓨터: 녹음 · 회의록 폴더를 "폴더 통째로 고르기"로 고르면 녹음 · TXT · Word 파일만 골라 올립니다. 이름이 같은 녹음(예: 통화.m4a · 통화.docx)이 있으면 그 녹음에 붙습니다.</p>
      {skip > 0 && <p className="muted">녹음 · TXT · Word 파일이 아닌 {skip}개는 뺐습니다.</p>}
      <label className="ru-kind">TXT 가 무엇인가요?
        <select value={txtKind} disabled={running} onChange={e => setTxtKind(e.target.value)}>
          <option value="auto">자동으로 판단 (1. 개요 · 4. 결론 같은 제목이 있으면 회의록)</option>
          <option value="minutes">이미 정리된 회의록 (AI 안 씀 · 비용 없음)</option>
          <option value="transcript">받아 적은 글 · 메모 (AI 가 회의록으로 정리)</option>
        </select>
        <small className="muted">Word(docx)는 늘 "이미 정리된 회의록"으로 그대로 저장합니다 (1. 개요 ~ 6. 기타를 알아서 나눔, 원문도 보관).</small></label>
      <label className="rs-chk"><input type="checkbox" checked={make} disabled={running} onChange={e => setMake(e.target.checked)} /> 올린 뒤 바로 회의록도 만들기 <small className="muted">(끄면 목록에 "수동"으로 들어가고, 필요한 것만 골라 만들 수 있습니다. 비용: 녹음 1시간에 약 500원, TXT 는 한 건에 약 20~100원)</small></label>
      {!!rows.length && (<>
        <div className="ru-sum"><span>{rows.length}개 · {fmtMB(total)}</span><span className="muted">올림 {cnt('ok')}{cnt('min') ? ` · 회의록 ${cnt('min')}` : ''}{cnt('pair') ? ` · 녹음에 붙임 ${cnt('pair')}` : ''} · 이미 있음 {cnt('dup')}{cnt('fail') ? ` · 실패 ${cnt('fail')}` : ''}</span>
          <span className="grow-r ib-hb">{running ? <button className="btn sm" onClick={() => { stop.current = true; }}>멈추기</button>
            : <><button className="btn sm" onClick={() => setRows(r => r.filter(x => x.state === 'wait' || x.state === 'fail'))}>끝난 것 지우기</button>
              <button className="btn sm primary" disabled={!rows.some(x => x.state === 'wait' || x.state === 'fail')} onClick={start}>{cnt('fail') && !cnt('wait') ? '실패한 것 다시 올리기' : '올리기 시작'}</button></>}</span></div>
        <ul className="ru-list">{rows.map(x => (
          <li key={x.key} className={`ru-row s-${x.state}`}>
            <span className="grow ru-n" title={x.f.name}>{x.f.name}</span><span className="muted ru-sz">{fmtMB(x.f.size)}</span>
            <span className="ru-bar" aria-hidden="true"><i style={{ width: `${x.pct}%` }} /></span>
            <span className={`rec-st ${['ok', 'pair', 'min'].includes(x.state) ? 'st-done' : x.state === 'fail' ? 'st-failed' : x.state === 'up' ? 'st-stt' : ''}`}>{LABEL[x.state]}{x.state === 'up' ? ` ${x.pct}%` : ''}</span>
            {x.msg && <span className="ru-err">{x.msg}</span>}
          </li>))}</ul>
      </>)}
    </Popup>
  );
}
