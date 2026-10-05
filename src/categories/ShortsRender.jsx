import React, { useEffect } from 'react';
import { useCtx } from '../shared.jsx';
import { clipsNeeded, estSeconds } from '../../server/shortsText.mjs';

/* 숏폼 제작 3차 화면: ⑤ 영상 만들기 — 스크립트별 "영상 만들기" → 대기열 → 진행률 → 미리보기 · 내려받기
   서버: server/shortsRender.mjs (나레이션 음성 · 자막 · 배경 · 배경음악을 합쳐 1080×1920 mp4) */
const mb = n => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)}GB` : `${Math.max(0.1, n / 1048576).toFixed(1)}MB`);
const sec = n => (n == null ? '' : n >= 60 ? `${Math.floor(n / 60)}분 ${Math.round(n % 60)}초` : `${Math.round(n)}초`);
const dt = d => (d ? new Date(d).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-');
const STATUS = { queued: '기다리는 중', running: '만드는 중', done: '완성', failed: '실패' };

export function Renders({ d, act, busy, patch, goPrep }) {
  const { sync } = useCtx();
  const active = d.renders.some(r => r.status === 'queued' || r.status === 'running');
  useEffect(() => {                                           // 만드는 중이면 2.5초마다 진행률만 다시 읽음
    if (!active) return undefined;
    const t = setInterval(() => { sync.request('/api/shorts/renders').then(patch).catch(() => {}); }, 2500);
    return () => clearInterval(t);
  }, [active]);
  const chosen = d.scripts.filter(s => s.chosen && d.items.some(i => i.id === s.item_id && i.status === 'picked'));
  const shown = new Set(chosen.map(s => s.id));
  const others = d.renders.filter(r => !shown.has(r.script_id));
  const V = d.settings.video;
  return (
    <>
      <section className="panel">
        <div className="csum-h"><h2>영상 만들기</h2><span className="muted">1080×1920 세로 · 나레이션 · 자막 · 배경 · 배경음악</span></div>
        {!d.render.ffmpeg && <p className="banner">서버에 영상 도구(ffmpeg)가 없습니다. VPS 에서 <code>bash server/deploy/update.sh</code> 를 다시 실행하세요.</p>}
        {!d.tts.ready && <p className="banner">나레이션 음성에 OpenAI API 키가 필요합니다. VPS 터미널에서 <code>jcal-admin ai-key</code> 로 넣어 주세요.</p>}
        <p className="note">만들기를 누르면 서버가 차례로 만듭니다 (한 번에 1개, 1분 영상 기준 보통 1~3분). 이 화면을 닫아도 계속 만들어집니다.
          음성은 OpenAI {d.tts.model} 로 만들고 비용은 서버의 API 키로 나갑니다. 목소리 · 자막 모양은 <b>설정 › 영상 설정</b>에서 바꿉니다 (지금: {V.speed}배속 · 배경 하나 {V.clipSeconds}초).</p>
      </section>
      {!chosen.length && <section className="panel"><p className="muted">만들 스크립트가 없습니다. ② 에서 스크립트를 고르고 ④ 제작 준비에서 배경을 넣어 주세요.</p></section>}
      {chosen.map(s => {
        const p = d.projects.find(x => x.script_id === s.id);
        const bgs = (p?.backgrounds || []).filter(id => d.assets.some(a => a.id === id));
        const music = p?.music_id && d.assets.find(a => a.id === p.music_id);
        const secs = estSeconds(s.script, V.speed), need = clipsNeeded(secs, V.clipSeconds);
        const list = d.renders.filter(r => r.script_id === s.id);
        const working = list.some(r => r.status === 'queued' || r.status === 'running');
        return (
          <section key={s.id} className={`panel sp-card ${list.some(r => r.status === 'done') ? 'done' : ''}`}>
            <div className="csum-h"><h2>{s.title}</h2>
              <span className={`tag ${bgs.length ? 'sh-ok' : ''}`}>배경 {bgs.length}개{bgs.length > 0 && bgs.length < need ? ' (반복)' : ''}</span>
              <span className={`tag ${music ? 'sh-ok' : ''}`}>{music ? `음악: ${music.name}` : '음악 없음'}</span>
              <span className="grow-r sr-act">
                <button className="btn sm" onClick={goPrep}>제작 준비</button>
                <button className="btn primary" disabled={!bgs.length || !d.render.ready || busy === `r${s.id}`}
                  onClick={() => act(`r${s.id}`, '/api/shorts/render', { scriptId: s.id }, '영상 만들기를 시작했습니다')}>{busy === `r${s.id}` ? '넣는 중…' : working ? '하나 더 만들기' : list.length ? '다시 만들기' : '영상 만들기'}</button>
              </span></div>
            <small className="muted">나레이션 약 {secs}초 예상 · 실제 길이는 목소리에 맞춰집니다{!bgs.length && ' · 배경을 먼저 넣어 주세요'}</small>
            {list.length > 0 && <div className="sr-list">{list.map(r => <RenderItem key={r.id} r={r} act={act} />)}</div>}
          </section>
        );
      })}
      {others.length > 0 && <section className="panel">
        <div className="csum-h"><h2>다른 영상</h2><span className="muted">스크립트를 바꾸거나 지운 뒤에도 남아 있는 영상</span></div>
        <div className="sr-list">{others.map(r => <RenderItem key={r.id} r={r} act={act} showTitle />)}</div>
      </section>}
    </>
  );
}

function RenderItem({ r, act, showTitle }) {
  const { sync } = useCtx();
  const full = u => `${sync.conf.url}${u}`;
  const del = () => window.confirm(r.status === 'running' ? '만드는 중인 영상을 멈추고 지울까요?' : '이 영상을 지울까요?') && act('', '/api/shorts/render/remove', { id: r.id }, '영상을 지웠습니다');
  return (
    <div className={`sr-item s-${r.status}`}>
      {r.status === 'done'
        ? <video className="sr-video" src={full(r.url)} poster={r.thumb ? full(r.thumb) : undefined} controls playsInline preload="none" />
        : <div className="sr-video sr-ph">{STATUS[r.status]}</div>}
      <div className="sr-meta">
        {showTitle && <b>{r.title}</b>}
        <span className={`tag ${r.status === 'done' ? 'sh-ok' : r.status === 'failed' ? 'sr-bad' : ''}`}>{STATUS[r.status]}</span>
        {r.status === 'queued' && <small className="muted">{r.ahead ? `앞에 ${r.ahead}개 기다리는 중` : '곧 시작합니다'}</small>}
        {r.status === 'running' && <>
          <div className="sr-bar" role="progressbar" aria-valuenow={r.progress} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${r.progress}%` }} /></div>
          <small className="muted">{r.stage} · {r.progress}%</small></>}
        {r.status === 'failed' && <small className="sh-err">{r.error}</small>}
        {r.status === 'done' && <small className="muted">{sec(r.duration)} · {mb(r.size_bytes)} · {dt(r.finished_at)}</small>}
        <small className="muted">요청 {dt(r.created_at)}</small>
        <span className="sr-btns">
          {r.status === 'done' && <a className="btn sm primary" href={`${full(r.url)}&dl=1`} download>내려받기</a>}
          <button className="tl-del" onClick={del}>{r.status === 'running' || r.status === 'queued' ? '취소' : '삭제'}</button>
        </span>
      </div>
    </div>
  );
}
