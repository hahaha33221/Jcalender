import React, { useState } from 'react';
import { AREAS, ROWS, iso } from '../data.js';
import { MoneyInput, areaVar, num, useCtx } from '../shared.jsx';

/* 개인 › 여가 관리 전용 화면: 여행 · 독서 · 취미 활동 기록
   leisure = {
     trips: [{ id, name, start, end, budget, spent }],
     books: [{ id, title, author, pages, read, want?(읽을 책), done?(완독일) }], bookGoal,
     logs:  [{ id, date, kind, minutes, memo }],
   } */
export const HOBBIES = ['기타 연습', '밴드 합주', '그림', '요리', '기타 취미'];
const uid = () => Math.random().toString(36).slice(2, 10);
const dayDiff = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);
const md = s => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
const won = n => `${num(n)}원`;
const act = name => ROWS.find(r => r.a === 'P' && r.action === name);
const ACT = { trip: act('여행 일정 연동'), cost: act('여행 비용 연동'), book: act('독서 기록 연동'), guitar: act('악보 연동'), band: act('합주 연동') };

export function seedLeisure(today = new Date()) {
  const d = n => iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + n));
  const y = today.getFullYear();
  return {
    trips: [
      { id: 't1', name: '제주 3박 4일 (예시)', start: d(17), end: d(20), budget: 800000, spent: 320000 },
      { id: 't2', name: '강릉 1박 2일 (예시)', start: `${y}-04-11`, end: `${y}-04-12`, budget: 300000, spent: 284000 },
    ],
    books: [
      { id: 'b1', title: '아주 작은 습관의 힘 (예시)', author: '제임스 클리어', pages: 360, read: 360, done: `${y}-02-20` },
      { id: 'b2', title: '사피엔스 (예시)', author: '유발 하라리', pages: 636, read: 636, done: `${y}-05-30` },
      { id: 'b3', title: '돈의 심리학 (예시)', author: '모건 하우절', pages: 404, read: 404, done: `${y}-08-14` },
      { id: 'b4', title: '불편한 편의점 (예시)', author: '김호연', pages: 268, read: 142 },
      { id: 'b5', title: '데일 카네기 인간관계론 (예시)', author: '데일 카네기', pages: 332, read: 0, want: true },
    ],
    bookGoal: 12,
    logs: [
      { id: 'l1', date: d(-1), kind: '기타 연습', minutes: 40, memo: '코드 전환 연습' },
      { id: 'l2', date: d(-3), kind: '밴드 합주', minutes: 120, memo: '공연곡 2곡 합주' },
      { id: 'l3', date: d(-6), kind: '기타 연습', minutes: 30, memo: '' },
      { id: 'l4', date: d(-10), kind: '밴드 합주', minutes: 120, memo: '' },
      { id: 'l5', date: d(-13), kind: '그림', minutes: 60, memo: '수채화' },
    ],
  };
}

export default function LeisureView({ area, cat, group }) {
  const { store, setStore, now, isDone, finish } = useCtx();
  const today = iso(now), y = String(now.getFullYear());
  const L = store.leisure || seedLeisure(now);
  const set = fn => setStore(s => ({ ...s, leisure: fn(s.leisure || seedLeisure(now)) }));

  // 여행
  const trips = [...L.trips].sort((a, b) => a.start.localeCompare(b.start));
  const nextTrip = trips.find(t => t.end >= today);
  const [tf, setTf] = useState({ name: '', start: today, end: today, budget: '' });
  const addTrip = e => {
    e.preventDefault();
    if (!tf.name.trim()) return;
    set(x => ({ ...x, trips: [...x.trips, { id: uid(), name: tf.name.trim(), start: tf.start, end: tf.end < tf.start ? tf.start : tf.end, budget: Number(tf.budget) || 0, spent: 0 }] }));
    setTf({ ...tf, name: '', budget: '' });
  };
  const updTrip = (id, patch) => set(x => ({ ...x, trips: x.trips.map(t => (t.id === id ? { ...t, ...patch } : t)) }));

  // 독서
  const doneThisYear = L.books.filter(b => b.done && b.done.slice(0, 4) === y);
  const reading = L.books.filter(b => !b.done && !b.want);
  const wants = L.books.filter(b => b.want);
  const [bf, setBf] = useState({ title: '', author: '', pages: '' });
  const addBook = (e, want) => {
    e?.preventDefault?.();
    if (!bf.title.trim()) return;
    set(x => ({ ...x, books: [...x.books, { id: uid(), title: bf.title.trim(), author: bf.author.trim(), pages: Math.max(1, Number(bf.pages) || 300), read: 0, want: !!want }] }));
    setBf({ title: '', author: '', pages: '' });
  };
  const setRead = (b, v) => {
    const read = Math.max(0, Math.min(b.pages, Number(v) || 0));
    set(x => ({ ...x, books: x.books.map(k => (k.id === b.id ? { ...k, read, want: false, done: read >= k.pages ? (k.done || today) : undefined } : k)) }));
  };
  const startBook = b => set(x => ({ ...x, books: x.books.map(k => (k.id === b.id ? { ...k, want: false } : k)) }));
  const delBook = id => set(x => ({ ...x, books: x.books.filter(k => k.id !== id) }));

  // 취미 기록
  const month = today.slice(0, 7);
  const monthLogs = L.logs.filter(l => l.date.slice(0, 7) === month);
  const monthMin = monthLogs.reduce((a, l) => a + l.minutes, 0);
  const byKind = HOBBIES.map(k => ({ k, v: monthLogs.filter(l => l.kind === k).reduce((a, l) => a + l.minutes, 0) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  const maxKind = Math.max(1, ...byKind.map(x => x.v));
  const [lf, setLf] = useState({ date: today, kind: '기타 연습', minutes: 30, memo: '' });
  const addLog = e => {
    e.preventDefault();
    const minutes = Math.max(1, Number(lf.minutes) || 0);
    set(x => ({ ...x, logs: [{ id: uid(), date: lf.date, kind: lf.kind, minutes, memo: lf.memo.trim() }, ...x.logs] }));
    setLf({ ...lf, memo: '' });
  };
  const hm = m => (m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}` : `${m}분`);
  const items = group.items.map(it => ({ it, rows: group.rows.filter(r => r.item === it) }));

  return (
    <div className="catv lsv" style={{ '--ac': areaVar(area) }}>
      <header className="page-h">
        <h1 className="area-title">{cat}</h1>
        <p>{AREAS[area].n} · 여행 계획과 비용, 올해 읽은 책, 취미 활동 시간을 한 곳에서 관리합니다.</p>
      </header>

      <div className="hv-stats">
        <div className="hv-stat sl"><span className="muted">다음 여행</span>
          <b>{nextTrip ? (nextTrip.start <= today ? '여행 중' : `D-${dayDiff(today, nextTrip.start)}`) : '-'}</b>
          <span className="hv-sub">{nextTrip ? `${nextTrip.name} · ${md(nextTrip.start)}~${md(nextTrip.end)}` : '예정된 여행 없음'}</span></div>
        <div className="hv-stat ex"><span className="muted">{y}년 완독</span><b>{doneThisYear.length} / {L.bookGoal}권</b>
          <span className="pbar"><i style={{ width: `${Math.min(100, doneThisYear.length / L.bookGoal * 100)}%`, background: 'var(--viz-ex)' }} /></span></div>
        <div className="hv-stat sl"><span className="muted">이번 달 취미 시간</span><b>{hm(monthMin)}</b><span className="hv-sub">{monthLogs.length}회 기록</span></div>
      </div>

      <div className="lv-grid">
        {/* 여행 */}
        <section className="panel">
          <div className="csum-h"><h2>여행</h2><span className="muted">{trips.length}건</span></div>
          <ul className="lv-trips">{trips.map(t => {
            const st = t.end < today ? ['다녀옴', 'plan'] : t.start <= today ? ['여행 중', 'run'] : [`D-${dayDiff(today, t.start)}`, 'late'];
            const ratio = t.budget ? t.spent / t.budget : 0;
            return (
              <li key={t.id}>
                <div className="lv-trip-h"><b>{t.name}</b><span className={`st ${st[1]}`}>{st[0]}</span>
                  <button className="tl-del" onClick={() => set(x => ({ ...x, trips: x.trips.filter(k => k.id !== t.id) }))}>삭제</button></div>
                <div className="muted">{md(t.start)} ~ {md(t.end)} · {dayDiff(t.start, t.end)}박 {dayDiff(t.start, t.end) + 1}일</div>
                <div className="lv-cost">
                  <span>예산 {won(t.budget)}</span>
                  <label>사용 <MoneyInput value={t.spent} onChange={v => { updTrip(t.id, { spent: Number(v) || 0 }); }} aria-label={`${t.name} 사용 금액`} />원</label>
                </div>
                <span className="pbar"><i style={{ width: `${Math.min(100, ratio * 100)}%`, background: ratio > 1 ? 'var(--over)' : 'var(--viz-sl)' }} /></span>
              </li>
            );
          })}</ul>
          <form className="lv-form" onSubmit={addTrip}>
            <input value={tf.name} onChange={e => setTf({ ...tf, name: e.target.value })} placeholder="여행 이름 (예: 부산 2박 3일)" aria-label="여행 이름" className="wide" />
            <input type="date" value={tf.start} onChange={e => setTf({ ...tf, start: e.target.value })} aria-label="출발일" />
            <input type="date" value={tf.end} onChange={e => setTf({ ...tf, end: e.target.value })} aria-label="도착일" />
            <MoneyInput value={tf.budget} onChange={v => setTf({ ...tf, budget: v })} placeholder="예산(원)" aria-label="여행 예산" />
            <button className="btn primary" disabled={!tf.name.trim()}>추가</button>
          </form>
        </section>

        {/* 독서 */}
        <section className="panel">
          <div className="csum-h"><h2>독서</h2>
            <span className="muted lv-goal">올해 목표 <input type="number" min="1" max="200" value={L.bookGoal} onChange={e => set(x => ({ ...x, bookGoal: Math.max(1, Number(e.target.value) || 1) }))} aria-label="올해 독서 목표" />권</span></div>
          <h3 className="lv-h3">읽는 중</h3>
          <ul className="lv-books">{reading.map(b => (
            <li key={b.id}>
              <div className="lv-book-h"><b>{b.title}</b><small>{b.author}</small><button className="tl-del" onClick={() => delBook(b.id)}>삭제</button></div>
              <div className="lv-book-p">
                <span className="pbar"><i style={{ width: `${b.read / b.pages * 100}%`, background: 'var(--viz-ex)' }} /></span>
                <label><input type="number" min="0" max={b.pages} value={b.read} onChange={e => setRead(b, e.target.value)} aria-label={`${b.title} 읽은 쪽수`} /> / {num(b.pages)}쪽</label>
              </div>
            </li>))}</ul>
          {!reading.length && <p className="muted">읽는 중인 책이 없습니다.</p>}
          {wants.length > 0 && <>
            <h3 className="lv-h3">읽을 책</h3>
            <ul className="lv-simple">{wants.map(b => <li key={b.id}><span className="grow">{b.title} <small className="muted">{b.author}</small></span><button className="btn sm" onClick={() => startBook(b)}>읽기 시작</button><button className="tl-del" onClick={() => delBook(b.id)}>삭제</button></li>)}</ul>
          </>}
          <h3 className="lv-h3">{y}년 완독 {doneThisYear.length}권</h3>
          <ul className="lv-simple">{[...doneThisYear].sort((a, b) => b.done.localeCompare(a.done)).map(b => <li key={b.id}><time>{md(b.done)}</time><span className="grow">{b.title} <small className="muted">{b.author}</small></span></li>)}</ul>
          <form className="lv-form" onSubmit={e => addBook(e, false)}>
            <input value={bf.title} onChange={e => setBf({ ...bf, title: e.target.value })} placeholder="책 제목" aria-label="책 제목" className="wide" />
            <input value={bf.author} onChange={e => setBf({ ...bf, author: e.target.value })} placeholder="저자" aria-label="저자" />
            <input type="number" min="1" value={bf.pages} onChange={e => setBf({ ...bf, pages: e.target.value })} placeholder="쪽수" aria-label="쪽수" />
            <button className="btn primary" disabled={!bf.title.trim()}>읽기 시작</button>
            <button type="button" className="btn" disabled={!bf.title.trim()} onClick={() => addBook(null, true)}>읽을 책</button>
          </form>
        </section>
      </div>

      {/* 취미 활동 */}
      <section className="panel">
        <div className="csum-h"><h2>취미 활동 기록</h2><span className="muted">이번 달 {hm(monthMin)}</span></div>
        <div className="lv-hobby">
          <div>
            <form className="lv-form" onSubmit={addLog}>
              <input type="date" value={lf.date} max={today} onChange={e => setLf({ ...lf, date: e.target.value })} aria-label="날짜" />
              <select value={lf.kind} onChange={e => setLf({ ...lf, kind: e.target.value })} aria-label="활동">{HOBBIES.map(h => <option key={h}>{h}</option>)}</select>
              <label className="lv-min"><input type="number" min="1" value={lf.minutes} onChange={e => setLf({ ...lf, minutes: e.target.value })} aria-label="시간(분)" />분</label>
              <input value={lf.memo} onChange={e => setLf({ ...lf, memo: e.target.value })} placeholder="메모 (예: 공연곡 연습)" aria-label="메모" className="wide" />
              <button className="btn primary">기록</button>
            </form>
            <ul className="lv-simple">{[...L.logs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8).map(l => (
              <li key={l.id}><time>{md(l.date)}</time><span className="tag">{l.kind}</span><span className="grow">{hm(l.minutes)}{l.memo ? ` · ${l.memo}` : ''}</span>
                <button className="tl-del" onClick={() => set(x => ({ ...x, logs: x.logs.filter(k => k.id !== l.id) }))}>삭제</button></li>))}</ul>
          </div>
          <div>
            <h3 className="lv-h3">이번 달 활동별 시간</h3>
            {byKind.length ? (
              <ul className="fv-bars">{byKind.map(x => (
                <li key={x.k}><span className="fv-bl">{x.k}</span><span className="fv-track"><i style={{ width: `${x.v / maxKind * 100}%` }} /></span><span className="fv-bv">{hm(x.v)}</span></li>))}</ul>
            ) : <p className="muted">이번 달 기록이 없습니다.</p>}
          </div>
        </div>
      </section>

    </div>
  );
}
