import React, { useState } from 'react';
import { ROWS, iso } from '../data.js';
import { MoneyInput, WEEK, areaVar, num, useCtx } from '../shared.jsx';
import BarChart from './BarChart.jsx';

/* 카테고리 상세 화면 엔진
   카테고리마다 설정(toolConfigs.js)을 넘기면 요약 카드 · 다가오는 일정 · 단계 보드 · 추세 그래프 · 항목별 합계 ·
   목표 대비 막대 · 표(바로 수정) · 추가 입력을 그 설정대로 그린다. 기록은 store.tools['영역|카테고리'] 에 저장한다.

   설정 필드
     intro, noun(기록 이름), fields: [{ k, label, type: text|date|time|money|number|select|phone|rating|long, options, req }]
     title: 대표 필드, seed(today) → 기록 배열, stats(rows, c) → [{ label, value, sub, tone }]
     kanban: { field, stages }            단계 보드
     upcoming: { field, days, label, filter }  날짜가 다가오는 기록
     trend: { label, date, value, unit: 'month'|'day', span, fmt, filter }
     breakdown: { label, by, value, filter, fmt }
     progress: { label, name, cur, target, unit }
     tick: 기록을 추가하면 체크할 액션 이름 (같은 영역)
     sort(a, b) 표 정렬 */
const uid = () => Math.random().toString(36).slice(2, 10);
export const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
export const dayDiff = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);
const md = s => (s ? `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}` : '-');
const mdw = s => `${md(s)} (${WEEK[new Date(s + 'T00:00:00').getDay()]})`;
export const won = n => `${num(Math.round(n || 0))}원`;

export function fmtVal(f, v) {
  if (v === '' || v == null) return '-';
  if (f.type === 'money') return won(v);
  if (f.type === 'number') return num(v) + (f.unit || '');
  if (f.type === 'date') return mdw(v);
  if (f.type === 'rating') return '●'.repeat(Number(v)) + '○'.repeat(5 - Number(v));
  return String(v);
}

/** 설정의 fmt 이름을 함수로 */
const FMT = { money: won, number: v => num(v), hours: v => `${Math.round(v / 6) / 10}h`, minutes: v => `${num(v)}분`, count: v => `${num(v)}건` };
const fmtOf = f => (typeof f === 'function' ? f : FMT[f] || (v => num(v)));

function Field({ f, value, onChange, compact }) {
  const common = { 'aria-label': f.label, className: compact ? 'tv-in' : '' };
  if (f.type === 'money') return <MoneyInput value={value ?? ''} onChange={onChange} placeholder={compact ? '' : `${f.label}(원)`} {...common} />;
  if (f.type === 'select') return <select value={value ?? ''} onChange={e => onChange(e.target.value)} {...common}>{f.options.map(o => <option key={o}>{o}</option>)}</select>;
  if (f.type === 'rating') return <select value={value ?? 3} onChange={e => onChange(Number(e.target.value))} {...common}>{[1, 2, 3, 4, 5].map(o => <option key={o} value={o}>{o}점</option>)}</select>;
  if (f.type === 'number') return <input type="number" value={value ?? ''} onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))} placeholder={compact ? '' : f.label} {...common} />;
  if (f.type === 'date' || f.type === 'time') return <input type={f.type} value={value ?? ''} onChange={e => onChange(e.target.value)} {...common} />;
  return <input value={value ?? ''} onChange={e => onChange(e.target.value)} placeholder={compact ? '' : f.label} inputMode={f.type === 'phone' ? 'tel' : undefined} {...common} />;
}

export default function ToolView({ area, cat, group, config: C, noHeader }) {
  const { store, setStore, now, isDone, finish } = useCtx();
  const today = iso(now);
  const key = `${area}|${cat}`;
  const rows = store.tools?.[key] || C.seed(now);
  const set = fn => setStore(s => ({ ...s, tools: { ...(s.tools || {}), [key]: fn(s.tools?.[key] || C.seed(now)) } }));
  const blank = () => Object.fromEntries(C.fields.map(f => [f.k, f.def !== undefined ? (typeof f.def === 'function' ? f.def(today) : f.def) : f.type === 'select' ? f.options[0] : f.type === 'date' ? today : '']));
  const [form, setForm] = useState(blank);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(false);
  // 단계 보드 보기 방식: 칸반 / 게시판 (store.boardView['영역|카테고리'] 에 저장)
  const bview = store.boardView?.[key] || 'kanban';
  const setBview = v => setStore(s => ({ ...s, boardView: { ...(s.boardView || {}), [key]: v } }));
  const [bst, setBst] = useState('ALL');
  const c = { today, month: today.slice(0, 7), year: today.slice(0, 4), now };
  const fieldOf = k => C.fields.find(f => f.k === k);
  const tickRow = C.tick && ROWS.find(r => r.a === area && r.cat === cat && r.action === C.tick);

  const upd = (id, patch) => set(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));
  const del = id => set(rs => rs.filter(r => r.id !== id));
  const add = e => {
    e.preventDefault();
    if (C.fields.some(f => f.req && (form[f.k] === '' || form[f.k] == null))) return;
    set(rs => [{ id: uid(), ...form }, ...rs]);
    setForm(blank());
  };
  const canAdd = !C.fields.some(f => f.req && (form[f.k] === '' || form[f.k] == null));

  const stats = C.stats ? C.stats(rows, c) : [];
  const listed = rows.filter(r => !q || C.fields.some(f => String(r[f.k] ?? '').includes(q))).sort(C.sort || (() => 0));
  const showCols = C.fields.filter(f => f.list !== false);
  const titleF = fieldOf(C.title);

  // 다가오는 일정
  const up = C.upcoming && rows.filter(r => r[C.upcoming.field] && (!C.upcoming.filter || C.upcoming.filter(r, c)))
    .map(r => ({ r, d: dayDiff(today, r[C.upcoming.field]) })).filter(x => x.d >= (C.upcoming.past ? -C.upcoming.past : 0) && x.d <= (C.upcoming.days || 30)).sort((a, b) => a.d - b.d);

  // 추세 그래프
  let trend = null;
  if (C.trend) {
    const T = C.trend, val = typeof T.value === 'function' ? T.value : r => Number(r[T.value]) || 0;
    const src = rows.filter(r => r[T.date] && (!T.filter || T.filter(r, c)));
    if (T.unit === 'day') {
      trend = Array.from({ length: T.span || 14 }, (_, i) => addDays(today, i - (T.span || 14) + 1)).map(d => ({
        key: d, label: md(d), title: mdw(d), value: src.filter(r => r[T.date] === d).reduce((a, r) => a + val(r), 0),
      }));
    } else {
      trend = Array.from({ length: T.span || 6 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - (T.span || 6) + 1 + i, 1); return iso(d).slice(0, 7); }).map(m => ({
        key: m, label: `${Number(m.slice(5))}월`, title: `${m.slice(0, 4)}년 ${Number(m.slice(5))}월`, value: src.filter(r => String(r[T.date]).slice(0, 7) === m).reduce((a, r) => a + val(r), 0),
      }));
    }
    const f = fmtOf(T.fmt);
    trend = trend.map(x => ({ ...x, tip: [f(x.value)] }));
  }
  // 항목별 합계
  let bd = null;
  if (C.breakdown) {
    const B = C.breakdown, val = typeof B.value === 'function' ? B.value : B.value ? r => Number(r[B.value]) || 0 : () => 1;
    const src = rows.filter(r => !B.filter || B.filter(r, c));
    const groups = [...new Set(src.map(r => r[B.by]))];
    bd = groups.map(g => ({ g, v: src.filter(r => r[B.by] === g).reduce((a, r) => a + val(r), 0) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  }
  const bdMax = bd ? Math.max(1, ...bd.map(x => x.v)) : 1;

  const moveStage = (r, dir) => {
    const st = C.kanban.stages, i = st.indexOf(r[C.kanban.field]);
    const n = Math.max(0, Math.min(st.length - 1, i + dir));
    if (n !== i) upd(r.id, { [C.kanban.field]: st[n] });
  };
  const cardLine = r => (C.card || []).map(k => { const f = fieldOf(k); return r[k] !== '' && r[k] != null ? `${f.type === 'date' ? '' : ''}${fmtVal(f, r[k])}` : null; }).filter(Boolean).join(' · ');
  const items = group.items.map(it => ({ it, rows: group.rows.filter(r => r.item === it) }));

  return (
    <div className="catv tv" style={{ '--ac': areaVar(area) }}>
      {!noHeader && <header className="page-h">
        <h1 className="area-title">{cat}</h1>
      </header>}

      {stats.length > 0 && <div className="hv-stats">{stats.map(s => (
        <div key={s.label} className={`hv-stat ${s.tone || 'sl'}`}><span className="muted">{s.label}</span><b>{s.value}</b>
          {s.bar != null ? <span className="pbar"><i style={{ width: `${Math.min(100, s.bar)}%`, background: s.bar > 100 ? 'var(--over)' : 'var(--ac)' }} /></span> : <span className="hv-sub">{s.sub || ''}</span>}</div>))}</div>}

      {up && (
        <section className="panel">
          <div className="csum-h"><h2>{C.upcoming.label || '다가오는 일정'}</h2><span className="muted">{C.upcoming.days || 30}일 이내 · {up.length}건</span></div>
          {up.length ? <ul className="tv-up">{up.map(({ r, d }) => (
            <li key={r.id} className={d < 0 ? 'late' : d <= 3 ? 'hot' : ''}>
              <b className="tv-dd">{d < 0 ? `${-d}일 지남` : d === 0 ? '오늘' : `D-${d}`}</b>
              <span className="grow"><b>{r[C.title]}</b><small className="muted"> · {mdw(r[C.upcoming.field])}{C.upcoming.sub ? ` · ${C.upcoming.sub(r)}` : ''}</small></span>
            </li>))}</ul> : <p className="muted">기간 안에 해당하는 항목이 없습니다.</p>}
        </section>
      )}

      {C.kanban && (
        <section className="panel">
          <div className="csum-h"><h2>{C.kanban.label || '단계별 보드'}</h2><span className="muted">{bview === 'kanban' ? '‹ › 버튼으로 단계를 옮깁니다' : '단계 칸에서 바로 바꿀 수 있습니다'}</span>
            <span className="grow" /><ViewToggle value={bview} onChange={setBview} /></div>
          {bview === 'list' ? (() => {
            const F = C.kanban.field, st = C.kanban.stages;
            const list = rows.filter(r => bst === 'ALL' || r[F] === bst).sort((a, b) => st.indexOf(a[F]) - st.indexOf(b[F]));
            const cols = (C.card || []).map(fieldOf).filter(Boolean);
            return <>
              <div className="chips bd-chips">{[['ALL', `전체 ${rows.length}`], ...st.map(x => [x, `${x} ${rows.filter(r => r[F] === x).length}`])].map(([k, n]) => <button key={k} aria-pressed={bst === k} onClick={() => setBst(k)}>{n}</button>)}</div>
              <div className="tablewrap"><table className="fv-table bd-table">
                <thead><tr><th className="fv-no">No.</th><th>단계</th><th>{titleF?.label || '제목'}</th>{cols.map(f => <th key={f.k}>{f.label}</th>)}</tr></thead>
                <tbody>{list.map((r, i) => (
                  <tr key={r.id}><td className="fv-no">{i + 1}</td>
                    <td><select className="bd-st" value={r[F]} onChange={e => upd(r.id, { [F]: e.target.value })} aria-label="단계">{st.map(x => <option key={x}>{x}</option>)}</select></td>
                    <td className="bd-title"><b>{r[C.title]}</b></td>
                    {cols.map(f => <td key={f.k}>{r[f.k] !== '' && r[f.k] != null ? fmtVal(f, r[f.k]) : '-'}</td>)}</tr>))}</tbody>
              </table></div>
              {!list.length && <p className="muted">해당 단계에 항목이 없습니다.</p>}
            </>;
          })() : <div className="tv-board" style={{ '--cols': C.kanban.stages.length }}>
            {C.kanban.stages.map((st, si) => {
              const list = rows.filter(r => r[C.kanban.field] === st);
              return (
                <div key={st} className="tv-col">
                  <div className="tv-col-h"><b>{st}</b><span className="muted">{list.length}</span></div>
                  {list.map(r => (
                    <div key={r.id} className="tv-card">
                      <b>{r[C.title]}</b>
                      {cardLine(r) && <small>{cardLine(r)}</small>}
                      <div className="tv-card-b">
                        <button className="btn sm" disabled={si === 0} onClick={() => moveStage(r, -1)} aria-label="이전 단계">‹</button>
                        <button className="btn sm" disabled={si === C.kanban.stages.length - 1} onClick={() => moveStage(r, 1)} aria-label="다음 단계">›</button>
                      </div>
                    </div>))}
                  {!list.length && <p className="tv-empty">없음</p>}
                </div>
              );
            })}
          </div>}
        </section>
      )}

      {(trend || bd || C.progress) && (
        <div className="tv-charts">
          {trend && <section className="panel"><div className="hv-ch"><h2>{C.trend.label}</h2><span className="muted">{C.trend.unit === 'day' ? `최근 ${C.trend.span || 14}일` : `최근 ${C.trend.span || 6}개월`}</span></div>
            <BarChart data={trend} color="var(--viz-sl)" fmt={fmtOf(C.trend.fmt)} tickFmt={C.trend.tick || fmtOf(C.trend.fmt)} goal={C.trend.goal} goalLabel={C.trend.goalLabel} steps={C.trend.steps} label={C.trend.label} height={200} /></section>}
          {bd && <section className="panel"><div className="hv-ch"><h2>{C.breakdown.label}</h2></div>
            {bd.length ? <ul className="fv-bars">{bd.map(x => <li key={x.g}><span className="fv-bl">{x.g}</span><span className="fv-track"><i style={{ width: `${x.v / bdMax * 100}%` }} /></span><span className="fv-bv">{fmtOf(C.breakdown.fmt)(x.v)}</span></li>)}</ul> : <p className="muted">해당 기록이 없습니다.</p>}</section>}
          {C.progress && <section className="panel"><div className="hv-ch"><h2>{C.progress.label}</h2></div>
            <ul className="tv-prog">{rows.map(r => { const cur = Number(r[C.progress.cur]) || 0, tg = Number(r[C.progress.target]) || 0, p = tg ? Math.round(cur / tg * 100) : 0; return (
              <li key={r.id}><span className="tv-pn">{r[C.progress.name]}</span><span className="fv-track"><i style={{ width: `${Math.min(100, p)}%`, background: p >= 100 ? 'var(--ok)' : 'var(--viz-sl)' }} /></span>
                <span className="tv-pv">{C.progress.fmt ? C.progress.fmt(cur, tg, r) : `${num(cur)} / ${num(tg)}`} <b>{p}%</b></span></li>); })}</ul></section>}
        </div>
      )}

      <section className="panel">
        <div className="csum-h"><h2>{C.noun} 목록</h2><span className="muted">{rows.length}건</span>
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="검색" aria-label={`${C.noun} 검색`} className="jv-q" />
          <button className="btn sm" onClick={() => setEditing(!editing)}>{editing ? '수정 끝' : '표에서 수정'}</button></div>
        <div className="tablewrap"><table className="prog tv-table">
          <thead><tr>{showCols.map(f => <th key={f.k}>{f.label}</th>)}<th /></tr></thead>
          <tbody>{listed.map(r => (
            <tr key={r.id}>
              {showCols.map(f => <td key={f.k} className={f.type === 'money' || f.type === 'number' ? 'num' : ''}>
                {editing ? <Field f={f} value={r[f.k]} onChange={v => upd(r.id, { [f.k]: v })} compact />
                  : f === titleF ? <b>{fmtVal(f, r[f.k])}</b> : fmtVal(f, r[f.k])}</td>)}
              <td className="nowrap">{C.kanban && !editing && <><button className="tl-del" onClick={() => moveStage(r, 1)} title="다음 단계">다음 단계</button> </>}
                <button className="tl-del" onClick={() => del(r.id)}>삭제</button></td>
            </tr>))}</tbody>
        </table></div>
        {!listed.length && <p className="muted">항목이 없습니다.</p>}
        <form className="tv-add" onSubmit={add}>
          {C.fields.filter(f => f.add !== false).map(f => (
            <label key={f.k} className={`tv-f ${f.type === 'long' ? 'wide' : ''}`}><span>{f.label}{f.req ? ' *' : ''}</span><Field f={f} value={form[f.k]} onChange={v => setForm({ ...form, [f.k]: v })} /></label>))}
          <button className="btn primary" disabled={!canAdd}>추가</button>
        </form>
      </section>

    </div>
  );
}

/** 칸반 / 게시판 보기 전환 */
export function ViewToggle({ value, onChange }) {
  return (
    <span className="chips bd-toggle" role="group" aria-label="보기 방식">
      <button aria-pressed={value === 'kanban'} onClick={() => onChange('kanban')}>칸반</button>
      <button aria-pressed={value === 'list'} onClick={() => onChange('list')}>게시판</button>
    </span>
  );
}
