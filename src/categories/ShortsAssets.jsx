import React, { useEffect, useRef, useState } from 'react';
import { Popup, useCtx } from '../shared.jsx';
import { FONTS, MOODS, VOICES, autoPick, clipsNeeded, estSeconds, splitSubs } from '../../server/shortsText.mjs';

/* 숏폼 제작 2차 화면: ③ 소재함 (올리기 · Pexels 무료 소재) · ④ 제작 준비 (스크립트별 배경 · 음악) · 영상 설정 (자막 미리보기)
   서버: server/shortsAssets.mjs */
const KIND = { video: '영상', image: '이미지', music: '음악' };
const mb = n => (n >= 1073741824 ? `${(n / 1073741824).toFixed(1)}GB` : `${Math.max(0.1, n / 1048576).toFixed(1)}MB`);
const sec = n => (n == null ? '' : n >= 60 ? `${Math.floor(n / 60)}분 ${Math.round(n % 60)}초` : `${Math.round(n * 10) / 10}초`);
const fullUrl = (sync, u) => (u ? `${sync.conf.url}${u}` : '');

/* ── ③ 소재함 ── */
export function AssetLibrary({ d, act, busy, reload }) {
  const { sync } = useCtx();
  const [kind, setKind] = useState('ALL');
  const [q, setQ] = useState('');
  const [ups, setUps] = useState([]);                       // 올리는 중 [{ name, pct, err }]
  const [drag, setDrag] = useState(false);
  const [view, setView] = useState(null);
  const input = useRef(null);
  const clip = d.settings.video.clipSeconds;

  // 여러 파일을 차례로 올림 (진행률 표시, 로그인 토큰은 머리글로)
  const upload = async files => {
    const list = [...files];
    if (!list.length) return;
    setUps(list.map(f => ({ name: f.name, pct: 0, err: '' })));
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      const set = p => setUps(u => u.map((x, k) => (k === i ? { ...x, ...p } : x)));
      if (f.size > d.storage.maxUpload) { set({ err: `${mb(d.storage.maxUpload)} 까지 올릴 수 있습니다` }); continue; }
      await new Promise(resolve => {
        const x = new XMLHttpRequest();
        x.open('POST', `${sync.conf.url}/api/shorts/upload`);
        x.setRequestHeader('Authorization', `Bearer ${sync.conf.token}`);
        x.setRequestHeader('Content-Type', f.type || 'application/octet-stream');
        x.setRequestHeader('X-File-Name', encodeURIComponent(f.name));
        x.upload.onprogress = e => e.lengthComputable && set({ pct: Math.round(e.loaded / e.total * 100) });
        x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch { /* 무시 */ } set(x.status === 200 ? { pct: 100, done: true } : { err: j.error || `실패 (${x.status})` }); resolve(); };
        x.onerror = () => { set({ err: '서버에 연결하지 못했습니다' }); resolve(); };
        x.send(f);
      });
    }
    await reload();
    setTimeout(() => setUps(u => u.filter(x => x.err)), 2500);
  };
  const ql = q.trim().toLowerCase();
  const list = d.assets.filter(a => (kind === 'ALL' || a.kind === kind) && (!ql || `${a.name} ${a.tags} ${a.credit}`.toLowerCase().includes(ql)));
  const cnt = k => d.assets.filter(a => a.kind === k).length;
  return (
    <>
      <section className={`panel sa-drop ${drag ? 'on' : ''}`} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files); }}>
        <div className="sa-dz">
          <b>배경 영상 · 이미지 · 음악을 여기에 끌어다 놓으세요</b>
          <span className="muted">여러 개를 한 번에 올릴 수 있습니다 · 파일 하나 {mb(d.storage.maxUpload)} 까지 · mp4 · mov · webm / jpg · png · webp / mp3 · m4a · wav</span>
          <button className="btn primary" onClick={() => input.current?.click()}>파일 고르기</button>
          <input ref={input} type="file" multiple hidden accept="video/*,image/*,audio/*,.mp3,.m4a,.wav,.mov" onChange={e => { upload(e.target.files); e.target.value = ''; }} />
        </div>
        {ups.length > 0 && <ul className="sa-ups">{ups.map((u, i) => (
          <li key={i} className={u.err ? 'err' : u.done ? 'done' : ''}><span>{u.name}</span>{u.err ? <small>{u.err}</small> : <span className="pbar"><i style={{ width: `${u.pct}%` }} /></span>}<small>{u.err ? '' : u.done ? '완료' : `${u.pct}%`}</small></li>))}</ul>}
        <div className="sa-use"><span className="muted">저장 공간 {mb(d.storage.used)} / {mb(d.storage.quota)}</span><span className="pbar"><i style={{ width: `${Math.min(100, d.storage.used / d.storage.quota * 100)}%` }} /></span>
          {!d.storage.ffmpeg && <small className="sh-err">서버에 ffmpeg 가 없어 길이 · 미리보기를 못 읽습니다 (update.sh 다시 실행)</small>}</div>
      </section>

      <PexelsPanel d={d} act={act} busy={busy} />

      <section className="panel">
        <div className="csum-h"><h2>소재함</h2>
          <div className="chips" role="group" aria-label="종류">{[['ALL', `전체 ${d.assets.length}`], ['video', `영상 ${cnt('video')}`], ['image', `이미지 ${cnt('image')}`], ['music', `음악 ${cnt('music')}`]].map(([k, n]) => <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)}>{n}</button>)}</div>
          <input type="search" className="sh-q" value={q} onChange={e => setQ(e.target.value)} placeholder="이름 · 태그 검색" aria-label="소재 검색" /></div>
        {list.length ? <div className="sa-grid">{list.map(a => <AssetCard key={a.id} a={a} clip={clip} act={act} onView={() => setView(a)} />)}</div>
          : <p className="muted">{d.assets.length ? '조건에 맞는 소재가 없습니다.' : '아직 소재가 없습니다. 위에 파일을 끌어다 놓거나 Pexels 에서 무료 소재를 담으세요.'}</p>}
        <p className="note">태그에 분위기(예: {MOODS.slice(0, 4).join(' · ')})나 주제를 적어 두면 ④ 제작 준비의 "자동 고르기"가 스크립트에 맞는 소재를 먼저 고릅니다. 가로 영상은 세로 화면에 맞게 잘리거나(꽉 채우기) 위아래가 흐린 배경으로 채워집니다(영상 설정).</p>
      </section>
      {view && <Popup title={view.name || KIND[view.kind]} sub={`${KIND[view.kind]}${view.width ? ` · ${view.width}×${view.height}` : ''}${view.duration ? ` · ${sec(view.duration)}` : ''} · ${mb(view.size_bytes)}`} onClose={() => setView(null)}>
        {view.kind === 'video' ? <video className="sa-big" src={fullUrl(sync, view.url)} controls autoPlay muted playsInline loop />
          : view.kind === 'image' ? <img className="sa-big" src={fullUrl(sync, view.url)} alt={view.name} />
            : <audio src={fullUrl(sync, view.url)} controls autoPlay />}
        {view.credit && <p className="note">출처: {view.source === 'pexels' ? 'Pexels' : ''} · {view.credit}{view.source_url && <> · <a href={view.source_url} target="_blank" rel="noreferrer">원본</a></>}</p>}
      </Popup>}
    </>
  );
}

function AssetCard({ a, clip, act, onView }) {
  const { sync } = useCtx();
  const [tags, setTags] = useState(a.tags);
  useEffect(() => setTags(a.tags), [a.tags]);
  const vertical = a.width && a.height ? a.height > a.width : null;
  return (
    <div className={`sa-card k-${a.kind}`}>
      <button className="sa-th" onClick={onView} aria-label={`${a.name} 미리보기`}>
        {a.thumb ? <img src={fullUrl(sync, a.thumb)} alt="" loading="lazy" /> : <span className="sa-ic">{a.kind === 'music' ? '♪' : KIND[a.kind]}</span>}
        {a.duration != null && <em>{sec(a.duration)}</em>}
      </button>
      <div className="sa-meta">
        <b title={a.name}>{a.name || KIND[a.kind]}</b>
        <span className="sa-badges"><span className="tag">{KIND[a.kind]}</span>
          {vertical === true && <span className="tag sa-v">세로</span>}{vertical === false && <span className="tag sa-h" title="세로 화면에 맞게 잘리거나 흐린 배경이 들어갑니다">가로</span>}
          {a.kind === 'video' && a.duration != null && a.duration < clip && <span className="tag sa-h" title={`배경 하나 ${clip}초보다 짧아 반복됩니다`}>짧음</span>}
          {a.source === 'pexels' && <span className="tag" title={`촬영 ${a.credit}`}>Pexels</span>}</span>
        <input value={tags} onChange={e => setTags(e.target.value)} onBlur={() => tags !== a.tags && act('', '/api/shorts/asset', { id: a.id, tags })} placeholder="태그 (예: 잔잔 사무실)" aria-label={`${a.name} 태그`} />
        <span className="sa-foot"><small className="muted">{a.width ? `${a.width}×${a.height} · ` : ''}{mb(a.size_bytes)}</small>
          <button className="tl-del" onClick={() => window.confirm(`"${a.name}" 소재를 지울까요? (제작 준비에서도 빠집니다)`) && act('', '/api/shorts/asset', { id: a.id, remove: true }, '소재를 지웠습니다')}>삭제</button></span>
      </div>
    </div>
  );
}

/* Pexels 무료 소재 검색 · 담기 */
function PexelsPanel({ d, act, busy }) {
  const { sync } = useCtx();
  const [q, setQ] = useState('');
  const [type, setType] = useState('video');
  const [res, setRes] = useState(null);
  const [page, setPage] = useState(1);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState({});
  const search = async (p = 1, query = q) => {
    if (!query.trim()) return;
    setErr(''); setPage(p);
    try { const r = await sync.request('/api/shorts/pexels', { method: 'POST', body: { query, type, page: p } }); setRes(p === 1 ? r : { ...r, items: [...(res?.items || []), ...r.items] }); }
    catch (e) { setErr(e.message); }
  };
  const kws = [...new Set(d.projects.flatMap(p => p.keywords.split(',').map(x => x.trim()).filter(Boolean)))].slice(0, 10);
  return (
    <section className="panel">
      <div className="csum-h"><h2>무료 소재 찾기 (Pexels)</h2><span className="muted">상업적 사용 가능 · 출처 표시는 권장</span>
        <button className="btn sm grow-r" onClick={() => setOpen(v => !v)} aria-expanded={open}>{open ? '접기' : '열기'}</button></div>
      {open && (!d.pexels.ready
        ? <p className="note">Pexels API 키가 서버에 없습니다. <a href="https://www.pexels.com/api/" target="_blank" rel="noreferrer">pexels.com/api</a> 에서 무료로 키를 받고, VPS 터미널에서 <code>jcal-admin pexels-key</code> 로 넣어 주세요.</p>
        : <>
          <form className="sa-px" onSubmit={e => { e.preventDefault(); search(1); }}>
            <div className="chips" role="group" aria-label="종류">{[['video', '세로 영상'], ['image', '세로 사진']].map(([k, n]) => <button type="button" key={k} aria-pressed={type === k} onClick={() => { setType(k); setRes(null); }}>{n}</button>)}</div>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="영어 검색어가 잘 찾아집니다 (예: office desk, rainy street)" aria-label="Pexels 검색어" />
            <button className="btn primary" disabled={!q.trim()}>검색</button>
          </form>
          {kws.length > 0 && <p className="sa-kws"><span className="muted">스크립트 추천 검색어:</span>{kws.map(k => <button key={k} type="button" className="chip-s" onClick={() => { setQ(k); search(1, k); }}>{k}</button>)}</p>}
          {err && <p className="banner">{err}</p>}
          {res && (res.items.length ? <>
            <div className="sa-grid sa-pgrid">{res.items.map(it => (
              <div key={it.id} className="sa-card">
                <a className="sa-th" href={it.page} target="_blank" rel="noreferrer" title="Pexels 에서 보기"><img src={it.thumb} alt="" loading="lazy" />{it.duration != null && <em>{sec(it.duration)}</em>}</a>
                <div className="sa-meta"><small className="muted">{it.width}×{it.height} · {it.credit}</small>
                  <button className="btn sm" disabled={!!busy || saved[it.id]} onClick={async () => { const r = await act(`px${it.id}`, '/api/shorts/pexels/save', { id: it.id, type: it.type, query: q }, '소재함에 담았습니다'); if (r) setSaved(s => ({ ...s, [it.id]: true })); }}>
                    {busy === `px${it.id}` ? '담는 중…' : saved[it.id] ? '담음' : '소재함에 담기'}</button></div>
              </div>))}</div>
            {res.items.length < res.total && <button className="btn sm" onClick={() => search(page + 1)}>더 보기</button>}
            <p className="note">결과 {res.total.toLocaleString()}개 · 사진 · 영상 제공 <a href="https://www.pexels.com" target="_blank" rel="noreferrer">Pexels</a></p>
          </> : <p className="muted">결과가 없습니다. 다른 (영어) 검색어로 찾아 보세요.</p>)}
        </>)}
    </section>
  );
}

/* ── ④ 제작 준비: 고른 스크립트마다 배경 · 음악 ── */
export function Prep({ d, act, busy, goScripts, goAssets, goRender }) {
  const chosen = d.scripts.filter(s => s.chosen && d.items.some(i => i.id === s.item_id && i.status === 'picked'));
  if (!chosen.length) return <section className="panel"><p className="muted">제작할 스크립트가 없습니다. <button className="linkish" onClick={goScripts}>② 고른 글 · 스크립트</button>에서 "이 스크립트로 제작"을 골라 주세요.</p></section>;
  return chosen.map(s => <PrepCard key={s.id} s={s} d={d} act={act} busy={busy} goAssets={goAssets} goRender={goRender} />);
}
function PrepCard({ s, d, act, busy, goAssets, goRender }) {
  const { sync } = useCtx();
  const V = d.settings.video;
  const p = d.projects.find(x => x.script_id === s.id) || { backgrounds: [], music_id: null, keywords: '', mood: '' };
  const byId = Object.fromEntries(d.assets.map(a => [a.id, a]));
  const secs = estSeconds(s.script, V.speed), need = clipsNeeded(secs, V.clipSeconds);
  const bgs = p.backgrounds.filter(id => byId[id]);
  const music = d.assets.filter(a => a.kind === 'music');
  const [pick, setPick] = useState(false);
  const save = patch => act('', '/api/shorts/project', { scriptId: s.id, ...patch });
  const move = (i, dir) => { const b = [...bgs]; const j = i + dir; if (j < 0 || j >= b.length) return; [b[i], b[j]] = [b[j], b[i]]; save({ backgrounds: b }); };
  const auto = () => { const r = autoPick(d.assets, { need, keywords: p.keywords, mood: p.mood, clipSeconds: V.clipSeconds }); save({ backgrounds: r.backgrounds, ...(r.musicId ? { musicId: r.musicId } : {}) }); };
  return (
    <section className={`panel sp-card ${bgs.length >= need && p.music_id ? 'done' : ''}`}>
      <div className="csum-h"><h2>{s.title}</h2>
        <span className={`tag ${bgs.length >= need ? 'sh-ok' : ''}`}>배경 {bgs.length}/{need}</span><span className={`tag ${p.music_id ? 'sh-ok' : ''}`}>{p.music_id ? '음악 있음' : '음악 없음'}</span></div>
      <small className="muted">나레이션 약 {secs}초 (추정 · {V.speed}배속) · 배경 하나 {V.clipSeconds}초 → 배경 {need}개 필요 · 영상을 만들 때 실제 목소리 길이로 맞춥니다</small>
      <div className="sp-kw">
        <label>소재 검색어<input defaultValue={p.keywords} key={p.keywords} onBlur={e => e.target.value !== p.keywords && save({ keywords: e.target.value })} placeholder="예: office desk, meeting room" /></label>
        <label>분위기<select value={p.mood} onChange={e => save({ mood: e.target.value })}><option value="">-</option>{MOODS.map(m => <option key={m}>{m}</option>)}</select></label>
        <button className="btn sm" disabled={!d.ai.ready || !!busy} onClick={() => act(`kw${s.id}`, '/api/shorts/keywords', { scriptId: s.id }, r => `추천 검색어: ${r.keywords} · 분위기 ${r.mood || '-'}`)}>{busy === `kw${s.id}` ? 'AI 추천 중…' : 'AI 로 검색어 · 분위기 추천'}</button>
      </div>
      <div className="sp-bgs">
        {bgs.map((id, i) => { const a = byId[id]; return (
          <div key={`${id}-${i}`} className="sp-bg">
            <span className="sp-n">{i + 1}</span>
            {a.thumb ? <img src={fullUrl(sync, a.thumb)} alt="" /> : <span className="sa-ic">{a.kind === 'image' ? '이미지' : '영상'}</span>}
            <span className="sp-ctl"><button onClick={() => move(i, -1)} disabled={i === 0} aria-label="앞으로">‹</button><button onClick={() => save({ backgrounds: bgs.filter((_, k) => k !== i) })} aria-label="빼기">×</button><button onClick={() => move(i, 1)} disabled={i === bgs.length - 1} aria-label="뒤로">›</button></span>
          </div>); })}
        <button className="sp-add" onClick={() => setPick(true)}>+ 배경 넣기</button>
      </div>
      <div className="sp-row">
        <button className="btn primary" disabled={!d.assets.some(a => a.kind !== 'music')} onClick={auto} title="검색어 · 분위기와 맞는 태그의 소재를 먼저, 모자라면 나머지에서 고릅니다">자동 고르기 ({need}개 + 음악)</button>
        {bgs.length > 0 && <button className="btn" onClick={() => save({ backgrounds: [] })}>배경 비우기</button>}
        <label className="sp-music">배경음악<select value={p.music_id || ''} onChange={e => save({ musicId: e.target.value || null })}><option value="">없음</option>{music.map(m => <option key={m.id} value={m.id}>{m.name}{m.tags ? ` (${m.tags})` : ''}{m.duration ? ` · ${sec(m.duration)}` : ''}</option>)}</select></label>
        {!d.assets.length && <button className="linkish" onClick={goAssets}>소재함이 비어 있습니다 › 소재 올리기</button>}
        {bgs.length > 0 && goRender && <button className="btn sm grow-r" onClick={goRender}>⑤ 영상 만들기 ›</button>}
      </div>
      {bgs.length > 0 && bgs.length < need && <p className="note">배경이 {need - bgs.length}개 모자랍니다. 그대로 두면 영상을 만들 때 처음부터 다시 돌려 씁니다.</p>}
      {pick && <Popup wide title="배경 넣기" sub="누르는 순서대로 뒤에 붙습니다 (같은 소재를 여러 번 넣어도 됩니다)" onClose={() => setPick(false)}>
        <div className="sa-grid">{d.assets.filter(a => a.kind !== 'music').map(a => (
          <button key={a.id} className="sa-card sp-pick" onClick={() => save({ backgrounds: [...bgs, a.id] })}>
            <span className="sa-th">{a.thumb ? <img src={fullUrl(sync, a.thumb)} alt="" /> : <span className="sa-ic">{a.kind === 'image' ? '이미지' : '영상'}</span>}{a.duration != null && <em>{sec(a.duration)}</em>}</span>
            <span className="sa-meta"><b>{a.name}</b><small className="muted">{a.tags || '태그 없음'} · {bgs.filter(x => x === a.id).length ? `${bgs.filter(x => x === a.id).length}번 넣음` : '넣기'}</small></span>
          </button>))}</div>
        {!d.assets.some(a => a.kind !== 'music') && <p className="muted">소재함에 영상 · 이미지가 없습니다.</p>}
      </Popup>}
    </section>
  );
}

/* ── 영상 설정 + 자막 미리보기 ── */
export function VideoSettings({ d, act, busy }) {
  const { sync } = useCtx();
  const [v, setV] = useState(d.settings.video);
  useEffect(() => {                                          // 미리보기용 글꼴 (Google Fonts)
    const id = 'shorts-fonts';
    if (document.getElementById(id)) return;
    const l = document.createElement('link');
    l.id = id; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Do+Hyeon&family=Jua&family=Nanum+Gothic:wght@400;800&family=Nanum+Myeongjo:wght@400;800&family=Nanum+Pen+Script&family=Noto+Sans+KR:wght@700;900&display=swap';
    document.head.appendChild(l);
  }, []);
  const S = v.sub, setS = p => setV(x => ({ ...x, sub: { ...x.sub, ...p } }));
  const dirty = JSON.stringify(v) !== JSON.stringify(d.settings.video);
  const sample = d.scripts.find(s => s.chosen) || d.scripts[0];
  const screens = splitSubs(sample?.script || '여러분 이거 실화입니다. 회의 중에 팀장님이 갑자기 이런 말을 했어요. 여러분이라면 어떻게 하시겠어요?', S.lineChars, S.maxLines);
  const [n, setN] = useState(0);
  const bg = d.assets.find(a => a.thumb && a.kind !== 'music');
  const scale = 270 / 1080;                                   // 미리보기 너비 270px = 실제 1080px
  const hexA = (h, a) => `rgba(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)}, ${a / 100})`;
  const lines = screens[n % Math.max(1, screens.length)] || [];
  return (
    <section className="panel">
      <div className="csum-h"><h2>영상 설정</h2><span className="muted">1080×1920 세로 · 3차(영상 만들기)에 그대로 쓰입니다</span></div>
      <div className="vs">
        <div className="vs-form">
          <h3>배경</h3>
          <label>배경 하나가 나오는 시간<span className="sh-num"><input type="number" step="0.5" min="1.5" max="20" value={v.clipSeconds} onChange={e => setV({ ...v, clipSeconds: e.target.value })} />초</span>
            <small className="muted">60초 영상이면 배경 약 {Math.ceil(60 / (Number(v.clipSeconds) || 4))}개가 바뀝니다 (전환 수)</small></label>
          <label>세로 화면 맞추기<select value={v.fit} onChange={e => setV({ ...v, fit: e.target.value })}><option value="cover">꽉 채우기 (넘치는 부분 자름)</option><option value="blur">전체 보이기 (빈 곳은 흐린 배경)</option></select></label>
          <h3>목소리 · 음악</h3>
          <label>나레이션 목소리<select value={v.voice} onChange={e => setV({ ...v, voice: e.target.value })}>{VOICES.map(([k, n2]) => <option key={k} value={k}>{n2}</option>)}</select><VoiceTry d={d} voice={v.voice} speed={Number(v.speed) || 1} /></label>
          <label>말 빠르기<span className="sh-num"><input type="number" step="0.05" min="0.7" max="1.5" value={v.speed} onChange={e => setV({ ...v, speed: e.target.value })} />배</span></label>
          <label>배경음악 크기<span className="sh-num"><input type="range" min="0" max="60" value={v.musicVolume} onChange={e => setV({ ...v, musicVolume: Number(e.target.value) })} />{v.musicVolume}%</span><small className="muted">나레이션이 나올 때는 자동으로 더 작아집니다</small></label>
          <label className="sh-chk"><input type="checkbox" checked={v.showTitle} onChange={e => setV({ ...v, showTitle: e.target.checked })} />화면 위에 제목 고정</label>
          <h3>자막</h3>
          <div className="vs-2">
            <label>글꼴<select value={S.font} onChange={e => setS({ font: e.target.value })}>{FONTS.map(([k, n2]) => <option key={k} value={k}>{n2}</option>)}</select></label>
            <label>크기<span className="sh-num"><input type="number" min="36" max="120" value={S.size} onChange={e => setS({ size: e.target.value })} />px</span></label>
            <label>글자색<input type="color" value={S.color} onChange={e => setS({ color: e.target.value.toUpperCase() })} /></label>
            <label>강조색<input type="color" value={S.highlight} onChange={e => setS({ highlight: e.target.value.toUpperCase() })} /></label>
            <label>테두리색<input type="color" value={S.stroke} onChange={e => setS({ stroke: e.target.value.toUpperCase() })} /></label>
            <label>테두리 두께<span className="sh-num"><input type="number" min="0" max="16" value={S.strokeWidth} onChange={e => setS({ strokeWidth: e.target.value })} />px</span></label>
            <label>한 줄 글자 수<span className="sh-num"><input type="number" min="6" max="30" value={S.lineChars} onChange={e => setS({ lineChars: e.target.value })} />자</span></label>
            <label>한 화면 줄 수<select value={S.maxLines} onChange={e => setS({ maxLines: Number(e.target.value) })}>{[1, 2, 3].map(k => <option key={k} value={k}>{k}줄</option>)}</select></label>
            <label>위치<select value={S.position} onChange={e => setS({ position: e.target.value })}><option value="top">위</option><option value="middle">가운데</option><option value="bottom">아래</option></select></label>
            <label className="sh-chk"><input type="checkbox" checked={S.box} onChange={e => setS({ box: e.target.checked })} />글자 뒤 상자</label>
            {S.box && <label>상자색 · 진하기<span className="sh-num"><input type="color" value={S.boxColor} onChange={e => setS({ boxColor: e.target.value.toUpperCase() })} /><input type="number" min="0" max="100" value={S.boxOpacity} onChange={e => setS({ boxOpacity: e.target.value })} />%</span></label>}
          </div>
          <div className="btns"><button className="btn primary" disabled={!dirty || !!busy} onClick={() => act('vset', '/api/shorts/settings', { video: v }, '영상 설정을 저장했습니다')}>저장</button>
            {dirty && <button className="btn" onClick={() => setV(d.settings.video)}>되돌리기</button>}</div>
        </div>
        <div className="vs-prev">
          <div className="vs-phone" style={{ backgroundImage: bg ? `url(${fullUrl(sync, bg.thumb)})` : undefined, backgroundSize: v.fit === 'cover' ? 'cover' : 'contain' }}>
            {v.fit === 'blur' && bg && <div className="vs-blur" style={{ backgroundImage: `url(${fullUrl(sync, bg.thumb)})` }} />}
            {v.showTitle && sample && <div className="vs-title" style={{ fontFamily: `'${S.font}', sans-serif` }}>{sample.title}</div>}
            <div className={`vs-sub p-${S.position}`}>
              {lines.map((l, i) => (
                <span key={i} style={{ fontFamily: `'${S.font}', sans-serif`, fontSize: S.size * scale, color: S.color, WebkitTextStroke: `${S.strokeWidth * scale}px ${S.stroke}`, paintOrder: 'stroke fill',
                  background: S.box ? hexA(S.boxColor, S.boxOpacity) : 'none' }}>
                  {i === lines.length - 1 && l.split(' ').length > 1 ? <>{l.split(' ').slice(0, -1).join(' ')} <b style={{ color: S.highlight }}>{l.split(' ').slice(-1)}</b></> : l}
                </span>))}
            </div>
          </div>
          <div className="vs-nav"><button className="btn sm" onClick={() => setN(x => (x - 1 + screens.length) % screens.length)}>‹</button><small className="muted">자막 화면 {(n % screens.length) + 1}/{screens.length}</small><button className="btn sm" onClick={() => setN(x => (x + 1) % screens.length)}>›</button></div>
          <p className="note">미리보기는 화면 비율만 맞춘 모습입니다. 강조색은 영상에서 지금 읽는 낱말에 칠해집니다.</p>
        </div>
      </div>
    </section>
  );
}

/** 목소리 들어 보기 (짧은 예문, 서버가 한 번 만든 예문은 저장해 두고 다시 씀) */
function VoiceTry({ d, voice, speed }) {
  const { sync } = useCtx();
  const [st, setSt] = useState('');
  const audio = useRef(null);
  useEffect(() => () => audio.current?.pause(), []);
  const play = async () => {
    audio.current?.pause();
    setSt('…');
    try {
      const r = await sync.request('/api/shorts/voice', { method: 'POST', body: { voice } });
      const a = new Audio(r.audio);
      a.playbackRate = speed;                                  // 말 빠르기도 비슷하게 들려 줌
      audio.current = a;
      a.onended = () => setSt('');
      await a.play();
      setSt('▶');
    } catch (e) { setSt(e.message || '재생하지 못했습니다'); }
  };
  if (!d.tts) return <small className="muted">ChatGPT(OpenAI) 음성 · 서버를 업데이트하면 들어 볼 수 있습니다</small>;
  return (
    <span className="vs-try">
      <button type="button" className="btn sm" disabled={!d.tts.ready || st === '…'} onClick={play}>{st === '…' ? '불러오는 중…' : '들어 보기'}</button>
      <small className={st && st.length > 1 ? 'sh-err' : 'muted'}>{st && st.length > 1 ? st : d.tts.ready ? `OpenAI ${d.tts.model}` : 'OpenAI 키가 없습니다 (jcal-admin ai-key)'}</small>
    </span>
  );
}
