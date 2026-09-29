import React, { useRef, useState } from 'react';
import { AREAS, iso } from '../data.js';
import { ANNIV_HEAD, ANNIV_KINDS, mergeAnniv, nextAnniv, parseAnnivRows, replaceAnniv } from '../anniv.js';
import { WEEK, areaVar, useCtx } from '../shared.jsx';
import { download, excelDate, readXlsx, writeXlsx } from '../xlsx.js';
import { parseCsv } from './samsungHealth.js';

/* 개인 › 기념일 관리 전용 화면: 다가오는 기념일, 월별 달력형 목록, 기념일 편집 */
const uid = () => Math.random().toString(36).slice(2, 10);
const fmtMD = d => `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`;

export default function AnnivView({ area, cat, group }) {
  const { store, now, isDone } = useCtx();
  const all = store.anniv.map(a => ({ a, n: nextAnniv(a, now) })).filter(x => x.n).sort((x, y) => x.n.dday - y.n.dday);
  const soon = all.filter(x => x.n.dday <= store.annivDays);
  // 앞으로 12개월을 월별로 묶는다
  const months = Array.from({ length: 12 }, (_, i) => new Date(now.getFullYear(), now.getMonth() + i, 1));
  const byMonth = months.map(m => ({ m, list: all.filter(x => x.n.date.getFullYear() === m.getFullYear() && x.n.date.getMonth() === m.getMonth()) }));
  const items = group.items.map(it => ({ it, rows: group.rows.filter(r => r.item === it) }));

  return (
    <div className="catv" style={{ '--ac': areaVar(area) }}>
      <header className="page-h">
        <h1 className="area-title">{cat}</h1>
        <p>{AREAS[area].n} · 생일과 기념일 {store.anniv.length}건 · 대시보드에는 D-{store.annivDays}일 이내 기념일이 보입니다.</p>
      </header>

      <section className="panel anniv">
        <div className="csum-h"><h2>다가오는 기념일</h2><span className="muted">D-{store.annivDays}일 이내 · {soon.length}건</span></div>
        {soon.length ? (
          <div className="anniv-list">{soon.map(({ a, n }) => (
            <div key={a.id} className={`anniv-card ${n.dday === 0 ? 'hot' : n.dday <= 3 ? 'soon' : ''}`}>
              <b className="anniv-d">{n.dday === 0 ? '오늘' : `D-${n.dday}`}</b>
              <span className="anniv-n">{a.name}</span>
              <span className="anniv-m">{a.kind} · {fmtMD(n.date)}{a.kind === '기념일' && n.years > 0 ? ` · ${n.years}주년` : ''}{a.person ? ` · ${a.person}` : ''}</span>
            </div>))}</div>
        ) : <p className="muted anniv-empty">{store.annivDays}일 이내에 다가오는 기념일이 없습니다.</p>}
      </section>

      <section className="panel">
        <h2>앞으로 12개월</h2>
        <div className="anniv-months">{byMonth.map(({ m, list }) => (
          <div key={m.getMonth()} className={`anniv-month ${list.length ? '' : 'none'}`}>
            <b>{m.getFullYear() !== now.getFullYear() ? `${m.getFullYear()}년 ` : ''}{m.getMonth() + 1}월</b>
            {list.length ? list.map(({ a, n }) => (
              <span key={a.id}><em>{n.date.getDate()}일</em> {a.name}<small>{a.person ? ` · ${a.person}` : ''} · D-{n.dday}</small></span>
            )) : <span className="muted">없음</span>}
          </div>))}</div>
      </section>

      <AnnivExcel />

      <AnnivManager />

    </div>
  );
}

/* 엑셀 양식 다운로드 · 업로드 */
/** 양식: 설명 · 머리글 · 예시 2줄 · 지금 등록된 기념일 (고쳐서 다시 올리면 전체가 바뀜) */
function templateFile(list = []) {
  const desc = [
    '[이름] 글자\n표시할 이름 (예: 어머니 생신)\n"(예시)"로 끝나면 올리지 않음',
    '[관련 인물] 글자 (자유 입력)\n누구와 관련된 날인지 (예: 어머니)\n여러 명은 쉼표로 (예: 아내, 딸)',
    '[날짜] YYYY-MM-DD\n처음 날짜 (예: 1990-09-30)\n1990.9.30, 1990/9/30도 가능',
    '[종류] 생일 또는 기념일\n비우면 생일\n기념일은 처음 연도로 주년 계산',
    '[매년 반복] O 또는 X\nO = 매년 반복, X = 한 번만\n비우면 O',
  ];
  return writeXlsx([{
    name: '기념일', cols: [30, 30, 30, 30, 26], grid: false, header: 1, blank: 30,
    rowStyle: { 0: 2 }, heights: { 0: 54, 1: 22 },
    rows: [desc, ANNIV_HEAD, ['홍길동 생일 (예시)', '홍길동 (대학 동기)', '1990-09-30', '생일', 'O'], ['결혼기념일 (예시)', '배우자', '2016-10-07', '기념일', 'O'],
      ...list.filter(a => !/\(예시\)$/.test(a.name)).sort((a, b) => a.date.slice(5).localeCompare(b.date.slice(5))).map(a => [a.name, a.person || '', a.date, a.kind, a.yearly ? 'O' : 'X'])],
  }]);
}

function AnnivExcel() {
  const { store, setStore } = useCtx();
  const ref = useRef(null);
  const [msg, setMsg] = useState(null);
  const [mode, setMode] = useState('replace');           // replace 전체 바꾸기 | merge 추가·수정만
  const [undo, setUndo] = useState(null);                // 올리기 전 목록 (되돌리기용)
  const skipTxt = sk => (sk.length ? ` · 건너뜀 ${sk.length}건 (${sk.map(x => `${x.row}행 ${x.why}`).join(', ')})` : '');
  const upload = async file => {
    if (!file) return;
    try {
      const rows = /\.csv$/i.test(file.name) ? parseCsv((await file.text()).replace(/^\uFEFF/, '')) : readXlsx(new Uint8Array(await file.arrayBuffer()));
      const { items, skipped } = parseAnnivRows(rows, excelDate);
      if (!items.length) throw new Error(skipped.length ? `올릴 수 있는 줄이 없습니다 (${skipped.map(x => `${x.row}행 ${x.why}`).join(', ')})` : '기념일이 없습니다. 양식의 "이름" 머리글 아래에 입력해 주세요');
      const before = store.anniv;
      if (mode === 'replace') {
        const res = replaceAnniv(before, items, uid);
        if (res.removed && !window.confirm(`엑셀의 ${res.list.length}건으로 기념일 목록 전체를 바꿉니다.\n엑셀에 없는 기존 기념일 ${res.removed}건은 삭제됩니다.${skipped.length ? `\n(오류 ${skipped.length}줄은 건너뜀)` : ''}\n\n진행할까요?`)) { setMsg({ t: '올리기를 취소했습니다.' }); return; }
        setStore(s => ({ ...s, anniv: res.list }));
        setMsg({ t: `${file.name}: 전체 바꾸기 완료 · 총 ${res.list.length}건 (새로 ${res.added}, 수정 ${res.updated}, 삭제 ${res.removed})${skipTxt(skipped)}` });
      } else {
        const res = mergeAnniv(before, items, uid);
        setStore(s => ({ ...s, anniv: res.list }));
        setMsg({ t: `${file.name}: 추가 ${res.added}건${res.updated ? `, 수정 ${res.updated}건` : ''}${res.removedExamples ? `, 예시 ${res.removedExamples}건 삭제` : ''}${skipTxt(skipped)}` });
      }
      setUndo(before);
    } catch (e) {
      setMsg({ err: true, t: `파일을 읽지 못했습니다: ${e.message}` });
    } finally {
      if (ref.current) ref.current.value = '';            // 같은 파일을 다시 골라도 올라가도록
    }
  };
  return (
    <section className="panel">
      <div className="csum-h"><h2>엑셀로 올리기</h2><span className="muted">양식을 내려받아 고친 뒤 업로드합니다 (.xlsx, .csv)</span></div>
      <div className="an-x">
        <div className="chips" role="radiogroup" aria-label="올리기 방식">
          <button role="radio" aria-checked={mode === 'replace'} aria-pressed={mode === 'replace'} onClick={() => setMode('replace')}>전체 바꾸기</button>
          <button role="radio" aria-checked={mode === 'merge'} aria-pressed={mode === 'merge'} onClick={() => setMode('merge')}>추가·수정만</button>
        </div>
        <div className="btns">
          <button className="btn" onClick={() => download(templateFile(store.anniv), 'anniversary_template.xlsx')}>양식 다운로드</button>
          <label className="btn primary">엑셀 업로드<input ref={ref} type="file" accept=".xlsx,.csv" hidden onChange={e => upload(e.target.files[0])} /></label>
          {undo && <button className="btn" onClick={() => { setStore(s => ({ ...s, anniv: undo })); setUndo(null); setMsg({ t: '올리기 전 목록으로 되돌렸습니다.' }); }}>되돌리기</button>}
        </div>
      </div>
      {msg && <p className={`sh-msg ${msg.err ? 'err' : ''}`} role="status">{msg.t}</p>}
      <p className="note">{mode === 'replace'
        ? '전체 바꾸기: 기념일 목록이 엑셀 내용과 똑같아집니다. 엑셀에 없는 기념일은 삭제되고(확인 후), 이름과 날짜가 같은 기념일은 엑셀 값으로 수정됩니다.'
        : '추가·수정만: 엑셀에 있는 기념일만 추가하거나 수정하고, 엑셀에 없는 기념일은 그대로 둡니다. 예시 기념일은 지워집니다.'}
        {' '}양식에는 지금 등록된 기념일이 들어 있으니 고쳐서 그대로 올리면 됩니다. 열: 이름 · 관련 인물 · 날짜 · 종류(생일/기념일) · 매년 반복(O/X).</p>
    </section>
  );
}

/* 기념일 목록 편집 (표시 기간, 수정, 삭제, 추가) */
function AnnivManager() {
  const { store, setStore, now } = useCtx();
  const blank = { name: '', person: '', date: iso(now), kind: '생일', yearly: true };
  const [f, setF] = useState(blank);
  const setDays = v => setStore(s => ({ ...s, annivDays: Math.max(0, Math.min(365, Number(v) || 0)) }));
  const upd = (id, patch) => setStore(s => ({ ...s, anniv: s.anniv.map(a => (a.id === id ? { ...a, ...patch } : a)) }));
  const del = id => setStore(s => ({ ...s, anniv: s.anniv.filter(a => a.id !== id) }));
  const add = e => {
    e.preventDefault();
    if (!f.name.trim() || !f.date) return;
    setStore(s => ({ ...s, anniv: [...s.anniv, { id: uid(), ...f, name: f.name.trim(), person: f.person.trim() }] }));
    setF(blank);
  };
  const sorted = [...store.anniv].sort((x, y) => (nextAnniv(x, now)?.dday ?? 9999) - (nextAnniv(y, now)?.dday ?? 9999));
  return (
    <div className="panel">
      <h2>기념일 목록</h2>
      <label className="anniv-days">대시보드 표시 기간
        <span><b>D-</b><input type="number" min="0" max="365" value={store.annivDays} onChange={e => setDays(e.target.value)} aria-label="며칠 전부터 표시" />일 전부터 표시</span></label>
      <div className="tablewrap">
        <table className="prog anniv-tb">
          <thead><tr><th>이름</th><th>관련 인물</th><th>날짜</th><th>종류</th><th>매년</th><th>다음</th><th /></tr></thead>
          <tbody>{sorted.map(a => {
            const n = nextAnniv(a, now);
            return (
              <tr key={a.id}>
                <td><input value={a.name} onChange={e => upd(a.id, { name: e.target.value })} aria-label="이름" /></td>
                <td><input value={a.person || ''} onChange={e => upd(a.id, { person: e.target.value })} placeholder="관련 인물" aria-label="관련 인물" /></td>
                <td><input type="date" value={a.date} onChange={e => e.target.value && upd(a.id, { date: e.target.value })} aria-label="날짜" /></td>
                <td><select value={a.kind} onChange={e => upd(a.id, { kind: e.target.value })} aria-label="종류">{ANNIV_KINDS.map(k => <option key={k}>{k}</option>)}</select></td>
                <td><input type="checkbox" checked={a.yearly} onChange={e => upd(a.id, { yearly: e.target.checked })} aria-label="매년 반복" /></td>
                <td className="nowrap">{n ? (n.dday === 0 ? '오늘' : `D-${n.dday}`) : '지남'}</td>
                <td><button className="btn sm" onClick={() => del(a.id)}>삭제</button></td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
      <form className="anniv-add" onSubmit={add}>
        <input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="기념일 이름 (예: 아버지 생신)" aria-label="새 기념일 이름" />
        <input value={f.person} onChange={e => setF({ ...f, person: e.target.value })} placeholder="관련 인물 (예: 어머니)" aria-label="새 기념일 관련 인물" className="anniv-person" />
        <input type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} aria-label="새 기념일 날짜" />
        <select value={f.kind} onChange={e => setF({ ...f, kind: e.target.value })} aria-label="새 기념일 종류">{ANNIV_KINDS.map(k => <option key={k}>{k}</option>)}</select>
        <label className="chk"><input type="checkbox" checked={f.yearly} onChange={e => setF({ ...f, yearly: e.target.checked })} />매년</label>
        <button className="btn primary" disabled={!f.name.trim()}>추가</button>
      </form>
      <p className="note">기념일 종류는 처음 날짜의 연도로 몇 주년인지 계산합니다. 매년 반복을 끄면 그 날짜 한 번만 표시됩니다.</p>
    </div>
  );
}

