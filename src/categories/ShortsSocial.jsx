import React, { useEffect, useMemo, useRef, useState } from 'react';
import { num, useCtx } from '../shared.jsx';

/* 숏폼 제작 4차 화면: ⑥ 업로드 — 계정 연결(유튜브 · 인스타그램) → 완성 영상 올리기(지금 · 예약) → 올린 목록 · 성과
   서버: server/shortsSocial.mjs. 올린 영상과 성과는 콘텐츠 관리 › 성과 탭에도 자동으로 들어간다 (shortsPerf.js) */
const P = { youtube: '유튜브', instagram: '인스타그램' };
const PRIV = [['public', '공개'], ['unlisted', '일부 공개 (링크 있는 사람만)'], ['private', '비공개']];
const STATUS = { scheduled: '예약됨', uploading: '올리는 중', done: '올림', failed: '실패' };
const dt = d => (d ? new Date(d).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');
const localInput = d => { const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return x.toISOString().slice(0, 16); };
const tagsOf = h => String(h || '').split(/[\s,]+/).map(t => t.replace(/^#/, '').trim()).filter(Boolean).map(t => `#${t}`).join(' ');

export function Uploads({ d, act, busy, patch, reload, pick, goRender }) {
  const { sync } = useCtx();
  const S = d.social;
  const waiting = useRef(false);
  useEffect(() => {                                          // 연결 창에서 돌아오면 다시 읽기
    const onMsg = e => { if (e.data && e.data.jcalSocial) { waiting.current = false; reload(); } };
    const onFocus = () => { if (waiting.current) { waiting.current = false; reload(); } };
    window.addEventListener('message', onMsg); window.addEventListener('focus', onFocus);
    return () => { window.removeEventListener('message', onMsg); window.removeEventListener('focus', onFocus); };
  }, []);
  const active = !!S && S.posts.some(p => p.status === 'uploading' || (p.status === 'scheduled' && new Date(p.scheduled_at) < Date.now() + 60000));
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => { sync.request('/api/shorts/social').then(patch).catch(() => {}); }, 3000);
    return () => clearInterval(t);
  }, [active]);
  if (!S) return <section className="panel"><p className="banner">서버가 아직 업로드를 지원하지 않습니다. VPS 서버를 업데이트하세요 (bash server/deploy/update.sh)</p></section>;

  const connect = async platform => {
    const r = await act(`c${platform}`, '/api/shorts/social/connect', { platform });
    if (!r?.url) return;
    waiting.current = true;
    const w = window.open(r.url, 'jcal-oauth', 'width=520,height=760');
    if (!w) window.location.href = r.url;                     // 새 창이 막히면 이 창에서
  };
  return (
    <>
      <section className="panel">
        <div className="csum-h"><h2>계정 연결</h2><span className="muted">한 번 연결하면 앱에서 바로 올립니다 (비밀번호는 저장하지 않음)</span></div>
        <div className="su-chs">{['youtube', 'instagram'].map(p => <Channel key={p} p={p} c={S.channels[p]} cb={S.callback[p]} busy={busy} connect={connect} act={act} />)}</div>
      </section>
      <UploadForm d={d} act={act} busy={busy} pick={pick} goRender={goRender} />
      <Posts d={d} act={act} busy={busy} />
    </>
  );
}

function Channel({ p, c, cb, busy, connect, act }) {
  return (
    <div className={`su-ch ${c.connected ? (c.error ? 'warn' : 'on') : ''}`}>
      <div className="su-chh"><b>{P[p]}</b>{p === 'youtube' ? <small className="muted">쇼츠</small> : <small className="muted">릴스</small>}
        <span className={`tag grow-r ${c.connected && !c.error ? 'sh-ok' : ''}`}>{!c.ready ? '키 없음' : c.connected ? (c.error ? '다시 연결 필요' : '연결됨') : '연결 안 됨'}</span></div>
      {c.connected && <p className="su-acc">{c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.name || '내 계정'}</a> : c.name}
        <small className="muted"> · {dt(c.connectedAt)} 연결{p === 'instagram' && c.expiresAt ? ` · ${dt(c.expiresAt)}까지 (자동 연장)` : ''}</small></p>}
      {c.error && <p className="sh-err">{c.error}</p>}
      {!c.ready
        ? <p className="note">VPS 터미널에서 <code>jcal-admin {p}-key</code> 로 {p === 'youtube' ? 'Google Cloud OAuth 클라이언트 ID · 보안 비밀번호' : 'Meta 앱의 Instagram 앱 ID · 시크릿'}를 넣어 주세요. 앱 설정에 넣을 돌아오는 주소: <code className="su-cb">{cb}</code></p>
        : <div className="btns">
          <button className={`btn ${c.connected ? '' : 'primary'}`} disabled={busy === `c${p}`} onClick={() => connect(p)}>{busy === `c${p}` ? '여는 중…' : c.connected ? '다시 연결' : '연결하기'}</button>
          {c.connected && <button className="tl-del" onClick={() => window.confirm(`${P[p]} 연결을 끊을까요? (올린 영상은 그대로)`) && act('', '/api/shorts/social/disconnect', { platform: p }, `${P[p]} 연결을 끊었습니다`)}>연결 끊기</button>}
        </div>}
      {p === 'youtube' && c.ready && <p className="note">Google 앱 심사 전에는 API 로 올린 영상이 <b>비공개로 잠길 수 있습니다</b>. 공개로 올리려면 YouTube API 감사(무료)를 신청해야 합니다 (docs/shorts.md).</p>}
      {p === 'instagram' && c.ready && <p className="note">프로페셔널(비즈니스 · 크리에이터) 계정만 됩니다. 인스타그램은 이 서버 주소에서 영상을 직접 가져갑니다.</p>}
    </div>
  );
}

function UploadForm({ d, act, busy, pick, goRender }) {
  const { sync } = useCtx();
  const S = d.social;
  const done = d.renders.filter(r => r.status === 'done');
  const [rid, setRid] = useState(pick && done.some(r => r.id === pick) ? pick : done[0]?.id || '');
  useEffect(() => { if (pick && done.some(r => r.id === pick)) setRid(pick); }, [pick]);
  const r = done.find(x => x.id === rid);
  const script = r && d.scripts.find(s => s.id === r.script_id);
  const conn = ['youtube', 'instagram'].filter(p => S.channels[p].connected && !S.channels[p].error);
  const blank = useMemo(() => ({ title: r?.title || '', caption: tagsOf(script?.hashtags), privacy: 'public', platforms: conn, when: 'now', at: localInput(new Date(Date.now() + 3600000)) }), [rid, conn.join()]);
  const [f, setF] = useState(blank);
  useEffect(() => setF(blank), [blank]);
  if (!done.length) return <section className="panel"><div className="csum-h"><h2>올리기</h2></div><p className="muted">완성된 영상이 없습니다. <button className="linkish" onClick={goRender}>⑤ 영상 만들기</button>에서 먼저 영상을 만들어 주세요.</p></section>;
  const already = f.platforms.filter(p => S.posts.some(x => x.render_id === rid && x.platform === p && x.status !== 'failed'));
  const tags = (f.caption.match(/#[^\s#]+/g) || []).length;
  const yt = f.platforms.includes('youtube'), ig = f.platforms.includes('instagram');
  const submit = async () => {
    if (already.length && !window.confirm(`이 영상은 이미 ${already.map(p => P[p]).join(' · ')}에 올렸거나 예약했습니다. 또 올릴까요?`)) return;
    const at = f.when === 'later' ? new Date(f.at) : null;
    await act('post', '/api/shorts/post', { renderId: rid, platforms: f.platforms, title: f.title, caption: f.caption, privacy: f.privacy, scheduledAt: at ? at.toISOString() : undefined },
      x => (at ? `${dt(at)}에 올리도록 예약했습니다 (${x.posts.length}곳)` : `올리기 시작했습니다 (${x.posts.length}곳) · 아래 목록에서 진행을 볼 수 있습니다`));
  };
  return (
    <section className="panel">
      <div className="csum-h"><h2>올리기</h2><span className="muted">유튜브 쇼츠 · 인스타그램 릴스 (서버가 대신 올림, 이 화면을 닫아도 됨)</span></div>
      <div className="su-form">
        <div className="su-left">
          <label>영상<select value={rid} onChange={e => setRid(e.target.value)}>{done.map(x => <option key={x.id} value={x.id}>{x.title} · {dt(x.finished_at)}</option>)}</select></label>
          {r?.thumb && <img className="su-th" src={`${sync.conf.url}${r.thumb}`} alt="" />}
        </div>
        <div className="su-right">
          <div className="su-plats" role="group" aria-label="올릴 곳">{['youtube', 'instagram'].map(p => (
            <label key={p} className={`sh-chk ${conn.includes(p) ? '' : 'off'}`}><input type="checkbox" disabled={!conn.includes(p)} checked={f.platforms.includes(p)}
              onChange={e => setF({ ...f, platforms: e.target.checked ? [...f.platforms, p] : f.platforms.filter(x => x !== p) })} />{P[p]}{conn.includes(p) ? '' : ' (연결 안 됨)'}</label>))}</div>
          <label>제목 {yt && <small className={f.title.length > 100 ? 'sh-err' : 'muted'}>{f.title.length}/100 (유튜브)</small>}{!yt && <small className="muted">인스타그램은 제목 없이 캡션만 씁니다</small>}
            <input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} /></label>
          <label>{yt && ig ? '설명 · 캡션' : yt ? '설명' : '캡션'} <small className={(ig && f.caption.length > 2200) || (ig && tags > 30) ? 'sh-err' : 'muted'}>{f.caption.length}자 · 해시태그 {tags}개{ig ? ' (인스타 2200자 · 30개까지)' : ''}{yt ? ' · 유튜브는 #Shorts 를 자동으로 붙임' : ''}</small>
            <textarea rows={4} value={f.caption} onChange={e => setF({ ...f, caption: e.target.value })} placeholder="영상 설명과 해시태그 (#회사썰 #직장인)" /></label>
          <div className="su-row">
            {yt && <label>유튜브 공개 범위<select value={f.privacy} onChange={e => setF({ ...f, privacy: e.target.value })}>{PRIV.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>}
            <label>언제<select value={f.when} onChange={e => setF({ ...f, when: e.target.value })}><option value="now">지금 올리기</option><option value="later">예약</option></select></label>
            {f.when === 'later' && <label>예약 시각<input type="datetime-local" value={f.at} min={localInput(new Date())} onChange={e => setF({ ...f, at: e.target.value })} /></label>}
          </div>
          {already.length > 0 && <p className="note">이 영상은 이미 {already.map(p => P[p]).join(' · ')}에 올렸거나 예약되어 있습니다.</p>}
          <div className="btns"><button className="btn primary" disabled={!rid || !f.platforms.length || busy === 'post' || (yt && !f.title.trim())} onClick={submit}>{busy === 'post' ? '넣는 중…' : f.when === 'later' ? '예약하기' : '올리기'}</button></div>
        </div>
      </div>
    </section>
  );
}

function Posts({ d, act, busy }) {
  const S = d.social;
  const [plat, setPlat] = useState('ALL');
  const list = S.posts.filter(p => plat === 'ALL' || p.platform === plat);
  const sum = k => S.posts.filter(p => p.status === 'done').reduce((s, p) => s + (Number(p.stats?.[k]) || 0), 0);
  return (
    <section className="panel">
      <div className="csum-h"><h2>올린 영상 · 성과</h2>
        <div className="chips" role="group" aria-label="플랫폼">{[['ALL', '전체'], ['youtube', '유튜브'], ['instagram', '인스타그램']].map(([k, n]) => <button key={k} aria-pressed={plat === k} onClick={() => setPlat(k)}>{n}</button>)}</div>
        <button className="btn sm grow-r" disabled={busy === 'stats' || !S.posts.some(p => p.status === 'done')} onClick={() => act('stats', '/api/shorts/stats', {}, x => (x.errors.length ? `일부 실패: ${x.errors.join(' / ')}` : '성과를 새로 가져왔습니다'))}>{busy === 'stats' ? '가져오는 중…' : '성과 새로고침'}</button></div>
      {S.posts.some(p => p.status === 'done') && <p className="muted su-sum">조회 {num(sum('views'))} · 좋아요 {num(sum('likes'))} · 댓글 {num(sum('comments'))} · 공유 {num(sum('shares'))} · 저장 {num(sum('saves'))} — 1시간마다 자동으로 가져오고, 콘텐츠 관리 › 성과 탭에도 들어갑니다</p>}
      {list.length ? <ul className="su-posts">{list.map(p => (
        <li key={p.id} className={`s-${p.status}`}>
          <span className={`su-pf ${p.platform}`}>{P[p.platform]}</span>
          <span className="su-pm">
            <b>{p.url ? <a href={p.url} target="_blank" rel="noreferrer">{p.title || p.caption.slice(0, 40) || '(제목 없음)'}</a> : p.title || p.caption.slice(0, 40) || '(제목 없음)'}</b>
            <small className="muted">
              <span className={`tag ${p.status === 'done' ? 'sh-ok' : p.status === 'failed' ? 'sr-bad' : ''}`}>{STATUS[p.status]}</span>
              {p.status === 'scheduled' && ` ${dt(p.scheduled_at)}`}{p.status === 'uploading' && ` ${p.stage}`}{p.status === 'done' && ` ${dt(p.posted_at)}`}
              {p.platform === 'youtube' && ` · ${PRIV.find(x => x[0] === p.privacy)?.[1].split(' ')[0]}`}</small>
            {p.status === 'failed' && <small className="sh-err">{p.error}</small>}
            {p.status === 'done' && <small className="su-st">{[['views', '조회'], ['likes', '좋아요'], ['comments', '댓글'], ['shares', '공유'], ['saves', '저장']].filter(([k]) => p.stats?.[k] != null).map(([k, n]) => `${n} ${num(p.stats[k])}`).join(' · ') || '성과 아직 없음'}
              {p.stats_at && <span className="muted"> ({dt(p.stats_at)})</span>}</small>}
          </span>
          <span className="su-pa">
            {p.status === 'failed' && <button className="btn sm" onClick={() => act('', '/api/shorts/post/action', { id: p.id, action: 'retry' }, '다시 올리기 시작했습니다')}>다시 시도</button>}
            {p.status === 'scheduled' && <button className="tl-del" onClick={() => window.confirm('예약을 취소할까요?') && act('', '/api/shorts/post/action', { id: p.id, action: 'cancel' }, '예약을 취소했습니다')}>예약 취소</button>}
            {(p.status === 'done' || p.status === 'failed') && <button className="tl-del" onClick={() => window.confirm(p.status === 'done' ? '목록에서만 뺄까요? (유튜브 · 인스타그램에 올린 영상은 그대로 남습니다)' : '목록에서 뺄까요?') && act('', '/api/shorts/post/action', { id: p.id, action: 'remove' })}>목록에서 빼기</button>}
          </span>
        </li>))}</ul>
        : <p className="muted">아직 올린 영상이 없습니다.</p>}
    </section>
  );
}
