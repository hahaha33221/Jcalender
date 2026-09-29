import React, { useState } from 'react';
import { MoneyInput, areaVar } from '../shared.jsx';
import { useFinance } from './Shopping.jsx';
import { OTHER, addCat, catsOf, defaultCats, delCat, moveCat, reapplyCats, renameCat, setCat, won } from './finance.js';

/* 개인 재무 › 지출 카테고리 설정 (상세 페이지)
   - 카테고리: 이름 바꾸기(지출·구매 목록도 함께) · 순서 · 삭제(해당 지출은 기타로) · 추가
   - 범위: 월 예산(한도) · 포함 범위(가맹점·메모에 들어 있으면 이 분류로 넣을 말)
   - 카드에서 가져온 지출에 바뀐 포함 범위 다시 적용 */
export default function FinanceCats({ area, cat, month, onBack }) {
  const [f, update] = useFinance();
  const cats = catsOf(f);
  const monthExp = f.expenses.filter(e => e.date.slice(0, 7) === month);
  const spent = name => monthExp.filter(e => e.cat === name).reduce((a, e) => a + e.amount, 0);
  const count = name => f.expenses.filter(e => e.cat === name).length;
  const budgetSum = cats.reduce((a, c) => a + (c.budget || 0), 0);
  const [nf, setNf] = useState({ name: '', budget: '' });
  const [msg, setMsg] = useState(null);
  const [undo, setUndo] = useState(null);
  const [arm, setArm] = useState(null);
  const [names, setNames] = useState({});                 // 이름 고치는 중인 값 (입력을 마치면 반영)
  const [kw, setKw] = useState({});                       // 카테고리별 새 포함 범위 입력값
  const snap = () => setUndo(f);
  const commitName = c => {
    const to = (names[c.name] ?? c.name).trim();
    setNames(n => { const r = { ...n }; delete r[c.name]; return r; });
    if (!to || to === c.name) return;
    if (cats.some(k => k.name === to)) { setMsg({ err: true, t: `"${to}" 카테고리가 이미 있습니다.` }); return; }
    snap(); update(x => renameCat(x, c.name, to));
    setMsg({ t: `"${c.name}" → "${to}" 로 바꿨습니다. 지출 ${count(c.name)}건의 분류도 함께 바뀌었습니다.` });
  };
  const addKw = c => {
    const words = (kw[c.name] || '').split(/[,，]/).map(s => s.trim()).filter(Boolean).filter(w => !(c.keywords || []).includes(w));
    if (!words.length) return;
    update(x => setCat(x, c.name, { keywords: [...(c.keywords || []), ...words] }));
    setKw({ ...kw, [c.name]: '' });
  };
  const add = e => {
    e.preventDefault();
    const name = nf.name.trim();
    if (!name) return;
    if (cats.some(c => c.name === name)) { setMsg({ err: true, t: `"${name}" 카테고리가 이미 있습니다.` }); return; }
    update(x => addCat(x, name, Number(nf.budget) || 0));
    setNf({ name: '', budget: '' });
    setMsg({ t: `"${name}" 카테고리를 추가했습니다. 포함 범위를 넣으면 카드 지출이 자동으로 분류됩니다.` });
  };
  const reapply = () => {
    const { f: g, changed } = reapplyCats(f);
    if (!changed) { setMsg({ t: '바뀐 분류가 없습니다.' }); return; }
    snap(); update(() => g);
    setMsg({ t: `카드에서 가져온 지출 ${changed}건의 분류를 바꿨습니다.` });
  };

  return (
    <div className="catv fv fc" style={{ '--ac': areaVar(area) }}>
      <header className="page-h fv-head">
        <h1 className="area-title">지출 카테고리 설정</h1>
        <button className="btn" onClick={onBack}>← {cat}로 돌아가기</button>
      </header>

      <div className="hv-stats">
        <div className="hv-stat sl"><span className="muted">카테고리</span><b>{cats.length}개</b><span className="hv-sub">기타는 지울 수 없음</span></div>
        <div className={`hv-stat ${f.budget && budgetSum > f.budget ? 'over' : 'sl'}`}><span className="muted">카테고리 예산 합계</span><b>{won(budgetSum)}</b>
          <span className="hv-sub">월 전체 예산 {f.budget ? won(f.budget) : '미설정'}{f.budget && budgetSum > f.budget ? ' · 초과' : ''}</span></div>
        <div className="hv-stat ex"><span className="muted">{month.replace('-', '년 ')}월 지출</span><b>{won(monthExp.reduce((a, e) => a + e.amount, 0))}</b><span className="hv-sub">{monthExp.length}건</span></div>
      </div>

      <section className="panel">
        <div className="csum-h"><h2>카테고리와 범위</h2>
          <span className="muted">이름은 입력을 마치면 반영 · 포함 범위는 쉼표로 여러 개 입력</span>
          <span className="grow-r fc-top">
            <button className="btn sm" onClick={reapply}>카드 지출에 범위 다시 적용</button>
            {undo && <button className="btn sm" onClick={() => { update(() => undo); setUndo(null); setMsg({ t: '되돌렸습니다.' }); }}>되돌리기</button>}
          </span></div>
        {msg && <p className={`sh-msg ${msg.err ? 'err' : ''}`} role="status">{msg.t}</p>}

        <ul className="fc-list">{cats.map((c, i) => {
          const s = spent(c.name), r = c.budget ? s / c.budget : 0, other = c.name === OTHER;
          return (
            <li key={c.name} className="fc-item">
              <div className="fc-h">
                <span className="fc-ord">
                  <button className="btn sm" disabled={i === 0} onClick={() => update(x => moveCat(x, c.name, -1))} aria-label={`${c.name} 위로`}>↑</button>
                  <button className="btn sm" disabled={i === cats.length - 1} onClick={() => update(x => moveCat(x, c.name, 1))} aria-label={`${c.name} 아래로`}>↓</button>
                </span>
                {other ? <b className="fc-name">{c.name}</b> : (
                  <input className="fc-name" value={names[c.name] ?? c.name} aria-label="카테고리 이름"
                    onChange={e => setNames({ ...names, [c.name]: e.target.value })} onBlur={() => commitName(c)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />)}
                <label className="fc-budget">월 예산<MoneyInput value={c.budget || ''} onChange={v => update(x => setCat(x, c.name, { budget: Math.max(0, Number(v) || 0) }))} placeholder="없음" aria-label={`${c.name} 월 예산`} />원</label>
                <span className="fc-use">
                  <span className="pbar"><i style={{ width: `${c.budget ? Math.min(100, r * 100) : 0}%`, background: r > 1 ? 'var(--over)' : 'var(--viz-sl)' }} /></span>
                  <small>{won(s)}{c.budget ? ` / ${won(c.budget)} (${Math.round(r * 100)}%)` : ''} · 전체 {count(c.name)}건</small>
                </span>
                {!other && <button className={`btn sm ${arm === c.name ? 'danger' : ''}`}
                  onClick={() => { if (arm === c.name) { snap(); update(x => delCat(x, c.name)); setArm(null); setMsg({ t: `"${c.name}" 을 지우고 지출 ${count(c.name)}건을 기타로 옮겼습니다.` }); } else { setArm(c.name); setTimeout(() => setArm(a => (a === c.name ? null : a)), 3000); } }}>
                  {arm === c.name ? '정말 삭제?' : '삭제'}</button>}
              </div>
              <div className="fc-kw">
                <span className="fc-kl">포함 범위</span>
                {other ? <span className="muted">다른 카테고리의 포함 범위에 맞지 않는 지출이 들어갑니다.</span> : <>
                  {(c.keywords || []).map(k => (
                    <span key={k} className="fc-chip">{k}<button onClick={() => update(x => setCat(x, c.name, { keywords: c.keywords.filter(w => w !== k) }))} aria-label={`${k} 빼기`}>×</button></span>))}
                  {!(c.keywords || []).length && <span className="muted">없음 (직접 고른 지출만 들어감)</span>}
                  <span className="fc-add">
                    <input value={kw[c.name] || ''} onChange={e => setKw({ ...kw, [c.name]: e.target.value })} placeholder="예: 스타벅스, 편의점"
                      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addKw(c); } }} aria-label={`${c.name} 포함 범위 추가`} />
                    <button className="btn sm" onClick={() => addKw(c)} disabled={!(kw[c.name] || '').trim()}>추가</button>
                  </span>
                </>}
              </div>
            </li>
          );
        })}</ul>

        <h3 className="lv-h3">카테고리 추가</h3>
        <form className="fc-new" onSubmit={add}>
          <input value={nf.name} onChange={e => setNf({ ...nf, name: e.target.value })} placeholder="이름 (예: 구독료)" aria-label="새 카테고리 이름" />
          <label className="fc-budget">월 예산<MoneyInput value={nf.budget} onChange={v => setNf({ ...nf, budget: v })} placeholder="없음" aria-label="새 카테고리 월 예산" />원</label>
          <button className="btn primary" disabled={!nf.name.trim()}>추가</button>
          <button type="button" className="btn grow-r" onClick={() => { snap(); update(x => { const keep = new Set(defaultCats().map(c => c.name)); let g = x; catsOf(x).filter(c => !keep.has(c.name)).forEach(c => { g = delCat(g, c.name); }); return { ...g, cats: defaultCats() }; }); setMsg({ t: '기본 카테고리로 되돌렸습니다. 추가했던 카테고리의 지출은 기타로 옮겼습니다.' }); }}>기본값으로</button>
        </form>
        <p className="note">순서가 위인 카테고리의 포함 범위가 먼저 적용됩니다. 예를 들어 "이마트24" 는 식비, "이마트" 는 생활용품처럼 겹칠 때는 더 구체적인 말을 가진 카테고리를 위에 두세요.</p>
      </section>
    </div>
  );
}
