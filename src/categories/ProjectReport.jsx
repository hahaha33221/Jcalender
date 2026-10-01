import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { won } from './finance.js';
import { useCtx } from '../shared.jsx';

/* 연계 프로젝트 지출 보고서 (PDF)
   기획
   - 1쪽 "한눈에 보기": 핵심 지표 4칸 → 핵심 요약(자동 문장) → 프로젝트별 요약 표 → 월별 추이 표
   - 2쪽부터 "프로젝트 상세"(선택): 프로젝트마다 머리 줄(합계·건수·기간) · 메모 | 분류별 합계 · 큰 지출 TOP 3 · 전체 지출 내역
   - "정산 (N분의 1)": 프로젝트마다 함께 나눌 사람 · 나 포함 여부를 정하면 1인당 금액 · 받을 금액 (project.split = { people, me })
   - 마지막 "비고 · 향후 계획": 미리보기에서 직접 적는 칸 (finance.report.next 에 저장)
   - 옵션: 프로젝트 선택 · 기간(시작 달 ~ 끝 달) · 구성(요약만 / 상세 포함)
   - 인쇄 서식: 글자 검은색, 음영 없음, 모든 내용은 테두리 칸 안, A4 세로
   PDF 저장 = 브라우저 인쇄 창에서 "PDF로 저장" (한글 글꼴을 따로 넣지 않아도 됨) */
const dot = s => (s ? `${s.slice(0, 4)}. ${s.slice(5, 7)}. ${s.slice(8, 10)}.` : '');
const md = s => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
const ymL = k => `${k.slice(0, 4)}년 ${Number(k.slice(5, 7))}월`;
const pct = (a, b) => (b ? `${Math.round(a / b * 100)}%` : '-');
const sumOf = l => l.reduce((a, e) => a + e.amount, 0);
/** 정산: 함께 나눌 사람(people) + 나 포함(me) → 1인당 금액. 1원 단위 나머지는 나(포함 시) 또는 첫 사람이 부담 */
export const splitOf = p => ({ people: [], me: true, ...(p?.split || {}) });
export function settle(sum, split) {
  const n = split.people.length + (split.me ? 1 : 0);
  if (!split.people.length || !n) return null;
  const share = Math.floor(sum / n), rest = sum - share * n;
  const rows = split.people.map((name, i) => ({ name, amount: share + (!split.me && i === 0 ? rest : 0) }));
  return { n, share, rest, restTo: rest ? (split.me ? '나' : split.people[0]) : '', rows, mine: split.me ? share + rest : 0, receive: rows.reduce((a, r) => a + r.amount, 0) };
}
const group = (l, key) => Object.entries(l.reduce((m, e) => { const k = key(e); m[k] = (m[k] || 0) + e.amount; return m; }, {}));

export default function ProjectReport({ f, update, today, onClose }) {
  const projects = f.projects || [];
  const linked = f.expenses.filter(e => projects.some(p => p.id === e.projectId));
  const allMonths = [...new Set(linked.map(e => e.date.slice(0, 7)))].sort();
  const [pick, setPick] = useState(() => new Set(projects.map(p => p.id)));
  const [from, setFrom] = useState(allMonths[0] || '');
  const [to, setTo] = useState(allMonths[allMonths.length - 1] || '');
  const [detail, setDetail] = useState(true);
  const R = f.report || {};
  const { store } = useCtx();
  const names = [...new Set((store.people || []).map(x => x.name).filter(Boolean))];
  const setSplit = (pid, patch) => update(x => ({ ...x, projects: x.projects.map(p => (p.id === pid ? { ...p, split: { ...splitOf(p), ...patch } } : p)) }));

  const inRange = e => (!from || e.date.slice(0, 7) >= from) && (!to || e.date.slice(0, 7) <= to);
  const chosen = projects.filter(p => pick.has(p.id));
  const data = chosen.map(p => {
    const ex = f.expenses.filter(e => e.projectId === p.id && inRange(e)).sort((a, b) => a.date.localeCompare(b.date));
    const cats = group(ex, e => e.cat).sort((a, b) => b[1] - a[1]);
    const sum = sumOf(ex);
    return { p, ex, sum, cats, top: [...ex].sort((a, b) => b.amount - a.amount).slice(0, 3), st: settle(sum, splitOf(p)) };
  });
  const all = data.flatMap(d => d.ex), total = sumOf(all);
  const months = [...new Set(all.map(e => e.date.slice(0, 7)))].sort();
  const byMonth = Object.fromEntries(group(all, e => e.date.slice(0, 7)));
  const ranked = [...data].sort((a, b) => b.sum - a.sum);
  const biggest = [...all].sort((a, b) => b.amount - a.amount)[0];
  const peak = Object.entries(byMonth).sort((a, b) => b[1] - a[1])[0];
  const last2 = months.slice(-2);
  const insights = [
    ranked[0]?.sum ? `지출이 가장 큰 프로젝트는 "${ranked[0].p.name}"로 ${won(ranked[0].sum)}(전체의 ${pct(ranked[0].sum, total)})입니다.` : '',
    biggest ? `가장 큰 단일 지출은 ${dot(biggest.date)} ${biggest.memo} ${won(biggest.amount)}입니다.` : '',
    peak && months.length > 1 ? `지출이 가장 많았던 달은 ${ymL(peak[0])}(${won(peak[1])})입니다.` : '',
    last2.length === 2 ? `${ymL(last2[1])} 지출은 전월 대비 ${byMonth[last2[1]] >= byMonth[last2[0]] ? '+' : '-'}${won(Math.abs(byMonth[last2[1]] - byMonth[last2[0]]))} ${byMonth[last2[1]] >= byMonth[last2[0]] ? '늘었' : '줄었'}습니다.` : '',
    data.some(d => !d.ex.length) ? `연결된 지출이 없는 프로젝트: ${data.filter(d => !d.ex.length).map(d => d.p.name).join(', ')}` : '',
  ].filter(Boolean);

  useEffect(() => {
    document.body.classList.add('report-open');
    const esc = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', esc);
    return () => { document.body.classList.remove('report-open'); window.removeEventListener('keydown', esc); };
  }, []);
  const print = () => {
    const t = document.title;
    document.title = `project_report_${today.replace(/-/g, '')}`;           // PDF 파일 이름 (영문)
    window.print();
    setTimeout(() => { document.title = t; }, 500);
  };
  const period = months.length ? `${dot(all.map(e => e.date).sort()[0])} ~ ${dot(all.map(e => e.date).sort().pop())}` : '-';

  return createPortal(
    <div className="rp-wrap" role="dialog" aria-label="연계 프로젝트 지출 보고서">
      <div className="rp-bar no-print">
        <b>보고서</b>
        <span className="rp-pick">{projects.map(p => (
          <label key={p.id}><input type="checkbox" checked={pick.has(p.id)} onChange={e => setPick(s => { const n = new Set(s); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })} />{p.name}</label>))}</span>
        {allMonths.length > 0 && <span className="rp-range">기간
          <select value={from} onChange={e => setFrom(e.target.value)}>{allMonths.map(m => <option key={m} value={m}>{ymL(m)}</option>)}</select>~
          <select value={to} onChange={e => setTo(e.target.value)}>{allMonths.map(m => <option key={m} value={m}>{ymL(m)}</option>)}</select></span>}
        <span className="chips"><button aria-pressed={!detail} onClick={() => setDetail(false)}>요약만</button><button aria-pressed={detail} onClick={() => setDetail(true)}>상세 포함</button></span>
        <button className="btn primary" onClick={print} disabled={!chosen.length}>PDF로 저장</button>
        <button className="btn" onClick={onClose}>닫기</button>
        <small>인쇄 창에서 대상을 "PDF로 저장"으로 고르세요. 맨 아래 "비고 · 향후 계획"은 바로 적을 수 있습니다.</small>
      </div>

      <article className="rp">
        <header className="rp-head">
          <p className="rp-kicker">개인 재무 · 연계 프로젝트</p>
          <h1>프로젝트 지출 보고서</h1>
          <table className="rp-meta"><tbody><tr>
            <th>기간</th><td>{period}</td><th>작성일</th><td>{dot(today)}</td><th>대상</th><td>{chosen.length}개 프로젝트</td>
          </tr></tbody></table>
        </header>

        <h2><span>01</span>핵심 지표</h2>
        <div className="rp-kpis">
          <div><small>총 지출</small><b>{won(total)}</b></div>
          <div><small>프로젝트</small><b>{chosen.length}개</b></div>
          <div><small>지출 건수</small><b>{all.length}건</b></div>
          <div><small>건당 평균</small><b>{all.length ? won(Math.round(total / all.length)) : '-'}</b></div>
        </div>

        <h2><span>02</span>핵심 요약</h2>
        <div className="rp-box"><ol className="rp-ins">{insights.length ? insights.map((t, i) => <li key={i}>{t}</li>) : <li>선택한 기간에 연결된 지출이 없습니다.</li>}</ol></div>

        <h2><span>03</span>프로젝트별 요약</h2>
        <table className="rp-table"><thead><tr><th>순위</th><th>프로젝트</th><th>기간</th><th>건수</th><th>합계</th><th>비중</th><th>주요 분류</th></tr></thead>
          <tbody>{ranked.map((d, i) => (
            <tr key={d.p.id}><td className="c">{i + 1}</td><td><b>{d.p.name}</b></td>
              <td className="c">{d.ex.length ? `${md(d.ex[0].date)} ~ ${md(d.ex[d.ex.length - 1].date)}` : '-'}</td>
              <td className="r">{d.ex.length}</td><td className="r">{won(d.sum)}</td><td className="r">{pct(d.sum, total)}</td>
              <td>{d.cats[0] ? `${d.cats[0][0]} (${pct(d.cats[0][1], d.sum)})` : '-'}</td></tr>))}
            <tr className="rp-sum"><td colSpan={3} className="c">합계</td><td className="r">{all.length}</td><td className="r">{won(total)}</td><td className="r">{total ? '100%' : '-'}</td><td /></tr>
          </tbody></table>

        <h2><span>04</span>정산 (N분의 1)</h2>
        <div className="rp-split-edit no-print">
          {ranked.map(d => <SplitEditor key={d.p.id} p={d.p} names={names} onChange={patch => setSplit(d.p.id, patch)} />)}
          <datalist id="rp-people">{names.map(n => <option key={n} value={n} />)}</datalist>
        </div>
        {ranked.some(d => d.st) ? (
          <table className="rp-table"><thead><tr><th>프로젝트</th><th>합계</th><th>나누는 사람</th><th>인원</th><th>1인당</th><th>받을 금액</th></tr></thead>
            <tbody>{ranked.filter(d => d.st).map(d => (
              <tr key={d.p.id}><td><b>{d.p.name}</b></td><td className="r">{won(d.sum)}</td>
                <td>{[splitOf(d.p).me ? '나' : null, ...splitOf(d.p).people].filter(Boolean).join(', ')}</td>
                <td className="c">{d.st.n}명</td><td className="r"><b>{won(d.st.share)}</b>{d.st.rest ? <small> (+{d.st.rest}원 {d.st.restTo})</small> : null}</td>
                <td className="r">{won(d.st.receive)}</td></tr>))}
              <tr className="rp-sum"><td className="c">합계</td><td className="r">{won(ranked.filter(d => d.st).reduce((a, d) => a + d.sum, 0))}</td><td colSpan={3} /><td className="r">{won(ranked.filter(d => d.st).reduce((a, d) => a + d.st.receive, 0))}</td></tr>
            </tbody></table>
        ) : <div className="rp-box"><p>나눌 사람을 정한 프로젝트가 없습니다. 모두 본인 부담입니다.</p></div>}
        <p className="rp-note">받을 금액 = 함께 나눈 사람들이 나에게 보낼 금액의 합 (지출은 내가 먼저 냈다고 보고 계산)</p>

        {months.length > 0 && <>
          <h2><span>05</span>월별 추이</h2>
          <table className="rp-table"><thead><tr><th>월</th>{ranked.map(d => <th key={d.p.id}>{d.p.name}</th>)}<th>합계</th><th>전월 대비</th></tr></thead>
            <tbody>{months.map((m, i) => {
              const prev = months[i - 1], dlt = prev ? byMonth[m] - byMonth[prev] : null;
              return (
                <tr key={m}><td className="c">{ymL(m)}</td>
                  {ranked.map(d => { const v = sumOf(d.ex.filter(e => e.date.startsWith(m))); return <td key={d.p.id} className="r">{v ? won(v) : '-'}</td>; })}
                  <td className="r"><b>{won(byMonth[m])}</b></td><td className="r">{dlt == null ? '-' : `${dlt >= 0 ? '+' : '-'}${won(Math.abs(dlt))}`}</td></tr>
              );
            })}</tbody></table>
        </>}

        {detail && ranked.map((d, i) => (
          <section key={d.p.id} className="rp-proj">
            <h2><span>{String(i + 6).padStart(2, '0')}</span>프로젝트 상세 · {d.p.name}</h2>
            <table className="rp-meta"><tbody><tr>
              <th>합계</th><td><b>{won(d.sum)}</b> ({pct(d.sum, total)})</td><th>건수</th><td>{d.ex.length}건</td><th>기간</th><td>{d.ex.length ? `${dot(d.ex[0].date)} ~ ${dot(d.ex[d.ex.length - 1].date)}` : '-'}</td>
            </tr></tbody></table>
            <div className="rp-two">
              <div className="rp-box"><p className="rp-label">메모</p><p className="rp-pre">{d.p.note?.trim() || '(메모 없음)'}</p></div>
              <div className="rp-box"><p className="rp-label">분류별 합계</p>
                {d.cats.length ? <table className="rp-table rp-mini"><tbody>{d.cats.map(([c, v]) => <tr key={c}><td>{c}</td><td className="r">{won(v)}</td><td className="r">{pct(v, d.sum)}</td></tr>)}</tbody></table> : <p>-</p>}</div>
            </div>
            {d.top.length > 0 && <div className="rp-box"><p className="rp-label">큰 지출 TOP {d.top.length}</p>
              <ol className="rp-ins">{d.top.map(e => <li key={e.id}>{dot(e.date)} · {e.memo} · <b>{won(e.amount)}</b> <small>({e.cat}, {e.card || '직접 입력'})</small></li>)}</ol></div>}
            {d.st && <div className="rp-box"><p className="rp-label">정산 · {d.st.n}명이 나눔 (1인당 {won(d.st.share)})</p>
              <table className="rp-table rp-mini"><tbody>
                {splitOf(d.p).me && <tr><td>나</td><td className="r">{won(d.st.mine)}</td><td>본인 부담{d.st.rest && d.st.restTo === '나' ? ` (나머지 ${d.st.rest}원 포함)` : ''}</td></tr>}
                {d.st.rows.map(r => <tr key={r.name}><td>{r.name}</td><td className="r">{won(r.amount)}</td><td>나에게 보낼 금액</td></tr>)}
                <tr className="rp-sum"><td>받을 금액 합계</td><td className="r">{won(d.st.receive)}</td><td /></tr>
              </tbody></table></div>}
            <p className="rp-label rp-out">지출 내역 ({d.ex.length}건)</p>
            {d.ex.length ? (
              <table className="rp-table"><thead><tr><th>No.</th><th>날짜</th><th>분류</th><th>내용</th><th>카드</th><th>금액</th></tr></thead>
                <tbody>{d.ex.map((e, k) => <tr key={e.id}><td className="c">{k + 1}</td><td className="c">{md(e.date)}</td><td>{e.cat}</td><td>{e.memo}</td><td>{e.card || '직접 입력'}</td><td className="r">{won(e.amount)}</td></tr>)}
                  <tr className="rp-sum"><td colSpan={5} className="c">소계</td><td className="r">{won(d.sum)}</td></tr></tbody></table>
            ) : <div className="rp-box"><p>선택한 기간에 연결된 지출이 없습니다.</p></div>}
          </section>
        ))}

        <h2><span>{String((detail ? ranked.length : 0) + 6).padStart(2, '0')}</span>비고 · 향후 계획</h2>
        <div className="rp-box"><Editable value={R.next || ''} onChange={v => update(x => ({ ...x, report: { ...(x.report || {}), next: v } }))} placeholder="예: 다음 달 예산 조정, 견적 비교, 결제 일정 확인 등" /></div>
        <p className="rp-foot">금액은 카드사 이용내역(명세서) 반영 기준이며 취소 건과 원화 미확정 해외 이용은 제외됩니다. · Jcalender</p>
      </article>
    </div>,
    document.body,
  );
}

/** 인쇄에서는 그냥 글처럼 보이는 여러 줄 입력칸 */
function Editable({ value, onChange, placeholder }) {
  return (
    <>
      <textarea className="rp-edit no-print" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        rows={Math.max(3, (value.match(/\n/g) || []).length + 2)} />
      <p className="rp-pre print-only">{value || ' '}</p>
    </>
  );
}

/** 프로젝트별 "함께 나눌 사람" 입력 (화면에서만, 인쇄 안 됨) */
function SplitEditor({ p, names, onChange }) {
  const sp = splitOf(p);
  const [v, setV] = useState('');
  const add = () => {
    const list = v.split(/[,，]/).map(x => x.trim()).filter(x => x && x !== '나' && !sp.people.includes(x));
    if (list.length) onChange({ people: [...sp.people, ...list] });
    setV('');
  };
  return (
    <div className="rp-split-row">
      <b>{p.name}</b>
      <label><input type="checkbox" checked={sp.me} onChange={e => onChange({ me: e.target.checked })} />나 포함</label>
      <span className="rp-split-people">{sp.people.map(n => (
        <span key={n} className="rp-chip">{n}<button type="button" aria-label={`${n} 빼기`} onClick={() => onChange({ people: sp.people.filter(x => x !== n) })}>×</button></span>))}</span>
      <input value={v} onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        list="rp-people" placeholder="함께 나눌 사람 (쉼표로 여러 명)" aria-label={`${p.name} 함께 나눌 사람`} />
      <button type="button" className="btn sm" onClick={add}>추가</button>
      <span className="rp-split-n">{sp.people.length ? `${sp.people.length + (sp.me ? 1 : 0)}분의 1` : '본인 부담'}</span>
    </div>
  );
}
