/* 숏폼 제작 4차 — 유튜브 쇼츠 · 인스타그램 릴스 연결 · 업로드(예약) · 성과 가져오기 (db/migrations/008_shorts_social.sql)
   POST /api/shorts/social/connect     {platform}                         연결 주소(OAuth) 받기 → 새 창에서 로그인 · 허용
   GET  /api/oauth/youtube/callback · /api/oauth/instagram/callback       로그인 뒤 돌아오는 주소 (토큰 저장 → 창 닫기)
   POST /api/shorts/social/disconnect  {platform}                         연결 끊기
   GET  /api/shorts/social                                                연결 · 업로드 목록 (진행률 확인용)
   POST /api/shorts/post   {renderId, platforms, title, caption, privacy, scheduledAt?}   올리기 (지금 · 예약)
   POST /api/shorts/post/action {id, action: cancel | retry | remove}    예약 취소 · 다시 시도 · 목록에서 빼기 (플랫폼의 영상은 그대로)
   POST /api/shorts/stats  {id?}                                          성과(조회 · 좋아요 · 댓글 …) 지금 가져오기
   - 키: YOUTUBE_CLIENT_ID · YOUTUBE_CLIENT_SECRET (Google Cloud OAuth), INSTAGRAM_APP_ID · INSTAGRAM_APP_SECRET (Meta 앱, Instagram 로그인)
     → jcal-admin youtube-key · instagram-key. 돌아오는 주소는 PUBLIC_URL 또는 https://API_HOST
   - 토큰은 DB 에 AES-256-GCM 으로 암호화해 저장. 업로드는 한 번에 1개, 성과는 1시간마다 확인(올린 지 오래될수록 드물게) */
import fs from 'fs';
import crypto from 'crypto';
import { SECRET, fileUrl, renderPath, RAW } from './shortsAssets.mjs';

const env = process.env;
export const PLATFORMS = ['youtube', 'instagram'];
const NAME = { youtube: '유튜브', instagram: '인스타그램' };
const T = env.SOCIAL_TEST_BASE;                                 // 시험: 바깥 주소를 모두 가짜 서버로
const IGV = env.IG_API_VERSION || 'v23.0';
const EP = {
  gAuth: T ? `${T}/google/auth` : 'https://accounts.google.com/o/oauth2/v2/auth',
  gToken: T ? `${T}/google/token` : 'https://oauth2.googleapis.com/token',
  gRevoke: T ? `${T}/google/revoke` : 'https://oauth2.googleapis.com/revoke',
  yt: T ? `${T}/youtube/v3` : 'https://www.googleapis.com/youtube/v3',
  ytUp: T ? `${T}/upload/youtube/v3/videos` : 'https://www.googleapis.com/upload/youtube/v3/videos',
  igAuth: T ? `${T}/ig/oauth/authorize` : 'https://www.instagram.com/oauth/authorize',
  igToken: T ? `${T}/ig/oauth/access_token` : 'https://api.instagram.com/oauth/access_token',
  ig: T ? `${T}/graph` : 'https://graph.instagram.com',
};
export const socialReady = {
  youtube: () => !!(env.YOUTUBE_CLIENT_ID && env.YOUTUBE_CLIENT_SECRET),
  instagram: () => !!(env.INSTAGRAM_APP_ID && env.INSTAGRAM_APP_SECRET),
};
export const publicBase = () => (env.PUBLIC_URL || (env.API_HOST ? `https://${env.API_HOST}` : `http://127.0.0.1:${env.PORT || 8787}`)).replace(/\/+$/, '');
const callbackUrl = p => `${publicBase()}/api/oauth/${p}/callback`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const POLL = Number(env.IG_POLL_MS) || 5000;                  // 인스타그램 처리 상태 확인 간격
class SocialError extends Error { constructor(msg, status = 400) { super(msg); this.status = status; } }

/* ── 토큰 암호화 ── */
const KEY = crypto.createHash('sha256').update(`jcal-social|${SECRET}`).digest();
const enc = s => { if (!s) return ''; const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', KEY, iv); const ct = Buffer.concat([c.update(String(s), 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64'); };
const dec = s => { if (!s) return ''; try { const b = Buffer.from(s, 'base64'), d = crypto.createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); } catch { return ''; } };

/* ── OAuth state (누가 · 어느 화면에서 · 10분 안에) ── */
const stateOf = (uid, platform, origin) => { const body = Buffer.from(JSON.stringify({ u: uid, p: platform, o: origin, e: Date.now() + 10 * 60000, n: crypto.randomBytes(6).toString('hex') })).toString('base64url'); return `${body}.${crypto.createHmac('sha256', SECRET).update(`oauth|${body}`).digest('base64url')}`; };
function readState(s, platform) {
  const [body, sig] = String(s || '').split('.');
  const good = body && crypto.createHmac('sha256', SECRET).update(`oauth|${body}`).digest('base64url');
  if (!good || !sig || sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try { const j = JSON.parse(Buffer.from(body, 'base64url').toString()); return j.p === platform && j.e > Date.now() ? j : null; } catch { return null; }
}

/* ── HTTP ── */
async function req(url, opts = {}, what = '') {
  let r;
  try { r = await fetch(url, { ...opts, signal: AbortSignal.timeout(opts.timeout || 60000) }); }
  catch (e) { throw new SocialError(`${what || '서버'}에 연결하지 못했습니다${e.name === 'TimeoutError' ? ' (시간 초과)' : ''}`, 502); }
  const text = await r.text();
  let j = {};
  try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text.slice(0, 300) }; }
  return { r, j };
}
const form = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== ''));
const gErr = j => j.error?.errors?.[0]?.reason || j.error?.status || (typeof j.error === 'string' ? j.error : '') || '';
const gMsg = j => j.error?.message || j.error_description || '';

/* ── 계정 저장 · 토큰 ── */
async function saveChannel(pool, uid, platform, c) {
  await pool.query(`INSERT INTO jcal.shorts_channels (user_id, platform, account_id, account_name, account_url, access_token, refresh_token, expires_at, error, connected_at, refreshed_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '', now(), now())
    ON CONFLICT (user_id, platform) DO UPDATE SET account_id = EXCLUDED.account_id, account_name = EXCLUDED.account_name, account_url = EXCLUDED.account_url,
      access_token = EXCLUDED.access_token, refresh_token = CASE WHEN EXCLUDED.refresh_token = '' THEN jcal.shorts_channels.refresh_token ELSE EXCLUDED.refresh_token END,
      expires_at = EXCLUDED.expires_at, error = '', connected_at = now(), refreshed_at = now()`,
  [uid, platform, c.id, c.name, c.url, enc(c.access), enc(c.refresh || ''), c.expiresAt]);
}
const channelOf = async (pool, uid, platform) => (await pool.query('SELECT * FROM jcal.shorts_channels WHERE user_id = $1 AND platform = $2', [uid, platform])).rows[0] || null;
const broken = (pool, ch, msg) => pool.query('UPDATE jcal.shorts_channels SET error = $3 WHERE user_id = $1 AND platform = $2', [ch.user_id, ch.platform, msg]);

/** 유튜브: 1시간짜리 access token 을 refresh token 으로 새로 받음 */
async function googleAccess(pool, ch) {
  if (ch.expires_at && new Date(ch.expires_at).getTime() > Date.now() + 90000) return dec(ch.access_token);
  const { r, j } = await req(EP.gToken, { method: 'POST', body: form({ client_id: env.YOUTUBE_CLIENT_ID, client_secret: env.YOUTUBE_CLIENT_SECRET, refresh_token: dec(ch.refresh_token), grant_type: 'refresh_token' }) }, 'Google');
  if (!r.ok || !j.access_token) {
    const msg = j.error === 'invalid_grant' ? '유튜브 연결이 만료되었습니다. 업로드 › 계정 연결에서 다시 연결해 주세요 (Google Cloud 의 OAuth 앱이 "테스트" 상태면 7일마다 만료)' : `유튜브 토큰을 새로 받지 못했습니다 (${j.error || r.status})`;
    await broken(pool, ch, msg); throw new SocialError(msg, 401);
  }
  await pool.query('UPDATE jcal.shorts_channels SET access_token = $3, expires_at = $4, refreshed_at = now(), error = \'\' WHERE user_id = $1 AND platform = $2',
    [ch.user_id, ch.platform, enc(j.access_token), new Date(Date.now() + (Number(j.expires_in) || 3600) * 1000)]);
  return j.access_token;
}
/** 인스타그램: 60일짜리 토큰. 20일보다 적게 남으면 새로 받음 (발급 24시간 뒤부터 가능) */
async function igAccess(pool, ch, force = false) {
  const tok = dec(ch.access_token);
  const left = ch.expires_at ? new Date(ch.expires_at).getTime() - Date.now() : 0;
  if (left < 0) { const msg = '인스타그램 연결이 만료되었습니다. 다시 연결해 주세요'; await broken(pool, ch, msg); throw new SocialError(msg, 401); }
  if ((force || left < 20 * 86400000) && Date.now() - new Date(ch.refreshed_at).getTime() > 86400000) {
    const { r, j } = await req(`${EP.ig}/refresh_access_token?${form({ grant_type: 'ig_refresh_token', access_token: tok })}`, {}, 'Instagram');
    if (r.ok && j.access_token) {
      await pool.query('UPDATE jcal.shorts_channels SET access_token = $3, expires_at = $4, refreshed_at = now(), error = \'\' WHERE user_id = $1 AND platform = $2',
        [ch.user_id, ch.platform, enc(j.access_token), new Date(Date.now() + (Number(j.expires_in) || 5184000) * 1000)]);
      return j.access_token;
    }
  }
  return tok;
}

/* ── 연결 (OAuth) ── */
function authUrl(platform, state) {
  if (platform === 'youtube') return `${EP.gAuth}?${form({ client_id: env.YOUTUBE_CLIENT_ID, redirect_uri: callbackUrl('youtube'), response_type: 'code', access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
    scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly' })}`;
  return `${EP.igAuth}?${form({ client_id: env.INSTAGRAM_APP_ID, redirect_uri: callbackUrl('instagram'), response_type: 'code', state,
    scope: 'instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights' })}`;
}
async function finishYoutube(code) {
  const { r, j } = await req(EP.gToken, { method: 'POST', body: form({ code, client_id: env.YOUTUBE_CLIENT_ID, client_secret: env.YOUTUBE_CLIENT_SECRET, redirect_uri: callbackUrl('youtube'), grant_type: 'authorization_code' }) }, 'Google');
  if (!r.ok || !j.access_token) throw new SocialError(`Google 로그인 확인 실패 (${j.error_description || j.error || r.status})`);
  if (!j.refresh_token) throw new SocialError('Google 이 갱신 토큰을 주지 않았습니다. myaccount.google.com › 보안 › 타사 앱 에서 이 앱 접근을 지운 뒤 다시 연결해 주세요');
  const c = await req(`${EP.yt}/channels?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${j.access_token}` } }, 'YouTube');
  const it = c.j.items?.[0];
  if (!c.r.ok) throw new SocialError(`유튜브 채널을 읽지 못했습니다 (${gMsg(c.j) || c.r.status})`);
  if (!it) throw new SocialError('이 구글 계정에 유튜브 채널이 없습니다. youtube.com 에서 채널을 먼저 만들어 주세요');
  return { id: it.id, name: it.snippet?.title || '', url: it.snippet?.customUrl ? `https://www.youtube.com/${it.snippet.customUrl}` : `https://www.youtube.com/channel/${it.id}`,
    access: j.access_token, refresh: j.refresh_token, expiresAt: new Date(Date.now() + (Number(j.expires_in) || 3600) * 1000) };
}
async function finishInstagram(code) {
  const a = await req(EP.igToken, { method: 'POST', body: form({ client_id: env.INSTAGRAM_APP_ID, client_secret: env.INSTAGRAM_APP_SECRET, grant_type: 'authorization_code', redirect_uri: callbackUrl('instagram'), code: code.replace(/#_$/, '') }) }, 'Instagram');
  const short = a.j.access_token || a.j.data?.[0]?.access_token;
  if (!a.r.ok || !short) throw new SocialError(`인스타그램 로그인 확인 실패 (${a.j.error_message || a.j.error?.message || a.r.status})`);
  const l = await req(`${EP.ig}/access_token?${form({ grant_type: 'ig_exchange_token', client_secret: env.INSTAGRAM_APP_SECRET, access_token: short })}`, {}, 'Instagram');
  if (!l.r.ok || !l.j.access_token) throw new SocialError(`인스타그램 장기 토큰을 받지 못했습니다 (${l.j.error?.message || l.r.status})`);
  const me = await req(`${EP.ig}/${IGV}/me?${form({ fields: 'user_id,username,account_type', access_token: l.j.access_token })}`, {}, 'Instagram');
  if (!me.r.ok) throw new SocialError(`인스타그램 계정을 읽지 못했습니다 (${me.j.error?.message || me.r.status})`);
  if (me.j.account_type && !/BUSINESS|MEDIA_CREATOR|CREATOR/i.test(me.j.account_type)) throw new SocialError('프로페셔널(비즈니스 · 크리에이터) 계정만 릴스를 올릴 수 있습니다. 인스타그램 앱 › 설정 › 계정 유형에서 바꿔 주세요');
  return { id: String(me.j.user_id || me.j.id), name: me.j.username ? `@${me.j.username}` : '', url: me.j.username ? `https://www.instagram.com/${me.j.username}/` : '',
    access: l.j.access_token, refresh: '', expiresAt: new Date(Date.now() + (Number(l.j.expires_in) || 5184000) * 1000) };
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function donePage(res, { ok, platform, msg, origin }) {
  const back = origin ? `${origin}/#/B/${encodeURIComponent('콘텐츠 관리')}` : '';
  const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Jcalender 계정 연결</title></head>
<body style="font-family:system-ui,sans-serif;max-width:480px;margin:40px auto;padding:0 16px;line-height:1.6;color:#16202a;background:#fff">
<h1 style="font-size:20px">${ok ? '연결했습니다' : '연결하지 못했습니다'}</h1><p>${esc(msg)}</p>
${back ? `<p><a href="${esc(back)}">Jcalender 로 돌아가기</a></p>` : ''}<p style="color:#77848f;font-size:13px">이 창은 닫아도 됩니다.</p>
<script>try{if(window.opener)window.opener.postMessage({jcalSocial:${JSON.stringify(platform)},ok:${ok ? 'true' : 'false'}},${JSON.stringify(origin || '*')});}catch(e){}
${ok ? 'setTimeout(function(){if(window.opener)window.close();},1200);' : ''}</script></body></html>`;
  res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  res.end(html);
}

/* ── 올리기 ── */
async function youtubeUpload(pool, post, file, step) {
  const ch = await channelOf(pool, post.user_id, 'youtube');
  if (!ch) throw new SocialError('유튜브가 연결되어 있지 않습니다');
  const token = await googleAccess(pool, ch);
  const size = fs.statSync(file).size;
  const tags = (post.caption.match(/#[^\s#]+/g) || []).map(t => t.slice(1)).slice(0, 15);
  const description = /#shorts\b/i.test(post.caption) ? post.caption : `${post.caption}\n\n#Shorts`.trim();
  await step('유튜브에 올릴 준비', 10);
  const init = await fetch(`${EP.ytUp}?uploadType=resumable&part=snippet,status`, {
    method: 'POST', signal: AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(size), 'X-Upload-Content-Type': 'video/mp4' },
    body: JSON.stringify({ snippet: { title: post.title, description, tags, categoryId: '22' }, status: { privacyStatus: post.privacy, selfDeclaredMadeForKids: false } }),
  }).catch(() => null);
  if (!init) throw new SocialError('유튜브에 연결하지 못했습니다', 502);
  if (!init.ok || !init.headers.get('location')) throw ytError(init.status, await init.json().catch(() => ({})));
  await step('유튜브에 올리는 중', 30);
  const put = await fetch(init.headers.get('location'), { method: 'PUT', duplex: 'half', signal: AbortSignal.timeout(30 * 60000),
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size) }, body: fs.createReadStream(file) }).catch(() => null);
  if (!put) throw new SocialError('유튜브로 파일을 보내다 끊겼습니다. 다시 시도해 주세요', 502);
  const j = await put.json().catch(() => ({}));
  if (!put.ok || !j.id) throw ytError(put.status, j);
  return { id: j.id, url: `https://www.youtube.com/shorts/${j.id}` };
}
function ytError(status, j) {
  const why = gErr(j);
  console.error('[숏폼 업로드 · YouTube]', status, why, gMsg(j));
  if (why === 'quotaExceeded') return new SocialError('오늘 유튜브 API 사용량(할당량)을 다 썼습니다. 내일(태평양 시간 자정 뒤) 다시 시도하세요 (하루 약 6개)', 429);
  if (why === 'uploadLimitExceeded') return new SocialError('이 채널의 하루 업로드 한도를 넘었습니다. 내일 다시 시도하세요', 429);
  if (why === 'youtubeSignupRequired') return new SocialError('이 구글 계정에 유튜브 채널이 없습니다', 400);
  if (status === 401) return new SocialError('유튜브 인증이 거절되었습니다. 다시 연결해 주세요', 401);
  if (why === 'invalidTitle' || why === 'invalidDescription') return new SocialError('제목이나 설명에 쓸 수 없는 글자(< >)가 있거나 너무 깁니다', 400);
  return new SocialError(`유튜브 업로드 실패 (${why || status}${gMsg(j) ? `: ${gMsg(j).slice(0, 120)}` : ''})`, 502);
}
async function instagramUpload(pool, post, step) {
  const ch = await channelOf(pool, post.user_id, 'instagram');
  if (!ch) throw new SocialError('인스타그램이 연결되어 있지 않습니다');
  const token = await igAccess(pool, ch);
  const igErr = (j, r) => { console.error('[숏폼 업로드 · Instagram]', r.status, JSON.stringify(j.error || j).slice(0, 300));
    const code = j.error?.code;
    if (code === 190) return new SocialError('인스타그램 연결이 만료되었습니다. 다시 연결해 주세요', 401);
    if (code === 4 || code === 9 || j.error?.error_subcode === 2207042) return new SocialError('인스타그램 게시 한도(24시간)에 걸렸습니다. 나중에 다시 시도하세요', 429);
    return new SocialError(`인스타그램 업로드 실패 (${j.error?.error_user_msg || j.error?.message || r.status})`, 502); };
  await step('인스타그램이 영상을 가져가는 중', 10);
  const videoUrl = `${publicBase()}${fileUrl(post.render_id, 'render')}`;   // 인스타그램 서버가 이 주소에서 직접 내려받음
  const c = await req(`${EP.ig}/${IGV}/${ch.account_id}/media`, { method: 'POST', body: form({ media_type: 'REELS', video_url: videoUrl, caption: post.caption, share_to_feed: 'true', access_token: token }) }, 'Instagram');
  if (!c.r.ok || !c.j.id) throw igErr(c.j, c.r);
  for (let i = 0; ; i++) {                                     // 처리 끝날 때까지 (최대 약 15분)
    await sleep(i < 6 ? POLL : POLL * 3);
    const s = await req(`${EP.ig}/${IGV}/${c.j.id}?${form({ fields: 'status_code,status', access_token: token })}`, {}, 'Instagram');
    const code = s.j.status_code;
    if (code === 'FINISHED') break;
    if (code === 'ERROR' || code === 'EXPIRED') throw new SocialError(`인스타그램이 영상을 처리하지 못했습니다 (${s.j.status || code})`, 502);
    if (i > 64) throw new SocialError('인스타그램 처리가 너무 오래 걸립니다. 다시 시도해 주세요', 504);
    await step('인스타그램이 영상을 처리하는 중', Math.min(80, 20 + i * 4));
  }
  await step('인스타그램에 게시하는 중', 85);
  const p = await req(`${EP.ig}/${IGV}/${ch.account_id}/media_publish`, { method: 'POST', body: form({ creation_id: c.j.id, access_token: token }) }, 'Instagram');
  if (!p.r.ok || !p.j.id) throw igErr(p.j, p.r);
  const l = await req(`${EP.ig}/${IGV}/${p.j.id}?${form({ fields: 'permalink', access_token: token })}`, {}, 'Instagram');
  return { id: String(p.j.id), url: l.j.permalink || ch.account_url };
}

/* ── 성과 ── */
const n = v => (v == null || v === '' ? undefined : Number(v));
async function statsYoutube(pool, uid, posts) {
  const ch = await channelOf(pool, uid, 'youtube');
  if (!ch || !posts.length) return {};
  const token = await googleAccess(pool, ch), out = {};
  for (let i = 0; i < posts.length; i += 50) {
    const ids = posts.slice(i, i + 50).map(p => p.external_id);
    const { r, j } = await req(`${EP.yt}/videos?part=statistics&id=${ids.join(',')}`, { headers: { Authorization: `Bearer ${token}` } }, 'YouTube');
    if (!r.ok) throw ytError(r.status, j);
    for (const v of j.items || []) out[v.id] = { views: n(v.statistics?.viewCount), likes: n(v.statistics?.likeCount), comments: n(v.statistics?.commentCount) };
  }
  return out;
}
async function statsInstagram(pool, uid, posts) {
  const ch = await channelOf(pool, uid, 'instagram');
  if (!ch || !posts.length) return {};
  const token = await igAccess(pool, ch), out = {};
  for (const p of posts) {
    const b = await req(`${EP.ig}/${IGV}/${p.external_id}?${form({ fields: 'like_count,comments_count,permalink', access_token: token })}`, {}, 'Instagram');
    if (!b.r.ok) continue;
    const s = { likes: n(b.j.like_count), comments: n(b.j.comments_count) };
    const ins = await req(`${EP.ig}/${IGV}/${p.external_id}/insights?${form({ metric: 'views,reach,saved,shares', access_token: token })}`, {}, 'Instagram');
    for (const m of ins.j.data || []) {
      const v = n(m.values?.[0]?.value ?? m.total_value?.value);
      const k = { views: 'views', reach: 'reach', saved: 'saves', shares: 'shares' }[m.name];
      if (k && v !== undefined) s[k] = v;
    }
    out[p.external_id] = s;
  }
  return out;
}
/** 성과 새로 가져오기: ids 가 없으면 때가 된 것만 (올린 지 2일 안: 1시간, 14일 안: 6시간, 60일 안: 하루) */
export async function refreshStats(pool, uid, ids = null) {
  const { rows } = await pool.query(`SELECT * FROM jcal.shorts_posts WHERE status = 'done' AND external_id <> '' AND ($1::uuid IS NULL OR user_id = $1)
      AND ($2::uuid[] IS NULL AND posted_at > now() - interval '60 days' AND (stats_at IS NULL OR stats_at < now() - CASE WHEN posted_at > now() - interval '2 days' THEN interval '1 hour'
        WHEN posted_at > now() - interval '14 days' THEN interval '6 hours' ELSE interval '1 day' END) OR id = ANY($2::uuid[]))`, [uid, ids]);
  const errors = [];
  const byUser = {};
  for (const p of rows) ((byUser[p.user_id] ||= { youtube: [], instagram: [] })[p.platform]).push(p);
  for (const [u, g] of Object.entries(byUser)) {
    for (const [platform, list] of Object.entries(g)) {
      if (!list.length) continue;
      try {
        const s = await (platform === 'youtube' ? statsYoutube : statsInstagram)(pool, u, list);
        for (const p of list) if (s[p.external_id]) await pool.query('UPDATE jcal.shorts_posts SET stats = $2, stats_at = now() WHERE id = $1', [p.id, Object.fromEntries(Object.entries(s[p.external_id]).filter(([, v]) => v !== undefined))]);
      } catch (e) { errors.push(`${NAME[platform]}: ${e.message}`); }
    }
  }
  return { updated: rows.length, errors };
}

/* ── 대기열 ── */
let busy = false;
async function runPost(pool, post) {
  let last = 0;
  const step = async (stage, p) => { if (Date.now() - last < 800 && p < 100) return; last = Date.now(); await pool.query('UPDATE jcal.shorts_posts SET stage = $2 WHERE id = $1', [post.id, `${stage} · ${p}%`]); };
  try {
    if (!post.render_id) throw new SocialError('영상이 지워졌습니다');
    const file = renderPath(post.user_id, post.render_id);
    if (!fs.existsSync(file)) throw new SocialError('영상 파일이 없습니다 (지워졌을 수 있음)');
    const r = post.platform === 'youtube' ? await youtubeUpload(pool, post, file, step) : await instagramUpload(pool, post, step);
    await pool.query("UPDATE jcal.shorts_posts SET status = 'done', stage = '완료', external_id = $2, url = $3, posted_at = now(), error = '' WHERE id = $1", [post.id, r.id, r.url]);
  } catch (e) {
    if (!(e instanceof SocialError)) console.error('[숏폼 업로드]', e);
    await pool.query("UPDATE jcal.shorts_posts SET status = 'failed', stage = '', error = $2 WHERE id = $1", [post.id, e instanceof SocialError ? e.message : '올리지 못했습니다 (서버 기록: journalctl -u jcal-api)']).catch(() => {});
  }
}
export function kickPosts(pool) {
  if (busy) return;
  busy = true;
  (async () => {
    try {
      for (;;) {
        const { rows } = await pool.query(`UPDATE jcal.shorts_posts SET status = 'uploading', stage = '시작', error = ''
          WHERE id = (SELECT id FROM jcal.shorts_posts WHERE status = 'scheduled' AND scheduled_at <= now() ORDER BY scheduled_at, created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`);
        if (!rows[0]) break;
        await runPost(pool, rows[0]);
      }
    } catch (e) { console.error('[숏폼 업로드 대기열]', e); } finally { busy = false; }
  })();
}
export async function startSocialWorker(pool, { statsEveryMs = 60 * 60000 } = {}) {
  // 올리던 중 서버가 다시 시작됨: 유튜브는 처음부터 다시, 인스타그램은 두 번 올라갈 수 있어 실패로 두고 확인하게 함
  await pool.query("UPDATE jcal.shorts_posts SET status = 'scheduled', stage = '서버가 다시 시작되어 다시 올림' WHERE status = 'uploading' AND platform = 'youtube'").catch(() => {});
  await pool.query("UPDATE jcal.shorts_posts SET status = 'failed', stage = '', error = '올리는 중 서버가 다시 시작되었습니다. 인스타그램에 올라갔는지 확인한 뒤 필요하면 다시 시도하세요' WHERE status = 'uploading' AND platform = 'instagram'").catch(() => {});
  kickPosts(pool);
  setInterval(() => kickPosts(pool), 30000).unref();
  setInterval(() => refreshStats(pool, null).then(r => r.errors.length && console.error('[숏폼 성과]', r.errors.join(' / '))).catch(e => console.error('[숏폼 성과]', e)), statsEveryMs).unref();
}

/* ── 화면에 보낼 데이터 ── */
export async function socialOf(pool, uid) {
  const [chs, posts] = await Promise.all([
    pool.query('SELECT platform, account_id, account_name, account_url, expires_at, error, connected_at FROM jcal.shorts_channels WHERE user_id = $1', [uid]),
    pool.query(`SELECT id, render_id, script_id, platform, title, caption, privacy, scheduled_at, status, stage, external_id, url, error, stats, stats_at, created_at, posted_at
      FROM jcal.shorts_posts WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200`, [uid]),
  ]);
  const channels = Object.fromEntries(PLATFORMS.map(p => { const c = chs.rows.find(x => x.platform === p);
    return [p, { ready: socialReady[p](), connected: !!c, name: c?.account_name || '', url: c?.account_url || '', error: c?.error || '', connectedAt: c?.connected_at || null, expiresAt: p === 'instagram' ? c?.expires_at || null : null }]; }));
  return { social: { channels, posts: posts.rows, callback: { youtube: callbackUrl('youtube'), instagram: callbackUrl('instagram') } } };
}

/* ── 경로 ── */
export function socialRoutes({ pool, adminUser, HttpError, originOk }) {
  const user = adminUser;
  const uuidOk = v => /^[0-9a-f-]{36}$/i.test(String(v || ''));
  const need = v => { if (!uuidOk(v)) throw new HttpError(400, 'id 가 올바르지 않습니다'); return v; };
  const plat = p => { if (!PLATFORMS.includes(p)) throw new HttpError(400, 'platform 은 youtube · instagram 중 하나입니다'); return p; };
  const wrap = async fn => { try { return await fn(); } catch (e) { if (e instanceof SocialError) throw new HttpError(e.status, e.message); throw e; } };

  const raw = Object.fromEntries(PLATFORMS.map(platform => [`GET /api/oauth/${platform}/callback`, async (req, res) => {
    const q = new URL(req.url, 'http://x').searchParams;
    const st = readState(q.get('state'), platform);
    const origin = st && originOk(st.o) ? st.o : '';
    if (!st) { donePage(res, { ok: false, platform, msg: '연결 요청이 만료되었거나 올바르지 않습니다. 앱에서 "연결하기"를 다시 눌러 주세요 (10분 안에 끝내야 합니다)', origin }); return RAW; }
    if (q.get('error')) { donePage(res, { ok: false, platform, msg: q.get('error') === 'access_denied' ? '허용을 누르지 않아 연결하지 않았습니다' : `${NAME[platform]} 오류: ${q.get('error_description') || q.get('error')}`, origin }); return RAW; }
    try {
      const c = platform === 'youtube' ? await finishYoutube(String(q.get('code') || '')) : await finishInstagram(String(q.get('code') || ''));
      await saveChannel(pool, st.u, platform, c);
      donePage(res, { ok: true, platform, msg: `${NAME[platform]} ${c.name} 계정을 연결했습니다. 앱으로 돌아가 업로드할 수 있습니다.`, origin });
    } catch (e) {
      if (!(e instanceof SocialError)) console.error('[숏폼 계정 연결]', e);
      donePage(res, { ok: false, platform, msg: e instanceof SocialError ? e.message : '연결 중 서버 오류가 났습니다', origin });
    }
    return RAW;
  }]));

  const json = {
    'GET /api/shorts/social': async req => socialOf(pool, (await user(req)).id),

    'POST /api/shorts/social/connect': async (req, body) => {
      const u = await user(req);
      const p = plat(body.platform);
      if (!socialReady[p]()) throw new HttpError(503, p === 'youtube' ? '유튜브 연결 키가 서버에 없습니다. VPS 에서 jcal-admin youtube-key 로 넣어 주세요' : '인스타그램 앱 키가 서버에 없습니다. VPS 에서 jcal-admin instagram-key 로 넣어 주세요');
      const origin = originOk(req.headers.origin) ? req.headers.origin : '';
      return { url: authUrl(p, stateOf(u.id, p, origin)) };
    },

    'POST /api/shorts/social/disconnect': async (req, body) => {
      const u = await user(req);
      const p = plat(body.platform);
      const { rows: [c] } = await pool.query('DELETE FROM jcal.shorts_channels WHERE user_id = $1 AND platform = $2 RETURNING *', [u.id, p]);
      if (c && p === 'youtube' && c.refresh_token) await fetch(EP.gRevoke, { method: 'POST', body: form({ token: dec(c.refresh_token) }), signal: AbortSignal.timeout(10000) }).catch(() => {});   // 구글 쪽 허용도 취소
      return { ok: true };
    },

    'POST /api/shorts/post': async (req, body) => {
      const u = await user(req);
      const { rows: [r] } = await pool.query("SELECT id, script_id, title FROM jcal.shorts_renders WHERE id = $1 AND user_id = $2 AND status = 'done'", [need(body.renderId), u.id]);
      if (!r) throw new HttpError(404, '완성된 영상이 아닙니다');
      const platforms = [...new Set((Array.isArray(body.platforms) ? body.platforms : []).filter(p => PLATFORMS.includes(p)))];
      if (!platforms.length) throw new HttpError(400, '올릴 곳(유튜브 · 인스타그램)을 골라 주세요');
      for (const p of platforms) { const c = await channelOf(pool, u.id, p); if (!c) throw new HttpError(400, `${NAME[p]} 계정을 먼저 연결해 주세요`); if (c.error) throw new HttpError(400, c.error); }
      const title = String(body.title ?? r.title).replace(/\s+/g, ' ').trim();
      const caption = String(body.caption || '').trim();
      if (platforms.includes('youtube')) {
        if (!title) throw new HttpError(400, '제목을 넣어 주세요');
        if (title.length > 100) throw new HttpError(400, `유튜브 제목은 100자까지입니다 (지금 ${title.length}자)`);
        if (/[<>]/.test(title + caption)) throw new HttpError(400, '유튜브 제목 · 설명에는 < > 를 쓸 수 없습니다');
        if (Buffer.byteLength(caption) > 4900) throw new HttpError(400, '유튜브 설명이 너무 깁니다 (약 1600자까지)');
      }
      if (platforms.includes('instagram')) {
        if (caption.length > 2200) throw new HttpError(400, `인스타그램 캡션은 2200자까지입니다 (지금 ${caption.length}자)`);
        if ((caption.match(/#[^\s#]+/g) || []).length > 30) throw new HttpError(400, '인스타그램 해시태그는 30개까지입니다');
      }
      const privacy = ['public', 'unlisted', 'private'].includes(body.privacy) ? body.privacy : 'public';
      let at = body.scheduledAt ? new Date(body.scheduledAt) : new Date();
      if (Number.isNaN(at.getTime())) throw new HttpError(400, '예약 시각이 올바르지 않습니다');
      if (at.getTime() > Date.now() + 180 * 86400000) throw new HttpError(400, '예약은 180일 안으로만 할 수 있습니다');
      if (at.getTime() < Date.now()) at = new Date();
      const posts = [];
      for (const p of platforms) {
        posts.push((await pool.query(`INSERT INTO jcal.shorts_posts (user_id, render_id, script_id, platform, title, caption, privacy, scheduled_at, stage)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`, [u.id, r.id, r.script_id, p, title.slice(0, 300), caption, privacy, at, at.getTime() > Date.now() + 30000 ? '예약됨' : '곧 올림'])).rows[0]);
      }
      kickPosts(pool);
      return { posts };
    },

    'POST /api/shorts/post/action': async (req, body) => {
      const u = await user(req);
      const { rows: [p] } = await pool.query('SELECT * FROM jcal.shorts_posts WHERE id = $1 AND user_id = $2', [need(body.id), u.id]);
      if (!p) throw new HttpError(404, '없는 업로드입니다');
      if (body.action === 'cancel' || body.action === 'remove') {
        if (p.status === 'uploading') throw new HttpError(409, '지금 올리는 중이라 멈출 수 없습니다. 끝난 뒤에 지워 주세요');
        await pool.query('DELETE FROM jcal.shorts_posts WHERE id = $1', [p.id]);
        return { ok: true };
      }
      if (body.action === 'retry') {
        if (p.status !== 'failed') throw new HttpError(409, '실패한 업로드만 다시 시도할 수 있습니다');
        await pool.query("UPDATE jcal.shorts_posts SET status = 'scheduled', scheduled_at = now(), stage = '곧 올림', error = '' WHERE id = $1", [p.id]);
        kickPosts(pool);
        return { ok: true };
      }
      throw new HttpError(400, 'action 은 cancel · retry · remove 중 하나입니다');
    },

    'POST /api/shorts/stats': async (req, body) => {
      const u = await user(req);
      const ids = body.id ? [need(body.id)] : (await pool.query("SELECT id FROM jcal.shorts_posts WHERE user_id = $1 AND status = 'done' AND posted_at > now() - interval '60 days'", [u.id])).rows.map(x => x.id);
      const r = ids.length ? await wrap(() => refreshStats(pool, u.id, ids)) : { updated: 0, errors: [] };
      return { ...r, ...(await socialOf(pool, u.id)) };
    },
  };
  return { raw, json };
}
