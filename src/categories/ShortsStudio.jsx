import React, { useEffect, useState } from 'react';
import { useCtx } from '../shared.jsx';
import { AssetLibrary, Prep, VideoSettings } from './ShortsAssets.jsx';
import { Renders } from './ShortsRender.jsx';
import { Uploads } from './ShortsSocial.jsx';
import { mergeShortsPosts } from './shortsPerf.js';

/* 사업 › 콘텐츠 관리 › 숏폼 제작: ① 수집함 → ② 글 고르기 · AI 제목 · 스크립트 (server/shorts.mjs)
   → ③ 소재함 · ④ 제작 준비 (ShortsAssets.jsx) → ⑤ 영상 만들기 (ShortsRender.jsx) → ⑥ 업로드 · 성과 (ShortsSocial.jsx)
   - 게시판(RSS)은 서버가 정해진 주기마다 자동으로 읽어 수집함에 쌓는다
   - 고른 글에서 "AI 스크립트 만들기" → 후보 여러 개 → 하나를 골라 고친다 (고른 스크립트가 2차 · 3차의 영상 재료)
   - 관리자 + 회원 관리에서 "숏폼 제작"을 허용한 회원에게 보임 (자료는 사람마다 따로, AI 비용은 서버 키로 나감) */
const STEPS = [['inbox', '① 수집함'], ['scripts', '② 고른 글 · 스크립트'], ['assets', '③ 소재함'], ['prep', '④ 제작 준비'], ['render', '⑤ 영상 만들기'], ['upload', '⑥ 업로드'], ['settings', '설정']];
const dt = d => (d ? new Date(d).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');
const secs = n => Math.round(n / 5.5);                       // 한국어 나레이션 약 5.5자/초

export default function ShortsStudio() {
  const { sync, setStore } = useCtx();
  const [d, setD] = useState(null);
  const [pick, setPick] = useState(null);                     // ⑤ 에서 "업로드"를 누른 영상
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState('');                       // 진행 중인 일 (버튼 막기)
  const [step, setStep] = useState('inbox');
  const say = (t, bad = false) => setMsg({ t, bad });
  const patch = p => setD(x => (x ? { ...x, ...p } : x));   // 영상 진행률만 바꿀 때
  const load = async () => {
    try { setD(await sync.request('/api/shorts')); setErr(''); }
    catch (e) { setErr(e.status === 404 ? '서버가 아직 숏폼 제작을 지원하지 않습니다. VPS 서버를 업데이트하세요 (bash server/deploy/update.sh)' : e.message); }
  };
  useEffect(() => { if (sync.connected) load(); }, [sync.connected]);
  // 올린 영상 · 성과를 콘텐츠 관리 › 성과 탭에 넣기 (바뀐 것이 있을 때만)
  const postsKey = d?.social ? JSON.stringify(d.social.posts.filter(p => p.status === 'done').map(p => [p.id, p.url, p.stats_at])) : '';
  useEffect(() => { if (postsKey) setStore(s => mergeShortsPosts(s, d.social.posts, d.social.channels)); }, [postsKey]);
  const act = async (key, path, body, done) => {
    setBusy(key);
    try { const r = await sync.request(path, { method: 'POST', body }); if (done) say(typeof done === 'function' ? done(r) : done); await load(); return r; }
    catch (e) { say(e.message, true); return null; }
    finally { setBusy(''); }
  };

  if (!sync.connected) return <section className="panel"><p className="muted">숏폼 제작은 서버에 로그인한 상태에서 씁니다 (설정 › 계정 · 서버 연결).</p></section>;
  if (err) return <section className="panel"><p className="banner">{err}</p><button className="btn sm" onClick={load}>다시 시도</button></section>;
  if (!d) return <section className="panel"><p className="muted">불러오는 중…</p></section>;

  const srcName = id => d.sources.find(s => s.id === id)?.name || '삭제된 게시판';
  const counts = { new: d.items.filter(i => i.status === 'new').length, picked: d.items.filter(i => i.status === 'picked').length, ready: d.scripts.filter(s => s.chosen && d.items.some(i => i.id === s.item_id && i.status === 'picked')).length,
    working: (d.renders || []).filter(r => r.status === 'queued' || r.status === 'running').length,
    posting: (d.social?.posts || []).filter(p => p.status === 'scheduled' || p.status === 'uploading').length };
  return (
    <div className="sh">
      <div className="sh-steps" role="tablist" aria-label="숏폼 제작 단계">
        {STEPS.map(([k, n]) => <button key={k} role="tab" aria-selected={step === k} className={step === k ? 'on' : ''} onClick={() => setStep(k)}>{n}
          {k === 'inbox' && counts.new > 0 && <b>{counts.new}</b>}{k === 'scripts' && counts.picked > 0 && <b>{counts.picked}</b>}{k === 'prep' && counts.ready > 0 && <b>{counts.ready}</b>}{k === 'render' && counts.working > 0 && <b>{counts.working}</b>}{k === 'upload' && counts.posting > 0 && <b>{counts.posting}</b>}</button>)}
        <button className="btn sm sh-demo" disabled={!!busy} title="예시 글 · 스크립트 · 배경 3장 · 음악을 채워 바로 영상 만들기를 해 볼 수 있게 합니다 (AI 비용 없음)"
          onClick={async () => { if (!window.confirm('예시 한 벌(글 · 스크립트 · 배경 3장 · 배경음악 · 제작 준비)을 채울까요?\n다른 자료는 그대로 두고, 예시만 새로 고칩니다.')) return;
            const r = await act('demo', '/api/shorts/demo', {}, '예시를 채웠습니다. ⑤ 영상 만들기에서 "영상 만들기"를 누르면 실제 영상이 만들어집니다 (나레이션 음성 비용만 듦)');
            if (r) setStep('render'); }}>{busy === 'demo' ? '채우는 중…' : '예시로 채우기'}</button>
        <span className={`sh-ai ${d.ai.ready ? 'ok' : ''}`} title={d.ai.model}>{d.ai.ready ? `AI 준비됨 · ${d.ai.provider === 'anthropic' ? 'Claude' : 'ChatGPT'} ${d.ai.model}` : 'AI 키 없음 (설정 참고)'}</span>
      </div>
      {msg && <p className={`banner ${msg.bad ? '' : 'ok'} sh-msg`} role="status">{msg.t}<button className="linkish" onClick={() => setMsg(null)}>닫기</button></p>}
      {step === 'inbox' && <Inbox d={d} act={act} busy={busy} srcName={srcName} goScripts={() => setStep('scripts')} />}
      {step === 'scripts' && <Scripts d={d} act={act} busy={busy} srcName={srcName} goInbox={() => setStep('inbox')} />}
      {step === 'assets' && <AssetLibrary d={d} act={act} busy={busy} reload={load} />}
      {step === 'prep' && <Prep d={d} act={act} busy={busy} goScripts={() => setStep('scripts')} goAssets={() => setStep('assets')} goRender={() => setStep('render')} />}
      {step === 'render' && (d.renders ? <Renders d={d} act={act} busy={busy} patch={patch} goPrep={() => setStep('prep')} goUpload={id => { setPick(id); setStep('upload'); }} />
        : <section className="panel"><p className="banner">서버가 아직 영상 만들기를 지원하지 않습니다. VPS 서버를 업데이트하세요 (bash server/deploy/update.sh)</p></section>)}
      {step === 'upload' && <Uploads d={d} act={act} busy={busy} patch={patch} reload={load} pick={pick} goRender={() => setStep('render')} />}
      {step === 'settings' && <><Settings d={d} act={act} busy={busy} /><VideoSettings d={d} act={act} busy={busy} /></>}
    </div>
  );
}

/* ① 수집함: 게시판 관리 + 새 글 */
function Inbox({ d, act, busy, srcName, goScripts }) {
  const [f, setF] = useState({ url: '', name: '', fullText: false, bodyPattern: '' });
  const [open, setOpen] = useState(!d.sources.length);
  const [adv, setAdv] = useState(false);
  const [filter, setFilter] = useState('new');
  const [src, setSrc] = useState('ALL');
  const [q, setQ] = useState('');
  const [exp, setExp] = useState(null);
  const [limit, setLimit] = useState(40);
  const add = async e => {
    e.preventDefault();
    const r = await act('add', '/api/shorts/source', { action: 'add', ...f }, r2 => `"${r2.source.name}" 등록 · 글 ${r2.found}개 중 새 글 ${r2.added}개 수집${r2.error ? ` (오류: ${r2.error})` : ''}`);
    if (r) setF({ url: '', name: '', fullText: false, bodyPattern: '' });
  };
  const ql = q.trim().toLowerCase();
  const list = d.items.filter(i => i.status === filter && (src === 'ALL' || i.source_id === src) && (!ql || `${i.title} ${i.body}`.toLowerCase().includes(ql)));
  return (
    <>
      <section className="panel">
        <div className="csum-h"><h2>수집할 게시판</h2><span className="muted">{d.sources.length}곳 · 서버가 {d.settings.fetchMinutes}분마다 새 글을 가져옵니다</span>
          <button className="btn sm grow-r" onClick={() => setOpen(v => !v)} aria-expanded={open}>{open ? '접기' : '게시판 관리'}</button></div>
        {open && <>
          {d.sources.length > 0 && <ul className="sh-srcs">{d.sources.map(s => (
            <li key={s.id} className={s.active ? '' : 'off'}>
              <span className="sh-sn"><b>{s.name}</b><small className="muted" title={s.feed_url}>{s.feed_url}</small>
                <small className={s.last_error ? 'sh-err' : 'muted'}>{s.last_error ? `오류: ${s.last_error}` : s.last_fetched_at ? `마지막 수집 ${dt(s.last_fetched_at)} · 새 글 ${s.last_count}개` : '아직 수집 안 함'}</small></span>
              <label className="sh-chk"><input type="checkbox" checked={s.full_text} onChange={e => act('', '/api/shorts/source', { action: 'update', id: s.id, fullText: e.target.checked })} />본문까지</label>
              <label className="sh-chk"><input type="checkbox" checked={s.active} onChange={e => act('', '/api/shorts/source', { action: 'update', id: s.id, active: e.target.checked })} />자동 수집</label>
              <button className="btn sm" disabled={!!busy} onClick={() => act(`f${s.id}`, '/api/shorts/source', { action: 'fetch', id: s.id }, r => (r.error ? `수집 실패: ${r.error}` : `새 글 ${r.added}개`))}>{busy === `f${s.id}` ? '수집 중…' : '지금 수집'}</button>
              <button className="tl-del" onClick={() => window.confirm(`"${s.name}" 게시판을 지울까요? (이미 모은 글은 남습니다)`) && act('', '/api/shorts/source', { action: 'delete', id: s.id }, '게시판을 지웠습니다')}>삭제</button>
            </li>))}</ul>}
          {d.presets && <Presets d={d} act={act} busy={busy} />}
          <form className="sh-add" onSubmit={add}>
            <input value={f.url} onChange={e => setF({ ...f, url: e.target.value })} placeholder="게시판 주소 또는 RSS 주소 (https://…)" aria-label="게시판 주소" required />
            <input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="이름 (선택)" aria-label="게시판 이름" />
            <label className="sh-chk"><input type="checkbox" checked={f.fullText} onChange={e => setF({ ...f, fullText: e.target.checked })} />글 본문까지 가져오기</label>
            <button className="btn primary" disabled={!f.url.trim() || busy === 'add'}>{busy === 'add' ? '확인 중…' : '게시판 추가'}</button>
            <button type="button" className="linkish" onClick={() => setAdv(v => !v)}>{adv ? '고급 닫기' : '고급'}</button>
            {adv && <label className="sh-adv">본문 정규식 (첫 번째 괄호가 본문, 비우면 자동)<input value={f.bodyPattern} onChange={e => setF({ ...f, bodyPattern: e.target.value })} placeholder={'<div class="view_content">([\\s\\S]*?)</div>'} /></label>}
          </form>
          <p className="note">게시판 페이지 주소를 넣으면 그 페이지에 있는 RSS 를 찾아 씁니다. RSS 가 없는 게시판은 아직 수집할 수 없습니다(다음 단계에서 지원 예정). 원문은 그대로 쓰지 말고 AI 가 다시 쓴 스크립트만 쓰세요.</p>
        </>}
      </section>

      <section className="panel">
        <div className="csum-h"><h2>수집한 글</h2>
          <div className="chips" role="group" aria-label="보기">{[['new', `새 글 ${d.items.filter(i => i.status === 'new').length}`], ['skipped', `건너뜀 ${d.items.filter(i => i.status === 'skipped').length}`]].map(([k, n]) => <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{n}</button>)}</div>
          {d.sources.length > 1 && <select value={src} onChange={e => setSrc(e.target.value)} aria-label="게시판"><option value="ALL">게시판 전체</option>{d.sources.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}
          <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="제목 · 본문 검색" aria-label="글 검색" className="sh-q" /></div>
        {list.length ? <ul className="sh-items">{list.slice(0, limit).map(i => (
          <li key={i.id}>
            <div className="sh-ih"><a href={i.link} target="_blank" rel="noreferrer"><b>{i.title}</b></a><small className="muted">{srcName(i.source_id)} · {dt(i.published_at || i.fetched_at)} · {i.body.length.toLocaleString()}자</small></div>
            {i.body && <p className={`sh-body ${exp === i.id ? 'open' : ''}`} onClick={() => setExp(x => (x === i.id ? null : i.id))} title="눌러서 펼치기 · 접기">{i.body}</p>}
            <div className="sh-ib">
              {filter === 'new'
                ? <><button className="btn primary sm" onClick={() => act('', '/api/shorts/item', { id: i.id, status: 'picked' }, '제작할 글로 골랐습니다. "② 고른 글 · 스크립트"에서 AI 스크립트를 만드세요')}>제작할 글로 고르기</button>
                  <button className="btn sm" onClick={() => act('', '/api/shorts/item', { id: i.id, status: 'skipped' })}>건너뛰기</button></>
                : <button className="btn sm" onClick={() => act('', '/api/shorts/item', { id: i.id, status: 'new' })}>새 글로 되돌리기</button>}
            </div>
          </li>))}</ul>
          : <p className="muted">{d.sources.length ? (filter === 'new' ? '새 글이 없습니다. "지금 수집"을 누르거나 다음 자동 수집을 기다리세요.' : '건너뛴 글이 없습니다.') : '먼저 위에서 수집할 게시판을 추가하세요.'}</p>}
        {list.length > limit && <button className="btn sm" onClick={() => setLimit(l => l + 60)}>더 보기 ({list.length - limit}개 남음)</button>}
        {d.items.some(i => i.status === 'picked') && <p className="note">고른 글 {d.items.filter(i => i.status === 'picked').length}개 · <button className="linkish" onClick={goScripts}>스크립트 만들러 가기 ›</button></p>}
      </section>
    </>
  );
}

/** 추천 게시판: 골라서 한 번에 추가 (서버가 RSS 를 확인한 것만 추가, 안 되는 곳은 이유 표시) */
function Presets({ d, act, busy }) {
  const has = p => d.sources.some(s => s.url === p.url || s.name === p.name);
  const [pick, setPick] = useState(() => d.presets.filter(p => !has(p)).map(p => p.id));
  const left = d.presets.filter(p => !has(p));
  const run = () => act('presets', '/api/shorts/presets', { ids: pick }, r => {
    const ok = r.results.filter(x => x.ok && !x.skipped), bad = r.results.filter(x => !x.ok);
    return `추천 게시판 ${ok.length}곳 추가 · 새 글 ${ok.reduce((s, x) => s + (x.added || 0), 0)}개${bad.length ? ` · 안 된 곳: ${bad.map(x => `${x.name}(${x.error})`).join(', ')}` : ''}`;
  });
  return (
    <div className="sh-pre">
      <div className="sh-pre-h"><b>추천 게시판</b><small className="muted">썰 · 직장 · 일상 · 유머 위주로 골라 둔 곳 · 영어 게시판은 AI 가 한국어로 다시 씁니다</small></div>
      <ul>{d.presets.map(p => (
        <li key={p.id} className={has(p) ? 'on' : ''}>
          <label className="sh-chk"><input type="checkbox" disabled={has(p)} checked={has(p) || pick.includes(p.id)} onChange={e => setPick(x => (e.target.checked ? [...x, p.id] : x.filter(i => i !== p.id)))} />
            <b>{p.name}</b></label><small className="muted">{has(p) ? '추가됨' : p.desc}</small></li>))}</ul>
      {left.length > 0 && <button className="btn primary sm" disabled={!pick.length || !!busy} onClick={run}>{busy === 'presets' ? '게시판 확인하며 추가하는 중… (1~2분)' : `고른 게시판 추가 (${pick.filter(i => left.some(p => p.id === i)).length}곳)`}</button>}
    </div>
  );
}

/* ② 고른 글 · AI 스크립트 */
function Scripts({ d, act, busy, srcName, goInbox }) {
  const picked = d.items.filter(i => i.status === 'picked');
  const [exp, setExp] = useState(null);
  if (!picked.length) return <section className="panel"><p className="muted">고른 글이 없습니다. <button className="linkish" onClick={goInbox}>수집함</button>에서 제작할 글을 고르세요.</p></section>;
  const S = d.settings;
  return picked.map(i => {
    const sc = d.scripts.filter(s => s.item_id === i.id), chosen = sc.find(s => s.chosen);
    return (
      <section key={i.id} className={`panel sh-pick ${chosen ? 'done' : ''}`}>
        <div className="csum-h"><h2>{i.title}</h2>{chosen ? <span className="tag sh-ok">스크립트 고름</span> : sc.length ? <span className="tag">후보 {sc.length}개 · 하나를 고르세요</span> : <span className="tag">스크립트 없음</span>}
          <span className="grow-r sh-pa">
            <a className="btn sm" href={i.link} target="_blank" rel="noreferrer">원문</a>
            <button className="btn sm" onClick={() => setExp(x => (x === i.id ? null : i.id))}>{exp === i.id ? '본문 접기' : '본문 보기'}</button>
            <button className="btn sm" onClick={() => act('', '/api/shorts/item', { id: i.id, status: 'new' }, '수집함으로 되돌렸습니다')}>고르기 취소</button></span></div>
        <small className="muted">{srcName(i.source_id)} · {dt(i.published_at || i.fetched_at)} · 본문 {i.body.length.toLocaleString()}자</small>
        {exp === i.id && <p className="sh-body open">{i.body || '(본문 없음)'}</p>}
        <div className="sh-gen">
          <button className="btn primary" disabled={!d.ai.ready || !!busy} onClick={() => act(`g${i.id}`, '/api/shorts/generate', { itemId: i.id }, r => `후보 ${r.scripts.length}개를 만들었습니다`)}>
            {busy === `g${i.id}` ? 'AI 가 쓰는 중… (10~40초)' : sc.length ? '후보 더 만들기' : 'AI 스크립트 만들기'}</button>
          <small className="muted">제목 {S.titleMax}자 이내 · 스크립트 약 {S.scriptChars}자(나레이션 약 {secs(S.scriptChars)}초) · 후보 {S.count}개 · {S.tone}</small>
        </div>
        {sc.length > 0 && <div className="sh-cands">{sc.map((s, n) => <Candidate key={s.id} s={s} n={n + 1} S={S} act={act} />)}</div>}
      </section>
    );
  });
}

/** 후보 하나: 고르기 · 제목 · 스크립트 · 해시태그 고치기 (칸에서 나가면 저장) */
function Candidate({ s, n, S, act }) {
  const [v, setV] = useState({ title: s.title, script: s.script, hashtags: s.hashtags });
  useEffect(() => { setV({ title: s.title, script: s.script, hashtags: s.hashtags }); }, [s.title, s.script, s.hashtags]);
  const save = k => { if (v[k] !== s[k]) act('', '/api/shorts/script', { id: s.id, [k]: v[k] }); };
  const len = v.script.replace(/\s+/g, ' ').trim().length, tl = v.title.length;
  const off = Math.abs(len - S.scriptChars) > S.scriptChars * 0.2;
  return (
    <div className={`sh-cand ${s.chosen ? 'on' : ''}`}>
      <div className="sh-ch"><b>후보 {n}</b>
        <label className="sh-chk"><input type="radio" name={`pick-${s.item_id}`} checked={s.chosen} onChange={() => act('', '/api/shorts/script', { id: s.id, chosen: true }, `후보 ${n}을(를) 골랐습니다`)} />이 스크립트로 제작</label>
        <button className="tl-del grow-r" onClick={() => window.confirm(`후보 ${n}을(를) 지울까요?`) && act('', '/api/shorts/script', { id: s.id, remove: true })}>삭제</button></div>
      <label>제목 <small className={tl > S.titleMax ? 'sh-err' : 'muted'}>{tl}/{S.titleMax}자</small>
        <input value={v.title} onChange={e => setV({ ...v, title: e.target.value })} onBlur={() => save('title')} /></label>
      <label>스크립트 <small className={off ? 'sh-err' : 'muted'}>{len}자 · 나레이션 약 {secs(len)}초 (목표 {S.scriptChars}자)</small>
        <textarea rows={7} value={v.script} onChange={e => setV({ ...v, script: e.target.value })} onBlur={() => save('script')} /></label>
      <label>해시태그 <small className="muted">띄어쓰기로 구분</small>
        <input value={v.hashtags} onChange={e => setV({ ...v, hashtags: e.target.value })} onBlur={() => save('hashtags')} /></label>
      <small className="muted">{s.model} · {dt(s.created_at)}</small>
    </div>
  );
}

/* 설정 */
function Settings({ d, act, busy }) {
  const [v, setV] = useState(d.settings);
  const dirty = JSON.stringify(v) !== JSON.stringify(d.settings);
  const num = (k, label, min, max, unit, hint) => (
    <label>{label}<span className="sh-num"><input type="number" min={min} max={max} value={v[k]} onChange={e => setV({ ...v, [k]: e.target.value })} />{unit}</span>{hint && <small className="muted">{hint}</small>}</label>);
  return (
    <>
      <section className="panel">
        <div className="csum-h"><h2>스크립트 · 수집 설정</h2></div>
        <div className="sh-set">
          {num('titleMax', '제목 최대 글자 수', 10, 100, '자')}
          {num('scriptChars', '스크립트 글자 수', 100, 1500, '자', `나레이션 약 ${secs(Number(v.scriptChars) || 0)}초 (1분 ≈ 330자)`)}
          {num('count', '후보 개수', 1, 5, '개', '한 번에 만들 제목 · 스크립트 수')}
          <label className="sh-wide">말투<input value={v.tone} onChange={e => setV({ ...v, tone: e.target.value })} placeholder="예: 친구에게 썰 푸는 듯한 구어체" /></label>
          <label className="sh-wide">추가 지시 (선택)<textarea rows={3} value={v.extra} onChange={e => setV({ ...v, extra: e.target.value })} placeholder="예: 마지막에 '구독하고 다음 썰도 보세요'를 넣어 줘 / 반전 위주로" /></label>
        </div>
        <h2 className="sh-h2">수집 설정</h2>
        <div className="sh-set">
          {num('fetchMinutes', '수집 주기', 10, 1440, '분마다')}
          {num('keepDays', '고르지 않은 글 보관', 3, 365, '일', '지나면 자동으로 지움 (고른 글은 남음)')}
        </div>
        <div className="btns"><button className="btn primary" disabled={!dirty || !!busy} onClick={() => act('set', '/api/shorts/settings', v, '설정을 저장했습니다')}>저장</button>
          {dirty && <button className="btn" onClick={() => setV(d.settings)}>되돌리기</button>}</div>
      </section>
      <section className="panel">
        <div className="csum-h"><h2>AI 연결</h2><span className={`sh-ai ${d.ai.ready ? 'ok' : ''}`}>{d.ai.ready ? `준비됨 · ${d.ai.provider === 'anthropic' ? 'Claude' : 'ChatGPT'} ${d.ai.model}` : '키 없음'}</span></div>
        {d.ai.ready
          ? <p className="note">스크립트는 {d.ai.provider === 'anthropic' ? 'Anthropic Claude' : 'OpenAI ChatGPT'}({d.ai.model})로 만듭니다. 비용은 서버에 넣은 API 키로 나갑니다 (글 길이 · 후보 수 · 모델에 따라 달라짐). 모델을 바꾸려면 VPS 의 /etc/jcalender.env 에 SHORTS_MODEL=모델이름 을 넣고 systemctl restart jcal-api 를 실행하세요.</p>
          : <p className="note">VPS 터미널에서 <code>jcal-admin ai-key</code> 를 실행하고 ChatGPT(OpenAI) API 키(sk-…)를 붙여 넣으세요. 키는 platform.openai.com › API keys 에서 만들고, Billing 에 잔액이 있어야 합니다. 입력한 글자는 화면에 보이지 않고, 저장 뒤 서버가 다시 시작됩니다. 키는 채팅이나 GitHub 에 올리지 마세요.</p>}
      </section>
    </>
  );
}
