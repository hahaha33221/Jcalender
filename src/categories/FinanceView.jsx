import React, { useState } from 'react';
import { iso } from '../data.js';
import { MoneyInput, WEEK, areaVar } from '../shared.jsx';
import { useFinance } from './Shopping.jsx';
import { catsOf, delExpense, setExpenseCat, setExpenseProject, won } from './finance.js';
import FinanceCats from './FinanceCats.jsx';
import { CardImport, MonthlyLedger } from './FinanceMonthly.jsx';

/* 개인 › 개인 재무 전용 화면: 지출 관리 + 구매해야 할 물품 (대시보드와 같은 데이터)
   "지출 카테고리 설정" 버튼 → FinanceCats 상세 페이지 (카테고리 이름 · 월 예산 · 포함 범위) */
export default function FinanceView({ area, cat }) {
  const [f, update, now] = useFinance();
  const [page, setPage] = useState('main');
  const today = iso(now), ym = today.slice(0, 7);
  // 처음 보여줄 달: 이번 달 지출이 없으면 지출이 있는 가장 최근 달
  const [month, setMonth] = useState(() => (f.expenses.some(e => e.date.startsWith(ym)) ? ym : f.expenses.map(e => e.date.slice(0, 7)).sort().pop() || ym));
  const [view, setView] = useState('date');
  const [closed, setClosed] = useState(() => new Set());
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

  // 지출 내역: 날짜순 / 카테고리별(분류마다 모아 합계 · 비율, 접고 펴기)
  const groups = names.map(c => { const list = monthExp.filter(e => e.cat === c); return { c, list, v: list.reduce((t, e) => t + e.amount, 0) }; })
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
  const row = e => (
    <tr key={e.id}><td>{e.date.slice(5).replace('-', '/')}</td>
      <td><select className="fv-cat" value={e.cat} onChange={ev => update(x => setExpenseCat(x, e.id, ev.target.value))} aria-label={`${e.memo || '지출'} 분류`}>
        {[...new Set([...cats.map(c => c.name), e.cat])].map(c => <option key={c}>{c}</option>)}</select></td>
      <td>{e.memo || '-'}{e.shopId && <span className="tag">구매 목록</span>}{e.card && <span className="tag">{e.card}</span>}</td>
      <td><select className={`fv-proj ${e.projectId ? 'on' : ''}`} value={projects.some(p => p.id === e.projectId) ? e.projectId : ''} onChange={ev => pickProject(e, ev.target.value)} aria-label={`${e.memo || '지출'} 연계 프로젝트`}>
        <option value="">-</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}<option value="__new">+ 새 프로젝트…</option></select></td>
      <td className="num">{won(e.amount)}</td>
      <td><button className="tl-del" onClick={() => update(x => delExpense(x, e.id))}>{e.shopId ? '구매 취소' : '삭제'}</button></td></tr>
  );

  if (page === 'cats') return <FinanceCats area={area} cat={cat} month={month} onBack={() => setPage('main')} />;
  return (
    <div className="catv fv" style={{ '--ac': areaVar(area) }}>
      <header className="page-h fv-head">
        <h1 className="area-title">{cat}</h1>
        <button className="btn" onClick={() => setPage('cats')}>지출 카테고리 설정</button>
      </header>

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
          <span className="muted">합계 {won(total)}</span>
          <div className="chips grow-r" role="group" aria-label="보기 방식">
            <button aria-pressed={view === 'date'} onClick={() => setView('date')}>날짜순</button>
            <button aria-pressed={view === 'cat'} onClick={() => setView('cat')}>카테고리별</button>
          </div></div>
        {!monthExp.length ? <p className="muted">이 달의 지출 내역이 없습니다.</p>
          : view === 'date' ? (
            <div className="tablewrap"><table className="prog fv-table">
              <thead><tr><th>날짜</th><th>분류</th><th>내용</th><th>연계 프로젝트</th><th>금액</th><th /></tr></thead>
              <tbody>{monthExp.map(row)}</tbody>
            </table></div>
          ) : (
            <div className="fv-groups">{groups.map(g => (
              <details key={g.c} id={`fv-g-${g.c}`} className={`fv-group ${focus === g.c ? 'focus' : ''}`} open={!closed.has(g.c)}
                onToggle={e => { const open = e.currentTarget.open; setClosed(s0 => { const n = new Set(s0); if (open) n.delete(g.c); else n.add(g.c); return n; }); }}>
                <summary>
                  <b>{g.c}</b><span className="muted">{g.list.length}건</span>
                  <span className="fv-gbar"><i style={{ width: `${g.v / total * 100}%` }} /></span>
                  <span className="fv-gpct muted">{Math.round(g.v / total * 100)}%</span>
                  <b className="fv-gsum">{won(g.v)}</b>
                </summary>
                <div className="tablewrap"><table className="prog fv-table">
                  <tbody>{g.list.map(row)}</tbody>
                </table></div>
              </details>))}
              <div className="fv-gbtns"><button className="btn sm" onClick={() => setClosed(new Set())}>모두 펼치기</button><button className="btn sm" onClick={() => setClosed(new Set(groups.map(g => g.c)))}>모두 접기</button></div>
            </div>
          )}
      </section>

      <LinkedProjects f={f} update={update} now={now} />
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
      <div className="csum-h"><h2>연계 프로젝트</h2><span className="muted">{list.length}개 · 자유롭게 적어 두세요 (입력하면 바로 저장)</span></div>
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
        </li>))}</ul> : <p className="muted">아직 연계 프로젝트가 없습니다.</p>}
      <form className="fp-add" onSubmit={add}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="프로젝트 이름 (예: 이사 준비, 자동차 구매)" aria-label="새 연계 프로젝트 이름" />
        <button className="btn primary" disabled={!name.trim()}>추가</button>
      </form>
    </section>
  );
}
