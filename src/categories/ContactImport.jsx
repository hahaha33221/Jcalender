import React, { useMemo, useState } from 'react';
import { planImport, readContactBook, suggestCompany } from '../contactImport.js';
import { groupsOf } from './CardScan.jsx';
import { useCtx } from '../shared.jsx';
import { AREA_KEYS } from './RelationView.jsx';

/* 인맥 관리 › 엑셀로 연락처 가져오기
   1) 파일 고르기(끌어 놓기 가능) → 2) 시트 고르기 · 회사 기본값 · 관계 → 3) 미리보기 → 4) 가져오기 (되돌리기 가능)
   가져온 사람: { ...연락처, group, dept, phone2, tel, fax, email2, note, check(번호 확인 필요), src(시트), importId }
   마지막 가져오기 기록: store.peopleImport = { id, at, file, added: [id], patched: [이전 값] } */
const uid = () => Math.random().toString(36).slice(2, 10);
const isSample = p => p.name.includes('(예시)');

export default function ContactImport({ people, setStore, now, onClose }) {
  const { store } = useCtx();
  const [file, setFile] = useState(null);
  const [sheets, setSheets] = useState(null);
  const [pick, setPick] = useState({});
  const [company, setCompany] = useState({});
  const [group, setGroup] = useState('업무');
  const [areas, setAreas] = useState(['W']);
  const [dropSample, setDropSample] = useState(true);
  const [err, setErr] = useState('');
  const [over, setOver] = useState(false);
  const [done, setDone] = useState(null);

  const load = async f => {
    if (!f) return;
    setErr(''); setDone(null);
    try {
      const ss = await readContactBook(f);
      setFile(f.name); setSheets(ss);
      setPick(Object.fromEntries(ss.map(s => [s.name, s.people.length > 0])));
      setCompany(Object.fromEntries(ss.map(s => [s.name, suggestCompany(s, ss.filter(o => o !== s))])));
    } catch (e) { setErr(e.message || '파일을 읽지 못했습니다'); setSheets(null); }
  };

  const samples = people.filter(isSample);
  const base = dropSample ? people.filter(p => !isSample(p)) : people;
  const chosen = (sheets || []).filter(s => pick[s.name]);
  const plan = useMemo(() => planImport(chosen, base, { company, group }), [sheets, pick, company, group, dropSample, people]);
  const needCheck = plan.add.filter(p => p.check).length;

  const run = () => {
    const id = uid(), at = new Date(now).toISOString().slice(0, 16).replace('T', ' ');
    const added = plan.add.map(p => ({ ...p, areas, id: uid(), importId: id }));
    const patch = new Map(plan.patch.map(x => [x.id, x.after]));
    setStore(s => {
      const cur = s.people || people;
      const kept = dropSample ? cur.filter(p => !isSample(p)) : cur;
      return {
        ...s,
        people: [...kept.map(p => patch.get(p.id) || p), ...added],
        peopleImport: { id, at, file, added: added.map(p => p.id), patched: plan.patch.map(x => x.before), removedSamples: dropSample ? cur.filter(isSample) : [] },
      };
    });
    setDone({ add: added.length, patch: plan.patch.length });
    setSheets(null);
  };

  return (
    <section className="panel ci" aria-label="엑셀로 연락처 가져오기">
      <div className="csum-h"><h2>엑셀로 연락처 가져오기</h2><span className="muted">.xlsx · 여러 시트 · 병합된 칸도 읽음</span>
        <span className="grow" /><button className="btn sm" onClick={onClose}>닫기</button></div>

      {done && <p className="ci-done" role="status">{done.add}명을 추가했고 {done.patch}명의 빈 칸을 채웠습니다. 위 연락처 목록에서 확인하세요.</p>}

      {!sheets && (
        <label className={`ci-drop ${over ? 'over' : ''}`} onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); load(e.dataTransfer.files[0]); }}>
          <b>엑셀 파일을 끌어 놓거나 눌러서 고르세요</b>
          <span className="muted">머리글에 "이름"이 있는 표를 찾아 기관/회사 · 소속 · 직책 · 휴대폰 · 전화 · 팩스 · 이메일 · 비고를 읽습니다. 파일은 이 브라우저 안에서만 읽고 어디에도 올리지 않습니다.</span>
          <input type="file" accept=".xlsx" hidden onChange={e => { load(e.target.files[0]); e.target.value = ''; }} />
        </label>
      )}
      {err && <p className="od-err" role="alert">{err}</p>}

      {sheets && <>
        <p className="ci-file"><b>{file}</b> <button className="btn sm" onClick={() => setSheets(null)}>다른 파일</button></p>
        <table className="fv-table ci-sheets">
          <thead><tr><th>가져오기</th><th>시트</th><th>연락처</th><th>번호 확인 필요</th><th>회사 기본값 (회사 칸이 없는 시트)</th></tr></thead>
          <tbody>{sheets.map(s => (
            <tr key={s.name} className={s.people.length ? '' : 'ci-off'}>
              <td className="c"><input type="checkbox" checked={!!pick[s.name]} disabled={!s.people.length} onChange={e => setPick({ ...pick, [s.name]: e.target.checked })} aria-label={`${s.name} 가져오기`} /></td>
              <td>{s.name}</td>
              <td className="num">{s.people.length ? `${s.people.length}명` : '연락처 표 없음'}</td>
              <td className="num">{s.people.filter(p => p.check).length || '-'}</td>
              <td>{s.people.length > 0 && !s.people.some(p => p.company)
                ? <input value={company[s.name] || ''} onChange={e => setCompany({ ...company, [s.name]: e.target.value })} aria-label={`${s.name} 회사 기본값`} />
                : <span className="muted">파일의 기관/회사 칸 사용</span>}</td>
            </tr>))}</tbody>
        </table>

        <div className="ci-opts">
          <span className="rv-achk" role="group" aria-label="영역"><b>영역</b>{AREA_KEYS.map(([k, n]) => <label key={k}><input type="checkbox" checked={areas.includes(k)}
            onChange={e => setAreas(AREA_KEYS.map(([x]) => x).filter(x => (x === k ? e.target.checked : areas.includes(x))))} />{n}</label>)}</span>
          <label>관계<select value={group} onChange={e => setGroup(e.target.value)}>{groupsOf(store).map(g => <option key={g}>{g}</option>)}</select></label>
          {samples.length > 0 && <label className="ci-chk"><input type="checkbox" checked={dropSample} onChange={e => setDropSample(e.target.checked)} />예시 연락처 {samples.length}명 지우기</label>}
        </div>

        <div className="hv-stats ci-sum">
          <div className="hv-stat ex"><span className="muted">새로 추가</span><b>{plan.add.length}명</b><span className="hv-sub">번호 확인 필요 {needCheck}명</span></div>
          <div className="hv-stat sl"><span className="muted">기존 연락처 보완</span><b>{plan.patch.length}명</b><span className="hv-sub">빈 칸만 채움 · 기존 값 유지</span></div>
          <div className="hv-stat sl"><span className="muted">파일 안 중복 합침</span><b>{plan.merged}건</b><span className="hv-sub">휴대폰 · 이메일 · 이름+회사로 비교</span></div>
          <div className="hv-stat sl"><span className="muted">이미 있음</span><b>{plan.same}명</b><span className="hv-sub">바뀔 내용 없음</span></div>
        </div>

        {plan.add.length > 0 && <>
          <h3 className="lv-h3">미리보기 <span className="muted">새로 추가될 {plan.add.length}명{plan.add.length > 30 ? ' 중 앞 30명' : ''}</span></h3>
          <div className="od-tablewrap"><table className="fv-table ci-prev">
            <thead><tr><th>No.</th><th>이름</th><th>회사</th><th>소속</th><th>직책</th><th>휴대폰</th><th>전화</th><th>이메일</th><th>시트</th></tr></thead>
            <tbody>{plan.add.slice(0, 30).map((p, i) => (
              <tr key={i} className={p.check ? 'ci-warn' : ''}><td className="c">{i + 1}</td><td><b>{p.name}</b>{p.check && <span className="ci-flag" title={p.note}>확인</span>}</td>
                <td>{p.company}</td><td>{p.dept}</td><td>{p.title}</td><td className="nw">{p.phone || '-'}</td><td className="nw">{p.tel || '-'}</td><td>{p.email}</td><td className="muted">{p.src}</td></tr>))}</tbody>
          </table></div>
        </>}

        <div className="ci-foot">
          <span className="note">같은 사람은 먼저 나온 시트의 값을 쓰고 빈 칸만 뒤 시트로 채웁니다. 가져온 뒤에도 "되돌리기"로 취소할 수 있습니다.</span>
          <button className="btn primary" onClick={run} disabled={!plan.add.length && !plan.patch.length}>가져오기 ({plan.add.length}명 추가 · {plan.patch.length}명 보완)</button>
        </div>
      </>}
    </section>
  );
}

/** 마지막 가져오기 되돌리기 */
export function undoImport(s) {
  const r = s.peopleImport;
  if (!r) return s;
  const added = new Set(r.added), before = new Map((r.patched || []).map(p => [p.id, p]));
  const people = (s.people || []).filter(p => !added.has(p.id)).map(p => before.get(p.id) || p);
  return { ...s, people: [...(r.removedSamples || []), ...people], peopleImport: null };
}
