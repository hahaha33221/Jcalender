import React, { useRef, useState } from 'react';
import { readTable } from '../cardImport.js';
import { mergeBank, parseBankRows, parseWords } from '../bankImport.js';
import { won } from './finance.js';

/* 수입관리 › 월급통장 거래내역 가져오기
   finance.bank        = { name(은행), alias(통장 이름), last4(계좌 끝 4자리), words(급여 표시 단어, 쉼표), only('salary' | 'all') }
   finance.bankImports = [{ id, at, file, added, sum }]   최신이 앞 (반영 취소는 importId 로 한꺼번에) */
const uid = () => Math.random().toString(36).slice(2, 10);
const stamp = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const BANKS = ['KB국민은행', '신한은행', '우리은행', '하나은행', 'NH농협은행', 'IBK기업은행', '카카오뱅크', '토스뱅크', '케이뱅크', 'SC제일은행', '우체국', '새마을금고', '기타'];

export default function BankImport({ f, update, onMonth }) {
  const B = { name: '', alias: '월급통장', last4: '', words: '', only: 'all', ...(f.bank || {}) };
  const setB = p => update(x => ({ ...x, bank: { ...B, ...(x.bank || {}), ...p } }));
  const ref = useRef(null);
  const [drag, setDrag] = useState(false);
  const [pending, setPending] = useState(null);           // { id, files, add, dup, withdraws, others }
  const [msg, setMsg] = useState(null);
  const label = [B.name, B.alias, B.last4 && `(${B.last4})`].filter(Boolean).join(' ') || '월급통장';
  const ready = !!B.name;

  const upload = async list => {
    if (!ready) { setMsg({ err: true, t: '먼저 은행을 고르세요' }); return; }
    const id = pending?.id || uid(), errors = [];
    let add = pending ? [...pending.add] : [], files = pending ? [...pending.files] : [], dup = pending?.dup || 0, withdraws = pending?.withdraws || 0, others = pending?.others || 0;
    for (const file of [...(list || [])]) {
      try {
        const rows = await readTable(file);
        const p = parseBankRows(rows, { bank: label, salaryWords: parseWords(B.words), onlySalary: B.only === 'salary' });
        const known = [...(f.incomes || []), ...add];
        const r = mergeBank(known, p.items, uid, id, label);
        add = [...add, ...r.add]; dup += r.dup; withdraws += p.withdraws; others += p.others;
        files.push({ name: file.name, count: r.add.length, sum: r.add.reduce((a, x) => a + x.amount, 0) });
      } catch (e) { errors.push(`${file.name}: 읽지 못했습니다 (${e.message})`); }
    }
    if (ref.current) ref.current.value = '';
    setMsg(errors.length ? { err: true, t: errors.join(' / ') } : null);
    if (files.length) setPending({ id, files, add, dup, withdraws, others });
  };
  const commit = () => {
    const P = pending;
    const rec = { id: P.id, at: stamp(new Date()), file: P.files.map(x => x.name).join(', '), added: P.add.length, sum: P.add.reduce((a, x) => a + x.amount, 0) };
    update(x => {
      const have = new Set((x.incomes || []).map(e => e.bankKey).filter(Boolean));
      return { ...x, incomes: [...(x.incomes || []), ...P.add.filter(e => !have.has(e.bankKey))], bankImports: [rec, ...(x.bankImports || [])].slice(0, 30) };
    });
    const last = P.add.map(e => e.date.slice(0, 7)).sort().pop();
    if (last) onMonth(last);
    setMsg({ t: `반영 완료: 입금 ${rec.added}건 · ${won(rec.sum)}` });
    setPending(null);
  };
  const undo = r => {
    update(x => ({ ...x, incomes: (x.incomes || []).filter(e => e.importId !== r.id), bankImports: (x.bankImports || []).filter(k => k.id !== r.id) }));
    setMsg({ t: `${r.at} 반영을 취소했습니다 (${r.added}건)` });
  };
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
  const dropProps = {
    onDragOver: e => { if (!hasFiles(e)) return; e.preventDefault(); setDrag(true); },
    onDragLeave: () => setDrag(false),
    onDrop: e => { if (!hasFiles(e)) return; e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); },
  };
  const P = pending, hist = f.bankImports || [];
  return (
    <section className="panel bi" {...dropProps}>
      <div className="hv-ch"><h2>월급통장 거래내역 가져오기</h2><span className="muted">은행 앱 · 홈페이지에서 받은 거래내역 엑셀 파일의 입금을 수입으로 넣습니다</span></div>
      <div className="bi-form">
        <label>은행<select value={B.name} onChange={e => setB({ name: e.target.value })}><option value="">선택</option>{BANKS.map(b => <option key={b}>{b}</option>)}</select></label>
        <label>통장 이름<input value={B.alias} onChange={e => setB({ alias: e.target.value })} placeholder="월급통장" /></label>
        <label>계좌 끝 4자리 (선택)<input value={B.last4} onChange={e => setB({ last4: e.target.value.replace(/\D/g, '').slice(0, 4) })} inputMode="numeric" placeholder="1234" /></label>
        <label className="wide">급여 입금 표시 (쉼표로 여러 개)<input value={B.words} onChange={e => setB({ words: e.target.value })} placeholder="예: 회사 이름, 급여, 월급" /></label>
        <label>가져올 입금<select value={B.only} onChange={e => setB({ only: e.target.value })}><option value="all">모든 입금</option><option value="salary">급여 · 상여만</option></select></label>
      </div>
      <div className="bi-up">
        <label className={`btn ${ready ? 'primary' : ''}`} aria-disabled={!ready}>거래내역 파일 올리기 (.xls · .xlsx · .csv)
          <input ref={ref} type="file" accept=".xls,.xlsx,.csv,.html,.htm" multiple hidden disabled={!ready} onChange={e => upload(e.target.files)} /></label>
        <span className={`fm-drop ${drag ? 'on' : ''}`} role="button" tabIndex={0} onClick={() => ready && ref.current?.click()} onKeyDown={e => { if (ready && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ref.current?.click(); } }}>{ready ? (drag ? '여기에 놓으면 올라갑니다' : '또는 파일을 여기로 끌어다 놓기') : '은행을 먼저 고르세요'}</span>
      </div>
      {msg && <p className={`sh-msg ${msg.err ? 'err' : ''}`} role="status">{msg.t}</p>}
      {P && <div className="bi-pre">
        <p><b>{label}</b> · 새 입금 <b>{P.add.length}건 · {won(P.add.reduce((a, x) => a + x.amount, 0))}</b>
          <span className="muted">{P.dup ? ` · 이미 반영 ${P.dup}건 제외` : ''}{P.withdraws ? ` · 출금 ${P.withdraws}건 제외` : ''}{P.others ? ` · 급여 아닌 입금 ${P.others}건 제외` : ''}</span></p>
        {P.add.length > 0 && <div className="tablewrap"><table className="prog fv-table"><thead><tr><th>날짜</th><th>분류</th><th>내용 (입금처)</th><th>금액</th></tr></thead>
          <tbody>{[...P.add].sort((a, b) => `${b.date}${b.time || ''}`.localeCompare(`${a.date}${a.time || ''}`)).map(e => (
            <tr key={e.id}><td className="nw">{e.date.slice(2).replace(/-/g, '/')}{e.time ? ` ${e.time}` : ''}</td>
              <td><select className="fv-cat" value={e.cat} onChange={ev => setPending(p => ({ ...p, add: p.add.map(k => (k.id === e.id ? { ...k, cat: ev.target.value } : k)) }))} aria-label="분류">
                {['급여', '상여', '부수입', '이자·배당', '용돈·지원', '환급', '기타'].map(c => <option key={c}>{c}</option>)}</select></td>
              <td>{e.source}</td><td className="num">{won(e.amount)}</td></tr>))}</tbody></table></div>}
        <div className="fm-pre-f">
          <button className="btn" onClick={() => { setPending(null); setMsg({ t: '미리보기를 취소했습니다. 저장된 것은 없습니다.' }); }}>취소</button>
          <button className="btn primary" disabled={!P.add.length} onClick={commit}>반영 완료</button></div>
      </div>}
      {hist.length > 0 && <details className="bi-hist"><summary>반영 기록 {hist.length}건</summary>
        <ul>{hist.map(r => <li key={r.id}><span>{r.at}</span><span className="grow muted">{r.file}</span><b>{r.added}건 · {won(r.sum)}</b><button className="tl-del" onClick={() => undo(r)}>반영 취소</button></li>)}</ul></details>}
      <p className="note">은행 앱 › 거래내역 조회 › 기간을 고르고 "엑셀 저장(파일 내려받기)"으로 받은 파일을 올리세요. 같은 파일을 다시 올려도 이미 넣은 입금은 건너뜁니다. 분류는 미리보기에서 바꿀 수 있습니다. 계좌 번호 전체나 비밀번호는 넣지 않습니다.</p>
    </section>
  );
}
