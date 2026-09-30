import React, { useEffect, useRef, useState } from 'react';
import { CARD_COMPANIES, mergeCard, parseCardRows, readTable } from '../cardImport.js';
import { catsOf, guessCatBy, won } from './finance.js';
import BarChart from './BarChart.jsx';

/* 개인 재무 › 카드 이용내역 가져오기(미리보기 → 반영 완료) · 월별 누적 · 반영 기록
   finance.imports = [{ id, at('YYYY-MM-DD HH:MM'), files: [{ name, company, kind, count, sum, dup, cancelled, foreign, check }],
                        added, sum, months: { 'YYYY-MM': { n, sum } } }]   최신이 앞
   반영된 지출에는 importId 가 붙어 있어 "반영 취소" 로 그 묶음만 지울 수 있다 */
const uid = () => Math.random().toString(36).slice(2, 10);
const ymLabel = ym => `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월`;
const monthsOf = list => list.reduce((m, e) => { const k = e.date.slice(0, 7); (m[k] ||= { n: 0, sum: 0 }); m[k].n++; m[k].sum += e.amount; return m; }, {});
const stamp = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** 1) 파일 올리기 → 미리보기(아직 저장 안 함) → 반영 완료 */
export function CardImport({ f, update, now, onMonth }) {
  const ref = useRef(null);
  const [pick, setPick] = useState('auto');
  const [msg, setMsg] = useState(null);
  const [pending, setPending] = useState(null);           // { id, fin, files, add, errors }
  const installment = f.cardInstallment || 'bill';        // 명세서 할부: bill 이번 달 청구분 · use 이용일에 전체 금액

  const upload = async fileList => {
    const id = uid(), files = [], errors = [];
    let fin = pending ? pending.fin : f, add = pending ? [...pending.add] : [];
    for (const file of [...(fileList || [])]) {
      try {
        const rows = await readTable(file);
        const p = parseCardRows(rows, { pick, fileName: file.name, year: now.getFullYear(), guess: m => guessCatBy(catsOf(f), m), installment });
        if (!p.items.length) throw new Error('가져올 이용 건이 없습니다');
        const res = mergeCard(fin, p, uid, pending?.id || id);
        fin = res.fin; add = [...add, ...res.add];
        const sum = res.add.reduce((a, x) => a + x.amount, 0), all = p.items.reduce((a, x) => a + x.amount, 0);
        const check = p.statement ? { label: '명세서 청구 합계', file: p.billTotal, got: all } : p.fileTotal != null ? { label: '파일 요약 국내 정상', file: p.fileTotal, got: all } : null;
        files.push({ name: file.name, company: p.company, kind: p.statement ? '이용대금명세서' : '이용내역', count: res.added, sum, dup: res.dup, cancelled: p.cancelled, foreign: p.foreign, removedExamples: res.removedExamples, check });
      } catch (e) { errors.push(`${file.name}: 읽지 못했습니다 (${e.message})`); }
    }
    if (ref.current) ref.current.value = '';
    if (!files.length) { setMsg({ err: true, t: errors.join(' / ') }); return; }
    setMsg(errors.length ? { err: true, t: errors.join(' / ') } : null);
    setPending({ id: pending?.id || id, fin, files: [...(pending?.files || []), ...files], add });
  };
  const commit = () => {
    const P = pending, months = monthsOf(P.add);
    const rec = { id: P.id, at: stamp(new Date()), files: P.files.map(({ removedExamples, ...x }) => x), added: P.add.length, sum: P.add.reduce((a, x) => a + x.amount, 0), months };
    // 미리보기 동안 다른 곳을 고쳤을 수 있으니 지금 데이터에 새 지출만 더한다 (예시 지출은 지움, 이미 있는 건 제외)
    update(x => {
      const real = x.expenses.filter(e => !/\(예시\)$/.test(e.memo || ''));
      const have = new Set(real.map(e => e.cardKey).filter(Boolean));
      return { ...x, expenses: [...real, ...P.add.filter(e => !have.has(e.cardKey))], cardImport: { at: rec.at.slice(0, 10), added: rec.added }, imports: [rec, ...(x.imports || [])] };
    });
    const last = Object.keys(months).sort().pop();
    if (last) onMonth(last);
    setMsg({ t: `반영 완료: ${rec.added}건 · ${won(rec.sum)} (${Object.keys(months).sort().map(ymLabel).join(', ')})` });
    setPending(null);
  };

  // 파일 끌어다 놓기: 이 칸 위에 놓으면 올리기. 다른 곳에 잘못 놓아도 브라우저가 파일을 열어 버리지 않게 막는다
  const [drag, setDrag] = useState(false);
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  useEffect(() => {
    const stop = e => { if (hasFiles(e)) e.preventDefault(); };
    window.addEventListener('dragover', stop); window.addEventListener('drop', stop);
    return () => { window.removeEventListener('dragover', stop); window.removeEventListener('drop', stop); };
  }, []);
  const dropProps = {
    onDragEnter: e => { if (hasFiles(e)) { e.preventDefault(); setDrag(true); } },
    onDragOver: e => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } },
    onDragLeave: e => { if (!e.currentTarget.contains(e.relatedTarget)) setDrag(false); },
    onDrop: e => { if (!hasFiles(e)) return; e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); },
  };

  const P = pending;
  const pm = P ? monthsOf(P.add) : {};
  const pc = P ? P.add.reduce((m, e) => { m[e.cat] = (m[e.cat] || 0) + e.amount; return m; }, {}) : {};
  return (
    <section className={`panel fv-card ${drag ? 'drag' : ''}`} {...dropProps}>
      <div className="csum-h"><h2>카드 이용내역 가져오기</h2>
        <span className="muted">{f.cardImport ? `마지막 반영 ${f.cardImport.at}` : '파일을 올리면 미리보기 후 "반영 완료" 로 월별 내역에 쌓입니다'}</span></div>
      <div className="fv-card-row">
        <label className="fv-card-pick">카드사<select value={pick} onChange={e => setPick(e.target.value)}>
          <option value="auto">자동 인식</option>{CARD_COMPANIES.map(c => <option key={c}>{c}</option>)}</select></label>
        <label className="fv-card-pick">명세서 할부<select value={installment} disabled={!!P} onChange={e => { const v = e.target.value; update(x => ({ ...x, cardInstallment: v })); }}>
          <option value="bill">이번 달 청구분 (명세서 합계와 같게)</option>
          <option value="use">이용일에 전체 금액 한 번</option></select></label>
        <label className="btn primary">{P ? '파일 더 올리기' : '이용내역 파일 올리기'}<input ref={ref} type="file" accept=".xls,.xlsx,.csv,.htm,.html" multiple hidden onChange={e => upload(e.target.files)} /></label>
        <label className="fm-drop" title="눌러서 파일 고르기도 됩니다">{drag ? '여기에 놓으면 올라갑니다' : '또는 파일을 여기로 끌어다 놓기 (여러 개 가능)'}
          <input type="file" accept=".xls,.xlsx,.csv,.htm,.html" multiple hidden onChange={e => { upload(e.target.files); e.target.value = ''; }} /></label>
      </div>
      {msg && <p className={`sh-msg ${msg.err ? 'err' : ''}`} role="status">{msg.t}</p>}

      {P && (
        <div className="fm-pre" aria-label="반영 전 미리보기">
          <div className="fm-pre-h"><b>미리보기</b><span className="muted">아직 저장되지 않았습니다. 확인 후 "반영 완료" 를 누르세요.</span></div>
          <ul className="fm-files">{P.files.map((x, i) => (
            <li key={i}><b>{x.company}</b> {x.kind} <span className="muted">{x.name}</span>
              <span>새로 {x.count}건 · {won(x.sum)}{x.dup ? ` · 이미 반영 ${x.dup}건 제외` : ''}{x.cancelled ? ` · 취소 ${x.cancelled}건 제외` : ''}{x.foreign ? ` · 해외(원화 미확정) ${x.foreign}건 제외` : ''}{x.removedExamples ? ` · 예시 지출 ${x.removedExamples}건 삭제` : ''}</span>
              {x.check && <span className={x.check.file === x.check.got ? 'fm-ok' : 'fm-diff'}>{x.check.label} {won(x.check.file)} / 파일 합계 {won(x.check.got)} {x.check.file === x.check.got ? '일치' : '차이 있음'}</span>}
            </li>))}</ul>
          <div className="fm-pre-grid">
            <div><h4>월별</h4><ul className="fm-kv">{Object.keys(pm).sort().map(k => <li key={k}><span>{ymLabel(k)}</span><b>{pm[k].n}건 · {won(pm[k].sum)}</b></li>)}</ul></div>
            <div><h4>분류별</h4><ul className="fm-kv">{Object.entries(pc).sort((a, b) => b[1] - a[1]).map(([k, v]) => <li key={k}><span>{k}</span><b>{won(v)}</b></li>)}</ul></div>
          </div>
          {P.add.length > 0 && <div className="tablewrap fm-pre-list"><table className="prog fv-table">
            <thead><tr><th>날짜</th><th>분류</th><th>내용</th><th>금액</th></tr></thead>
            <tbody>{[...P.add].sort((a, b) => b.date.localeCompare(a.date)).map(e => <tr key={e.id}><td>{e.date.slice(2).replace(/-/g, '/')}</td><td>{e.cat}</td><td>{e.memo}<span className="tag">{e.card}</span></td><td className="num">{won(e.amount)}</td></tr>)}</tbody>
          </table></div>}
          <div className="fm-pre-f">
            <span className="muted">합계 새로 {P.add.length}건 · {won(P.add.reduce((a, x) => a + x.amount, 0))}</span>
            <button className="btn" onClick={() => { setPending(null); setMsg({ t: '미리보기를 취소했습니다. 저장된 것은 없습니다.' }); }}>취소</button>
            <button className="btn primary" disabled={!P.add.length} onClick={commit}>반영 완료</button>
          </div>
        </div>
      )}

    </section>
  );
}

/** 2) 월별 누적: 달마다 건수 · 합계 · 카드별 · 전월 대비 · 올해 누계, 반영 기록(반영 취소) */
export function MonthlyLedger({ f, update, month, onMonth }) {
  const [all, setAll] = useState(false);
  const [arm, setArm] = useState(null);
  const cards = [...new Set([...CARD_COMPANIES, ...f.expenses.map(e => e.card).filter(Boolean)])];
  const src = e => e.card || '직접 입력';
  const cols = [...cards.filter(c => f.expenses.some(e => e.card === c)), ...(f.expenses.some(e => !e.card) ? ['직접 입력'] : [])];
  const by = {};
  f.expenses.forEach(e => { const k = e.date.slice(0, 7); const m = (by[k] ||= { n: 0, sum: 0, s: {} }); m.n++; m.sum += e.amount; m.s[src(e)] = (m.s[src(e)] || 0) + e.amount; });
  const keys = Object.keys(by).sort();
  const ytd = {};
  keys.forEach((k, i) => { const prev = keys[i - 1]; ytd[k] = by[k].sum + (prev && prev.slice(0, 4) === k.slice(0, 4) ? ytd[prev] : 0); });
  const shown = (all ? keys : keys.slice(-12)).slice().reverse();
  const chart = keys.slice(-12).map(k => ({ key: k, label: `${Number(k.slice(5))}월`, title: ymLabel(k), value: by[k].sum, tip: Object.entries(by[k].s).map(([c, v]) => `${c} ${won(v)}`) }));
  const imports = f.imports || [];
  const cancel = r => update(x => ({ ...x, expenses: x.expenses.filter(e => e.importId !== r.id), imports: (x.imports || []).filter(k => k.id !== r.id) }));

  return (
    <section className="panel fm">
      <div className="csum-h"><h2>월별 누적</h2><span className="muted">반영한 카드 지출을 달마다 모읍니다. 줄을 누르면 그 달 내역을 봅니다.</span></div>
      {keys.length ? <>
        <BarChart data={chart} color="var(--viz-sl)" fmt={v => won(v)} tickFmt={v => (v >= 10000 ? `${Math.round(v / 10000)}만` : `${v}`)} label="월별 지출 합계" height={190} />
        <div className="tablewrap"><table className="prog fm-table">
          <thead><tr><th>월</th><th>건수</th><th>합계</th>{cols.map(c => <th key={c}>{c}</th>)}<th>전월 대비</th><th>올해 누계</th></tr></thead>
          <tbody>{shown.map(k => {
            // 전월 = 달력상 바로 앞 달 (그 달 지출이 없으면 비교하지 않음)
            const pd = new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 2, 1);
            const prev = `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, '0')}`, d = by[prev] ? by[k].sum - by[prev].sum : null;
            return (
              <tr key={k} className={k === month ? 'on' : ''} onClick={() => onMonth(k)} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') onMonth(k); }}>
                <td className="fm-m">{ymLabel(k)}</td><td className="num">{by[k].n}</td><td className="num"><b>{won(by[k].sum)}</b></td>
                {cols.map(c => <td key={c} className="num">{by[k].s[c] ? won(by[k].s[c]) : '-'}</td>)}
                <td className={`num ${d > 0 ? 'fm-up' : d < 0 ? 'fm-down' : ''}`}>{d == null ? '-' : `${d > 0 ? '+' : ''}${won(d)}`}</td>
                <td className="num">{won(ytd[k])}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
        {keys.length > 12 && <button className="btn sm" onClick={() => setAll(v => !v)}>{all ? '최근 12개월만' : `전체 ${keys.length}개월 보기`}</button>}
      </> : <p className="muted">아직 지출이 없습니다. 카드 이용내역을 반영하면 달마다 쌓입니다.</p>}

      <h3 className="lv-h3">반영 기록 <small className="muted">{imports.length}회</small></h3>
      {imports.length ? <ul className="fm-log">{imports.map(r => (
        <li key={r.id}>
          <time>{r.at}</time>
          <span className="grow">{r.files.map(x => `${x.company} ${x.kind}`).join(' · ')} <small className="muted">{Object.keys(r.months || {}).sort().map(ymLabel).join(', ')}</small></span>
          <b>{r.added}건 · {won(r.sum)}</b>
          <button className={`btn sm ${arm === r.id ? 'danger' : ''}`} onClick={() => { if (arm === r.id) { cancel(r); setArm(null); } else { setArm(r.id); setTimeout(() => setArm(a => (a === r.id ? null : a)), 3000); } }}>{arm === r.id ? '정말 취소?' : '반영 취소'}</button>
        </li>))}</ul> : <p className="muted">아직 반영한 파일이 없습니다.</p>}
    </section>
  );
}
