import React, { useState } from 'react';
import { iso } from '../data.js';
import { areaVar, num, useCtx } from '../shared.jsx';
import ToolView from './ToolView.jsx';
import ShortsStudio from './ShortsStudio.jsx';
import { TOOL_CONFIGS } from './toolConfigs.js';

/* 사업 › 콘텐츠 관리: 콘텐츠(아이디어 → 발행 보드) · 채널 계정 · 성과
   - 콘텐츠: store.tools['B|콘텐츠 관리'] (ToolView). 계정 칸을 더해 어느 계정에 올릴지 고른다
   - 채널 계정: store.content.accounts = [{ id, channel, name(@계정), url, purpose, status, login(로그인 아이디 · 이메일), goal(목표 팔로워), weekly(주 발행 목표), memo,
                                           followers: [{ date, n }] (팔로워 기록) }]  ※ 비밀번호는 저장하지 않는다
   - 성과: store.content.perf = { 콘텐츠 id: { views, likes, comments, shares, saves, follows, clicks, at(측정일) } }
           참여율 = (좋아요 + 댓글 + 공유 + 저장) ÷ 조회수 */
const KEY = 'B|콘텐츠 관리';
const CHANNELS = ['인스타그램', '유튜브', '블로그', '틱톡', '스레드', 'X(트위터)', '페이스북', '뉴스레터', '브런치', '기타'];
const PURPOSE = ['브랜드', '개인', '서브', '광고'];
const STATUS = ['운영 중', '준비 중', '쉬는 중', '종료'];
const METRICS = [['views', '조회'], ['likes', '좋아요'], ['comments', '댓글'], ['shares', '공유'], ['saves', '저장'], ['follows', '팔로워 유입'], ['clicks', '링크 클릭']];
const uid = () => Math.random().toString(36).slice(2, 10);
const ymL = k => `${k.slice(0, 4)}년 ${Number(k.slice(5, 7))}월`;
const addMonths = (ym, n) => { const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const daysAgo = (today, n) => { const d = new Date(`${today}T00:00:00`); d.setDate(d.getDate() - n); return iso(d); };
const pct = (a, b) => (b ? `${(a / b * 100).toFixed(1)}%` : '-');
const eng = p => (p ? (Number(p.likes) || 0) + (Number(p.comments) || 0) + (Number(p.shares) || 0) + (Number(p.saves) || 0) : 0);
const label = a => `${a.channel} ${a.name}`;
/** 계정의 팔로워: 마지막 기록 · 기준일 이전의 마지막 기록 */
const lastF = a => [...(a.followers || [])].sort((x, y) => x.date.localeCompare(y.date)).pop();
const fAt = (a, day) => [...(a.followers || [])].filter(f => f.date <= day).sort((x, y) => x.date.localeCompare(y.date)).pop();

export function useContent() {
  const { store, setStore } = useCtx();
  const C = store.content || {};
  const set = fn => setStore(s => ({ ...s, content: fn(s.content || {}) }));
  return [{ accounts: C.accounts || [], perf: C.perf || {}, tab: C.tab || 'board' }, set];
}

export default function ContentView(props) {
  const { store, now, isAdmin } = useCtx();
  const [S, set] = useContent();
  const today = iso(now);
  const base = TOOL_CONFIGS[KEY];
  const rows = store.tools?.[KEY] || base.seed(now);
  // 콘텐츠 입력 칸: 채널 목록에 내 계정의 채널을 더하고, 계정 칸을 추가
  const accNames = S.accounts.filter(a => a.status !== '종료').map(label);
  const config = {
    ...base,
    fields: [
      ...base.fields.map(f => (f.k === 'channel' ? { ...f, options: [...new Set([...f.options, ...S.accounts.map(a => a.channel)])] } : f)),
      { k: 'account', label: '계정', type: 'select', options: ['-', ...accNames] },
    ],
    card: ['account', 'channel', 'date'],
  };
  const setTab = tab => set(c => ({ ...c, tab }));
  const TABS = [['board', '콘텐츠'], ['accounts', '채널 계정'], ['perf', '성과'], ...(isAdmin ? [['shorts', '숏폼 제작']] : [])];   // 숏폼 제작: 관리자만
  return (
    <div className="catv tv ct" style={{ '--ac': areaVar(props.area) }}>
      <header className="page-h"><h1 className="area-title">{props.cat}</h1></header>
      <div className="fv-tabs ct-tabs" role="tablist" aria-label="콘텐츠 관리 보기">
        {TABS.map(([k, n]) => <button key={k} role="tab" aria-selected={S.tab === k} className={S.tab === k ? 'on' : ''} onClick={() => setTab(k)}>{n}</button>)}
      </div>
      {S.tab === 'accounts' ? <Accounts S={S} set={set} rows={rows} today={today} />
        : S.tab === 'perf' ? <Perf S={S} set={set} rows={rows} today={today} />
        : S.tab === 'shorts' && isAdmin ? <ShortsStudio />
          : <ToolView {...props} config={config} noHeader />}
    </div>
  );
}

/* ── 채널 계정 ── */
function Accounts({ S, set, rows, today }) {
  const blank = { channel: '인스타그램', name: '', url: '', purpose: '브랜드', status: '운영 중', login: '', goal: '', weekly: '', followers: '' };
  const [form, setForm] = useState(blank);
  const [arm, setArm] = useState(null);
  const [fin, setFin] = useState({});                          // 팔로워 기록 입력칸
  const accs = S.accounts;
  const setAccs = fn => set(c => ({ ...c, accounts: fn(c.accounts || []) }));
  const add = e => {
    e.preventDefault();
    if (!form.name.trim()) return;
    const f = Number(form.followers);
    setAccs(l => [...l, { id: uid(), ...form, name: form.name.trim(), goal: Number(form.goal) || 0, weekly: Number(form.weekly) || 0, followers: f >= 0 && form.followers !== '' ? [{ date: today, n: f }] : [] }]);
    setForm({ ...blank, channel: form.channel });
  };
  const patch = (id, p) => setAccs(l => l.map(a => (a.id === id ? { ...a, ...p } : a)));
  const del = id => { if (arm !== id) { setArm(id); setTimeout(() => setArm(x => (x === id ? null : x)), 3000); return; } setAccs(l => l.filter(a => a.id !== id)); setArm(null); };
  const logF = a => {
    const n = Number(fin[a.id]);
    if (fin[a.id] === '' || fin[a.id] == null || !(n >= 0)) return;
    patch(a.id, { followers: [...(a.followers || []).filter(f => f.date !== today), { date: today, n }] });
    setFin(x => ({ ...x, [a.id]: '' }));
  };
  const ym = today.slice(0, 7), d30 = daysAgo(today, 30);
  const postsOf = a => rows.filter(r => r.account === label(a) || (!r.account || r.account === '-') && r.channel === a.channel && accs.filter(x => x.channel === a.channel).length === 1);
  const live = accs.filter(a => a.status === '운영 중');
  const total = live.reduce((s, a) => s + (lastF(a)?.n || 0), 0);
  const grow = live.reduce((s, a) => { const l = lastF(a), o = fAt(a, d30); return s + (l && o && o !== l ? l.n - o.n : 0); }, 0);
  const monthPosts = rows.filter(r => r.stage === '발행' && (r.date || '').startsWith(ym)).length;

  return (
    <>
      <div className="hv-stats">
        <div className="hv-stat sl"><span className="muted">운영 중 계정</span><b>{live.length}개</b><span className="hv-sub">전체 {accs.length}개</span></div>
        <div className="hv-stat sl"><span className="muted">총 팔로워</span><b>{num(total)}</b><span className="hv-sub">운영 중 계정 합계</span></div>
        <div className="hv-stat ex"><span className="muted">30일 팔로워 증감</span><b className={grow < 0 ? 'neg' : ''}>{grow > 0 ? '+' : ''}{num(grow)}</b><span className="hv-sub">30일 전 기록과 비교</span></div>
        <div className="hv-stat ex"><span className="muted">이번 달 발행</span><b>{monthPosts}건</b><span className="hv-sub">콘텐츠 탭의 "발행" 단계</span></div>
      </div>

      <section className="panel">
        <h2>계정 추가</h2>
        <form className="ct-form" onSubmit={add}>
          <label>채널<select value={form.channel} onChange={e => setForm({ ...form, channel: e.target.value })}>{CHANNELS.map(c => <option key={c}>{c}</option>)}</select></label>
          <label>계정 이름<input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="예: @jcal_official" required /></label>
          <label>용도<select value={form.purpose} onChange={e => setForm({ ...form, purpose: e.target.value })}>{PURPOSE.map(c => <option key={c}>{c}</option>)}</select></label>
          <label>상태<select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>{STATUS.map(c => <option key={c}>{c}</option>)}</select></label>
          <label className="w2">주소 (링크)<input value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} placeholder="https://instagram.com/…" /></label>
          <label className="w2">로그인 아이디 · 이메일 (선택)<input value={form.login} onChange={e => setForm({ ...form, login: e.target.value })} placeholder="비밀번호는 적지 마세요" autoComplete="off" /></label>
          <label>현재 팔로워<input type="number" min="0" value={form.followers} onChange={e => setForm({ ...form, followers: e.target.value })} /></label>
          <label>목표 팔로워<input type="number" min="0" value={form.goal} onChange={e => setForm({ ...form, goal: e.target.value })} /></label>
          <label>주 발행 목표<input type="number" min="0" value={form.weekly} onChange={e => setForm({ ...form, weekly: e.target.value })} placeholder="회" /></label>
          <button className="btn primary" disabled={!form.name.trim()}>추가</button>
        </form>
        <p className="note">비밀번호는 여기에 저장하지 마세요. 비밀번호 관리 앱(아이폰 암호, 1Password 등)을 쓰는 것이 안전합니다.</p>
      </section>

      {accs.length ? <div className="ct-accs">{[...accs].sort((a, b) => STATUS.indexOf(a.status) - STATUS.indexOf(b.status)).map(a => {
        const l = lastF(a), o = fAt(a, d30), d = l && o && o !== l ? l.n - o.n : null;
        const posts = postsOf(a), mp = posts.filter(r => r.stage === '발행' && (r.date || '').startsWith(ym)).length;
        const target = a.weekly ? Math.round(a.weekly * 30 / 7) : 0;
        const hist = [...(a.followers || [])].sort((x, y) => x.date.localeCompare(y.date)).slice(-12);
        const hmax = Math.max(1, ...hist.map(h => h.n)), hmin = Math.min(...hist.map(h => h.n));
        return (
          <section key={a.id} className={`panel ct-acc ${a.status !== '운영 중' ? 'off' : ''}`}>
            <div className="ct-acc-h">
              <span className="tag">{a.channel}</span>
              <input className="ct-name" value={a.name} onChange={e => patch(a.id, { name: e.target.value })} aria-label="계정 이름" />
              <select value={a.status} onChange={e => patch(a.id, { status: e.target.value })} aria-label="상태">{STATUS.map(c => <option key={c}>{c}</option>)}</select>
              {a.url && <a className="btn sm" href={/^https?:/.test(a.url) ? a.url : `https://${a.url}`} target="_blank" rel="noreferrer">열기</a>}
            </div>
            <div className="ct-nums">
              <div><span className="muted">팔로워</span><b>{l ? num(l.n) : '-'}</b><small className="muted">{l ? `${Number(l.date.slice(5, 7))}/${Number(l.date.slice(8, 10))} 기록` : '기록 없음'}</small></div>
              <div><span className="muted">30일 증감</span><b className={d < 0 ? 'neg' : d > 0 ? 'pos' : ''}>{d == null ? '-' : `${d > 0 ? '+' : ''}${num(d)}`}</b></div>
              <div><span className="muted">이번 달 발행</span><b>{mp}{target ? <small> / {target}</small> : ''}건</b></div>
            </div>
            {a.goal > 0 && <div className="ct-goal"><span className="muted">목표 {num(a.goal)}명</span><span className="pbar"><i style={{ width: `${Math.min(100, (l?.n || 0) / a.goal * 100)}%` }} /></span><small>{pct(l?.n || 0, a.goal)}</small></div>}
            {hist.length > 1 && <div className="ct-spark" role="img" aria-label="팔로워 변화">{hist.map(h => <i key={h.date} title={`${h.date} ${num(h.n)}명`} style={{ height: `${hmax === hmin ? 60 : 15 + (h.n - hmin) / (hmax - hmin) * 85}%` }} />)}</div>}
            <div className="ct-log">
              <input type="number" min="0" value={fin[a.id] ?? ''} onChange={e => setFin(x => ({ ...x, [a.id]: e.target.value }))} placeholder="오늘 팔로워 수" aria-label={`${a.name} 오늘 팔로워 수`} onKeyDown={e => e.key === 'Enter' && logF(a)} />
              <button className="btn sm" onClick={() => logF(a)}>팔로워 기록</button>
            </div>
            <details className="ct-more"><summary>계정 정보 고치기</summary>
              <div className="ct-form sm">
                <label>채널<select value={a.channel} onChange={e => patch(a.id, { channel: e.target.value })}>{CHANNELS.map(c => <option key={c}>{c}</option>)}</select></label>
                <label>용도<select value={a.purpose} onChange={e => patch(a.id, { purpose: e.target.value })}>{PURPOSE.map(c => <option key={c}>{c}</option>)}</select></label>
                <label>목표 팔로워<input type="number" min="0" value={a.goal || ''} onChange={e => patch(a.id, { goal: Number(e.target.value) || 0 })} /></label>
                <label>주 발행 목표<input type="number" min="0" value={a.weekly || ''} onChange={e => patch(a.id, { weekly: Number(e.target.value) || 0 })} /></label>
                <label className="w2">주소<input value={a.url || ''} onChange={e => patch(a.id, { url: e.target.value })} /></label>
                <label className="w2">로그인 아이디 · 이메일<input value={a.login || ''} onChange={e => patch(a.id, { login: e.target.value })} autoComplete="off" /></label>
                <label className="w4">메모<input value={a.memo || ''} onChange={e => patch(a.id, { memo: e.target.value })} placeholder="운영 방향, 해시태그, 업로드 시간 등" /></label>
              </div>
              {(a.followers || []).length > 0 && <p className="note">팔로워 기록 {a.followers.length}개 · <button className="linkish" onClick={() => patch(a.id, { followers: (a.followers || []).filter(f => f.date !== lastF(a).date) })}>마지막 기록 지우기</button></p>}
              <button className={`tl-del ${arm === a.id ? 'arm' : ''}`} onClick={() => del(a.id)}>{arm === a.id ? '정말 삭제?' : '계정 삭제'}</button>
            </details>
            {a.memo && <p className="note ct-memo">{a.memo}</p>}
          </section>);
      })}</div> : <section className="panel"><p className="muted">아직 등록한 계정이 없습니다. 운영하는 인스타그램 · 유튜브 · 블로그 계정을 추가하면, 콘텐츠를 계정별로 나눠 보고 팔로워 변화를 기록할 수 있습니다.</p></section>}
    </>
  );
}

/* ── 성과 ── */
function Perf({ S, set, rows, today }) {
  const [sel, setSel] = useState(today.slice(0, 7));          // 발행 달 · 'ALL'
  const [by, setBy] = useState('views');
  const pub = rows.filter(r => r.stage === '발행');
  const months = [...new Set([today.slice(0, 7), ...pub.map(r => (r.date || '').slice(0, 7)).filter(Boolean)])].sort().reverse();
  const list = pub.filter(r => sel === 'ALL' || (r.date || '').startsWith(sel)).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const P = S.perf;
  const setP = (id, k, v) => set(c => { const p = { ...(c.perf || {}) }; p[id] = { ...(p[id] || {}), [k]: v === '' ? '' : Number(v), at: today }; return { ...c, perf: p }; });
  const sum = (rs, k) => rs.reduce((s, r) => s + (Number(P[r.id]?.[k]) || 0), 0);
  const views = sum(list, 'views'), engs = list.reduce((s, r) => s + eng(P[r.id]), 0);
  const measured = list.filter(r => P[r.id] && Number(P[r.id].views) > 0);
  const where = r => (r.account && r.account !== '-' ? r.account : r.channel || '기타');
  // 계정(없으면 채널)별
  const groups = [...new Set(list.map(where))].map(k => { const rs = list.filter(r => where(r) === k); return { k, n: rs.length, views: sum(rs, 'views'), eng: rs.reduce((s, r) => s + eng(P[r.id]), 0), follows: sum(rs, 'follows') }; }).sort((a, b) => b.views - a.views);
  const gmax = Math.max(1, ...groups.map(g => g.views));
  const top = [...measured].sort((a, b) => (by === 'eng' ? eng(P[b.id]) / (P[b.id].views || 1) - eng(P[a.id]) / (P[a.id].views || 1) : (Number(P[b.id][by]) || 0) - (Number(P[a.id][by]) || 0))).slice(0, 5);
  // 최근 6달 조회수 (발행 달 기준)
  const trend = Array.from({ length: 6 }, (_, i) => addMonths(today.slice(0, 7), i - 5)).map(m => { const rs = pub.filter(r => (r.date || '').startsWith(m)); return { m, v: sum(rs, 'views'), n: rs.length }; });
  const tmax = Math.max(1, ...trend.map(t => t.v));

  return (
    <>
      <div className="ct-bar">
        <select value={sel} onChange={e => setSel(e.target.value)} aria-label="발행 달" className="fv-month">
          <option value="ALL">전체 기간</option>{months.map(m => <option key={m} value={m}>{ymL(m)}</option>)}</select>
        <span className="muted">발행한 콘텐츠의 성과를 적으면 참여율 · 계정별 성과 · 상위 콘텐츠를 계산합니다</span>
      </div>
      <div className="hv-stats">
        <div className="hv-stat sl"><span className="muted">발행 콘텐츠</span><b>{list.length}건</b><span className="hv-sub">성과 입력 {measured.length}건</span></div>
        <div className="hv-stat sl"><span className="muted">총 조회</span><b>{num(views)}</b><span className="hv-sub">콘텐츠당 {measured.length ? num(Math.round(views / measured.length)) : '-'}</span></div>
        <div className="hv-stat ex"><span className="muted">평균 참여율</span><b>{pct(engs, views)}</b><span className="hv-sub">(좋아요+댓글+공유+저장) ÷ 조회</span></div>
        <div className="hv-stat ex"><span className="muted">팔로워 유입</span><b>{num(sum(list, 'follows'))}</b><span className="hv-sub">링크 클릭 {num(sum(list, 'clicks'))}</span></div>
      </div>

      <div className="fv-grid fv-grid2">
        <section className="panel">
          <div className="hv-ch"><h2>계정 · 채널별 성과</h2></div>
          {groups.length ? <ul className="fv-bars fv-cbars">{groups.map(g => (
            <li key={g.k}><span className="fv-bl" title={g.k}>{g.k}</span><span className="fv-track"><i style={{ width: `${g.views / gmax * 100}%` }} /></span>
              <span className="fv-bv">{num(g.views)} <small>참여 {pct(g.eng, g.views)} · {g.n}건</small></span></li>))}</ul> : <p className="muted">이 기간에 발행한 콘텐츠가 없습니다.</p>}
        </section>
        <section className="panel">
          <div className="hv-ch"><h2>상위 콘텐츠</h2>
            <select value={by} onChange={e => setBy(e.target.value)} aria-label="상위 기준" className="grow-r ct-by">{[['views', '조회순'], ['eng', '참여율순'], ['follows', '팔로워 유입순'], ['saves', '저장순']].map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></div>
          {top.length ? <ol className="ct-top">{top.map(r => (
            <li key={r.id}><span className="grow"><b>{r.title}</b> <small className="muted">{where(r)} · {r.date ? `${Number(r.date.slice(5, 7))}/${Number(r.date.slice(8, 10))}` : ''}</small></span>
              <span className="num">{by === 'eng' ? pct(eng(P[r.id]), P[r.id].views) : num(Number(P[r.id][by]) || 0)}</span></li>))}</ol>
            : <p className="muted">아래 표에 조회수를 적으면 순위가 나옵니다.</p>}
        </section>
      </div>

      <section className="panel">
        <div className="hv-ch"><h2>최근 6달 조회 (발행 달 기준)</h2></div>
        <div className="fi-cols ct-trend">{trend.map(t => (
          <div key={t.m} className={`fi-col ${t.m === today.slice(0, 7) ? 'now' : ''}`} title={`${ymL(t.m)} 조회 ${num(t.v)} · 발행 ${t.n}건`}>
            <span className="fi-v">{t.v ? num(t.v) : ''}</span><span className="fi-bar"><i style={{ height: `${t.v / tmax * 100}%` }} /></span>
            <span className="fi-m">{Number(t.m.slice(5, 7))}월 · {t.n}건</span></div>))}</div>
      </section>

      <section className="panel">
        <div className="csum-h"><h2>콘텐츠별 성과 입력</h2><span className="muted">{list.length}건 · 칸에 숫자를 적으면 바로 저장 · 측정일은 마지막으로 고친 날</span></div>
        {list.length ? <div className="tablewrap"><table className="prog fv-table ct-table">
          <thead><tr><th>콘텐츠</th><th>계정 · 채널</th><th>발행일</th>{METRICS.map(([k, n]) => <th key={k} className="r">{n}</th>)}<th className="r">참여율</th><th>측정일</th></tr></thead>
          <tbody>{list.map(r => { const p = P[r.id] || {}; return (
            <tr key={r.id}><td><b>{r.title}</b></td><td className="nw">{where(r)}</td><td className="nw">{r.date ? r.date.slice(5).replace('-', '/') : '-'}</td>
              {METRICS.map(([k, n]) => <td key={k}><input type="number" min="0" value={p[k] ?? ''} onChange={e => setP(r.id, k, e.target.value)} aria-label={`${r.title} ${n}`} /></td>)}
              <td className="num">{pct(eng(p), Number(p.views) || 0)}</td><td className="nw muted">{p.at ? p.at.slice(5).replace('-', '/') : '-'}</td></tr>); })}
            <tr className="fs-sum"><td>합계</td><td /><td />{METRICS.map(([k]) => <td key={k} className="num"><b>{num(sum(list, k))}</b></td>)}<td className="num"><b>{pct(engs, views)}</b></td><td /></tr>
          </tbody></table></div>
          : <p className="muted">이 기간에 "발행" 단계인 콘텐츠가 없습니다. 콘텐츠 탭에서 단계를 "발행"으로 옮기면 여기에 나옵니다.</p>}
      </section>
    </>
  );
}
