import React, { useState } from 'react';
import { iso } from '../data.js';
import { MoneyInput, WEEK, areaVar } from '../shared.jsx';
import { useFinance } from './Shopping.jsx';
import { catsOf, delExpense, setExpenseCat, setExpenseProject, won } from './finance.js';
import FinanceCats from './FinanceCats.jsx';
import { CardImport, MonthlyLedger } from './FinanceMonthly.jsx';
import ProjectReport, { SavedReportView } from './ProjectReport.jsx';
import { SplitEditor } from './ProjectSplit.jsx';
import { useCtx } from '../shared.jsx';
import FinanceIncome from './FinanceIncome.jsx';

/* 개인 › 개인 재무 전용 화면: 지출 관리 + 구매해야 할 물품 (대시보드와 같은 데이터)
   "지출 카테고리 설정" 버튼 → FinanceCats 상세 페이지 (카테고리 이름 · 월 예산 · 포함 범위) */
export default function FinanceView({ area, cat }) {
  const [f, update, now] = useFinance();
  const [page, setPage] = useState('main');
  const today = iso(now), ym = today.slice(0, 7);
  // 처음 보여줄 달: 이번 달 지출이 없으면 지출이 있는 가장 최근 달
  // 보기 설정(선택한 달 · 날짜순/카테고리별 · 정렬 · 접은 묶음)은 finance.ui 에 저장해 다시 들어와도 그대로
  const ui = f.ui || {};
  const setUi = patch => update(x => { const u = x.ui || {}; return { ...x, ui: { ...u, ...(typeof patch === 'function' ? patch(u) : patch) } }; });
  const firstMonth = f.expenses.some(e => e.date.startsWith(ym)) ? ym : f.expenses.map(e => e.date.slice(0, 7)).sort().pop() || ym;
  const month = ui.month || firstMonth;
  const setMonth = m => setUi({ month: m });
  const tab = ui.tab || 'expense';                        // 상단 탭: income 수입관리 · expense 지출관리
  const view = ui.view || 'date';
  const showTime = !!ui.showTime;                          // 날짜 옆 이용 시간 (기본: 숨김)
  const setView = v => setUi({ view: v });
  const closed = new Set(ui.closed || []);
  const setClosed = v => setUi(u => ({ closed: [...(typeof v === 'function' ? v(new Set(u.closed || [])) : v)] }));
  const [focus, setFocus] = useState(null);
  const cats = catsOf(f);
  const monthExp = f.expenses.filter(e => e.date.slice(0, 7) === month).sort((a, b) => b.date.localeCompare(a.date));
  const total = monthExp.reduce((a, e) => a + e.amount, 0);
  const todayTotal = f.expenses.filter(e => e.date === today).reduce((a, e) => a + e.amount, 0);
  const todo = f.shopping.filter(s => !s.bought);
  const expect = todo.reduce((a, s) => a + s.price * s.qty, 0);
  // 설정에 없는 분류(예전 데이터)도 보이게
  const names = [...new Set([...cats.map(c => c.name), ...monthExp.map(e => e.cat)])];
  const byCat = names.map(c => ({ c, v: monthExp.filter(e => e.cat === c).reduce((a, e) => a + e.amount, 0), b: cats.find(k => k.name === c)?.budget || 0 })).filter(x => x.v > 0 || x.b > 0).sort((a, b) => b.v - a.v);
  const maxCat = Math.max(1, ...byCat.map(x => Math.max(x.v, x.b)));
  const ratio = f.budget ? total / f.budget : 0;
  // 지출이 있는 달 + 이번 달
  const months = [...new Set([ym, ...f.expenses.map(e => e.date.slice(0, 7))])].sort().reverse();

  const setBudget = v => update(x => ({ ...x, budget: Math.max(0, Number(v) || 0) }));

  // 지출 내역 정렬: 머리글(날짜 · 분류 · 내용 · 연계 프로젝트 · 금액)을 누르면 오름차순 ↔ 내림차순
  const sort = ui.sort || { key: 'date', dir: 'desc' };
  const setSort = v => setUi(u => ({ sort: typeof v === 'function' ? v(u.sort || { key: 'date', dir: 'desc' }) : v }));
  const sortBy = key => setSort(x => (x.key === key ? { key, dir: x.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'date' || key === 'amount' ? 'desc' : 'asc' }));
  const pname = e => (f.projects || []).find(p => p.id === e.projectId)?.name || '';
  const val = { date: e => `${e.date} ${e.time || ''}`, cat: e => e.cat, memo: e => e.memo || '', proj: pname, amount: e => e.amount };
  const cmp = (a, b) => {
    const x = val[sort.key](a), y = val[sort.key](b);
    if (sort.key === 'proj' && !x !== !y) return !x ? 1 : -1;                      // 프로젝트 없는 줄은 항상 아래
    const r = typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'ko');
    return (sort.dir === 'asc' ? r : -r) || b.date.localeCompare(a.date);
  };
  const list = [...monthExp].sort(cmp);
  const listTotal = total;
  const catOpts = [...new Set([...cats.map(c => c.name), ...monthExp.map(e => e.cat)])];
  // 지출 내역: 날짜순 / 카테고리별(분류마다 모아 합계 · 비율, 접고 펴기)
  const groups = catOpts.map(c => { const g = list.filter(e => e.cat === c); return { c, list: g, v: g.reduce((t, e) => t + e.amount, 0) }; })
    .filter(g => g.list.length).sort((a, b) => b.v - a.v);
  const showCat = c => {                                   // 분류별 지출 막대를 누르면 그 분류 묶음으로
    setView('cat'); setFocus(c); setClosed(s0 => { const n = new Set(s0); n.delete(c); return n; });
    setTimeout(() => document.getElementById(`fv-g-${c}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
  };
  // 연계 프로젝트: 줄마다 고르기, "+ 새 프로젝트…" 로 바로 만들어 붙이기
  const projects = f.projects || [];
  const pickProject = (e, v) => {
    if (v !== '__new') { update(x => setExpenseProject(x, e.id, v)); return; }
    const name = (window.prompt('새 연계 프로젝트 이름') || '').trim();
    if (!name) return;
    const id = Math.random().toString(36).slice(2, 10);
    update(x => setExpenseProject({ ...x, projects: [...(x.projects || []), { id, name, note: '', updated: today }] }, e.id, id));
  };
  const row = (e, i) => (
    <tr key={e.id}><td className="fv-no">{i + 1}</td><td className="fv-date">{e.date.slice(5).replace('-', '/')}{showTime && <span className="fv-time">{e.time || '--:--'}</span>}</td>
      <td><select className="fv-cat" value={e.cat} onChange={ev => update(x => setExpenseCat(x, e.id, ev.target.value))} aria-label={`${e.memo || '지출'} 분류`}>
        {[...new Set([...cats.map(c => c.name), e.cat])].map(c => <option key={c}>{c}</option>)}</select></td>
      <td>{e.memo || '-'}{e.shopId && <span className="tag">구매 목록</span>}{e.card && <span className="tag">{e.card}</span>}</td>
      <td><select className={`fv-proj ${e.projectId ? 'on' : ''}`} value={projects.some(p => p.id === e.projectId) ? e.projectId : ''} onChange={ev => pickProject(e, ev.target.value)} aria-label={`${e.memo || '지출'} 연계 프로젝트`}>
        <option value="">-</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}<option value="__new">+ 새 프로젝트…</option></select></td>
      <td className="num">{won(e.amount)}</td>
      <td><button className="tl-del" onClick={() => update(x => delExpense(x, e.id))}>{e.shopId ? '구매 취소' : '삭제'}</button></td></tr>
  );

  const COLS = [['date', '날짜'], ['cat', '분류'], ['memo', '내용'], ['proj', '연계 프로젝트'], ['amount', '금액']];
  const head = (
    <tr><th className="fv-no">No.</th>{COLS.map(([k, n]) => (
      <th key={k} aria-sort={sort.key === k ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className={`fv-sort ${k === 'amount' ? 'r' : ''}`}>
        <button onClick={() => sortBy(k)} title={`${n} ${sort.key === k && sort.dir === 'asc' ? '내림차순' : '오름차순'}으로 정렬`}>{n}<i aria-hidden="true">{sort.key === k ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}</i></button></th>))}<th /></tr>
  );
  if (page === 'cats') return <FinanceCats area={area} cat={cat} month={month} onBack={() => setPage('main')} />;
  return (
    <div className="catv fv" style={{ '--ac': areaVar(area) }}>
      <header className="page-h fv-head">
        <h1 className="area-title">{cat}</h1>
        {tab === 'expense' && <button className="btn" onClick={() => setPage('cats')}>지출 카테고리 설정</button>}
      </header>

      <div className="fv-tabs" role="tablist" aria-label="개인 재무 보기">
        {[['income', '수입관리'], ['expense', '지출관리']].map(([k, n]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setUi({ tab: k })}>{n}</button>))}
      </div>

      {tab === 'income' ? <FinanceIncome f={f} update={update} today={today} month={month} setMonth={setMonth} months={months} /> : <>
      <div className="hv-stats">
        <div className="hv-stat sl"><span className="muted">{month === ym ? '이번 달' : month.replace('-', '년 ') + '월'} 지출</span><b>{won(total)}</b><span className="hv-sub">{monthExp.length}건</span></div>
        <div className={`hv-stat ${ratio > 1 ? 'over' : 'sl'}`}>
          <span className="muted">예산 대비</span><b>{f.budget ? `${Math.round(ratio * 100)}%` : '-'}</b>
          <span className="hv-sub fv-budget">예산 <MoneyInput value={f.budget} onChange={setBudget} aria-label="월 예산" />원</span>
          <span className="pbar"><i style={{ width: `${Math.min(100, ratio * 100)}%`, background: ratio > 1 ? 'var(--over)' : 'var(--viz-sl)' }} /></span>
        </div>
        <div className="hv-stat ex"><span className="muted">구매 예정</span><b>{won(expect)}</b><span className="hv-sub">{todo.length}건</span></div>
        <div className="hv-stat ex"><span className="muted">오늘 지출</span><b>{won(todayTotal)}</b><span className="hv-sub">{WEEK[now.getDay()]}요일</span></div>
      </div>

      <CardImport update={update} f={f} now={now} onMonth={setMonth} />
      <MonthlyLedger f={f} update={update} month={month} onMonth={setMonth} />

          <section className="panel">
            <div className="hv-ch"><h2>분류별 지출</h2><span className="muted">{month.replace('-', '년 ')}월 · 세로선은 카테고리 예산 · 막대를 누르면 내역을 모아 봅니다</span>
              <button className="btn sm grow-r" onClick={() => setPage('cats')}>카테고리 · 범위 수정</button></div>
            {byCat.length ? (
              <ul className="fv-bars fv-cbars">{byCat.map(x => (
                <li key={x.c} className="fv-click" onClick={() => showCat(x.c)} title={`${x.c} 내역 모아 보기`}><span className="fv-bl">{x.c}</span>
                  <span className="fv-track"><i style={{ width: `${x.v / maxCat * 100}%`, background: x.b && x.v > x.b ? 'var(--over)' : undefined }} />
                    {x.b > 0 && <em className="fv-cap" style={{ left: `${x.b / maxCat * 100}%` }} title={`예산 ${won(x.b)}`} />}</span>
                  <span className="fv-bv">{won(x.v)}{x.b > 0 && <small> / {won(x.b)}</small>}</span></li>))}</ul>
            ) : <p className="muted">지출 내역이 없습니다.</p>}
          </section>

      <section className="panel" id="fv-list">
        <div className="csum-h"><h2>지출 내역</h2>
          <select value={month} onChange={e => setMonth(e.target.value)} aria-label="월 선택" className="fv-month">
            {months.map(m => <option key={m} value={m}>{m.replace('-', '년 ')}월</option>)}</select>
          <span className="muted">{monthExp.length}건 · 합계 {won(total)}</span>
          <div className="chips grow-r" role="group" aria-label="보기 방식">
            <button aria-pressed={view === 'date'} onClick={() => setView('date')}>날짜순</button>
            <button aria-pressed={view === 'cat'} onClick={() => setView('cat')}>카테고리별</button>
          </div>
          <label className="fv-timeopt" title="카드 파일에 이용 시간이 있으면 날짜 옆에 보여 줍니다"><input type="checkbox" checked={showTime} onChange={e => setUi({ showTime: e.target.checked })} />시간 보기</label></div>
        {!list.length ? <p className="muted">이 달의 지출 내역이 없습니다.</p>
          : view === 'date' ? (
            <div className="tablewrap"><table className="prog fv-table">
              <thead>{head}</thead>
              <tbody>{list.map(row)}</tbody>
            </table></div>
          ) : (
            <div className="fv-groups">{groups.map(g => (
              <details key={g.c} id={`fv-g-${g.c}`} className={`fv-group ${focus === g.c ? 'focus' : ''}`} open={!closed.has(g.c)}
                onToggle={e => { const open = e.currentTarget.open; setClosed(s0 => { const n = new Set(s0); if (open) n.delete(g.c); else n.add(g.c); return n; }); }}>
                <summary>
                  <b>{g.c}</b><span className="muted">{g.list.length}건</span>
                  <span className="fv-gbar"><i style={{ width: `${g.v / listTotal * 100}%` }} /></span>
                  <span className="fv-gpct muted">{Math.round(g.v / listTotal * 100)}%</span>
                  <b className="fv-gsum">{won(g.v)}</b>
                </summary>
                <div className="tablewrap"><table className="prog fv-table">
                  <thead>{head}</thead>
                  <tbody>{g.list.map(row)}</tbody>
                </table></div>
              </details>))}
              <div className="fv-gbtns"><button className="btn sm" onClick={() => setClosed(new Set())}>모두 펼치기</button><button className="btn sm" onClick={() => setClosed(new Set(groups.map(g => g.c)))}>모두 접기</button></div>
            </div>
          )}
      </section>

      <LinkedProjects f={f} update={update} now={now} />
      </>}
    </div>
  );
}

/* 연계 프로젝트: 개인 재무와 이어지는 일을 자유롭게 적어 두는 칸
   finance.projects = [{ id, name, note(자유 글), updated('YYYY-MM-DD') }] */
const pid = () => Math.random().toString(36).slice(2, 10);
function LinkedProjects({ f, update, now }) {
  const list = f.projects || [];
  const [name, setName] = useState('');
  const [arm, setArm] = useState(null);
  const [report, setReport] = useState(false);
  const { store } = useCtx();
  const names = [...new Set((store.people || []).map(x => x.name).filter(Boolean))];   // 인맥 관리 이름 자동완성
  const today = iso(now);
  const setP = (id, patch) => update(x => ({ ...x, projects: (x.projects || []).map(p => (p.id === id ? { ...p, ...patch, updated: today } : p)) }));
  const add = e => {
    e.preventDefault();
    if (!name.trim()) return;
    update(x => ({ ...x, projects: [...(x.projects || []), { id: pid(), name: name.trim(), note: '', updated: today }] }));
    setName('');
  };
  return (
    <section className="panel fp">
      <div className="csum-h"><h2>연계 프로젝트</h2><span className="muted">{list.length}개 · 자유롭게 적어 두세요 (입력하면 바로 저장)</span>
        {list.length > 0 && <button className="btn sm grow-r" onClick={() => setReport(true)}>보고서 PDF</button>}</div>
      {report && <ProjectReport f={f} update={update} today={today} onClose={() => setReport(false)} />}
      {list.length ? <ul className="fp-list">{list.map(p => (
        <li key={p.id}>
          <div className="fp-h">
            <input className="fp-name" value={p.name} onChange={e => setP(p.id, { name: e.target.value })} aria-label="프로젝트 이름" />
            {(() => { const ex = f.expenses.filter(e => e.projectId === p.id); return ex.length ? <span className="fp-sum">연계 지출 {ex.length}건 · <b>{won(ex.reduce((a, e) => a + e.amount, 0))}</b></span> : null; })()}
            <small className="muted">수정 {p.updated}</small>
            <button className={`btn sm ${arm === p.id ? 'danger' : ''}`} onClick={() => { if (arm === p.id) { update(x => ({ ...x, projects: (x.projects || []).filter(k => k.id !== p.id), expenses: x.expenses.map(e => (e.projectId === p.id ? (({ projectId, ...r }) => r)(e) : e)) })); setArm(null); } else { setArm(p.id); setTimeout(() => setArm(a => (a === p.id ? null : a)), 3000); } }}>{arm === p.id ? '정말 삭제?' : '삭제'}</button>
          </div>
          <textarea className="fp-note" value={p.note} onChange={e => setP(p.id, { note: e.target.value })} rows={Math.max(3, (p.note.match(/\n/g) || []).length + 2)}
            placeholder="예: 목표 금액, 진행 상황, 관련 지출, 메모 등 자유롭게" aria-label={`${p.name} 내용`} />
          <SplitEditor p={p} names={names} sum={f.expenses.filter(e => e.projectId === p.id).reduce((a, e) => a + e.amount, 0)}
            onChange={split => update(x => ({ ...x, projects: (x.projects || []).map(k => (k.id === p.id ? { ...k, split } : k)) }))} />
        </li>))}</ul> : <p className="muted">아직 연계 프로젝트가 없습니다.</p>}
      <form className="fp-add" onSubmit={add}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="프로젝트 이름 (예: 이사 준비, 자동차 구매)" aria-label="새 연계 프로젝트 이름" />
        <button className="btn primary" disabled={!name.trim()}>추가</button>
      </form>
      <SavedReports f={f} update={update} />
    </section>
  );
}

/* 저장된 보고서: 보고서 화면에서 "보고서 저장" · "PDF로 저장"을 누르면 그때 모습 그대로 쌓인다 (finance.savedReports, 최근 50개) */
function SavedReports({ f, update }) {
  const list = f.savedReports || [];
  const [open, setOpen] = useState(null);
  const [arm, setArm] = useState(null);
  const del = id => {
    if (arm !== id) { setArm(id); setTimeout(() => setArm(a => (a === id ? null : a)), 3000); return; }
    update(x => ({ ...x, savedReports: (x.savedReports || []).filter(r => r.id !== id) })); setArm(null);
  };
  const rename = (id, title) => update(x => ({ ...x, savedReports: (x.savedReports || []).map(r => (r.id === id ? { ...r, title } : r)) }));
  if (!list.length) return <p className="muted fp-saved-empty">저장된 보고서가 없습니다. 보고서 화면에서 "보고서 저장" 또는 "PDF로 저장"을 누르면 여기에 보관됩니다.</p>;
  return (
    <div className="fp-saved">
      <h3>저장된 보고서 <small className="muted">{list.length}개</small></h3>
      <table className="fp-saved-t"><thead><tr><th>저장일</th><th>제목</th><th>프로젝트</th><th>총 지출</th><th /></tr></thead>
        <tbody>{list.map(r => (
          <tr key={r.id}>
            <td className="nw">{new Date(r.at).toLocaleString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
            <td><input value={r.title} onChange={e => rename(r.id, e.target.value)} aria-label="보고서 제목" /></td>
            <td>{r.projects.join(', ')}</td>
            <td className="r nw">{won(r.total)}</td>
            <td className="nw"><button className="btn sm" onClick={() => setOpen(r)}>열기</button>
              <button className={`btn sm ${arm === r.id ? 'danger' : ''}`} onClick={() => del(r.id)}>{arm === r.id ? '정말 삭제?' : '삭제'}</button></td>
          </tr>))}</tbody></table>
      {open && <SavedReportView rep={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
