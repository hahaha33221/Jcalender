/* 숏폼 제작 1차 — 게시판 글 수집 → 고르기 → AI 제목 · 스크립트 (db/migrations/005_shorts.sql)
   GET  /api/shorts                          → { settings, sources, items, scripts, ai }
   POST /api/shorts/source  {action: add | update | delete | fetch, ...}   게시판(RSS) 관리 · 지금 수집
   POST /api/shorts/item    {id, status: new | picked | skipped}            글 고르기 · 건너뛰기
   POST /api/shorts/generate {itemId}                                       AI 로 제목 · 스크립트 후보 만들기
   POST /api/shorts/script  {id, chosen?, title?, script?, hashtags?, remove?}  후보 고르기 · 고치기 · 지우기
   POST /api/shorts/settings {…}                                            설정 저장
   - 수집: 서버가 5분마다 확인해서 주기(기본 60분)가 지난 게시판을 읽는다. RSS 가 없는 페이지 주소는 페이지 안의 RSS 링크를 찾아 쓴다
   - 보안: http(s) 만, 내부망 주소(127.0.0.1 · 10.x · 192.168.x 등)는 읽지 않음 (리디렉션도 확인), 3MB · 15초 제한
   - AI: OpenAI ChatGPT (환경 변수 OPENAI_API_KEY, 모델 SHORTS_MODEL 기본 gpt-5-mini) 또는 Anthropic Claude (ANTHROPIC_API_KEY)
     둘 다 있으면 AI_PROVIDER=openai | anthropic 로 고름 (없으면 OpenAI 우선). 키가 없으면 생성 버튼만 막힘 */
import dns from 'dns/promises';
import net from 'net';
import { clampVideo } from './shortsText.mjs';

export const DEFAULT_SETTINGS = {
  titleMax: 30,                 // 제목 최대 글자 수
  scriptChars: 350,             // 스크립트 글자 수 (한국어 나레이션 약 1분)
  count: 2,                     // 후보 개수
  tone: '친구에게 썰 푸는 듯한 구어체',
  extra: '',                    // 추가 지시
  fetchMinutes: 60,             // 수집 주기
  keepDays: 30,                 // 고르지 않은 글은 이 날짜가 지나면 지움
  video: clampVideo(),          // 2차: 영상 설정 (shortsText.mjs)
};
export const clampSettings = s => {
  const d = { ...DEFAULT_SETTINGS, ...(s || {}) };
  const n = (v, lo, hi, def) => Math.min(hi, Math.max(lo, Math.round(Number(v)) || def));
  return { titleMax: n(d.titleMax, 10, 100, 30), scriptChars: n(d.scriptChars, 100, 1500, 350), count: n(d.count, 1, 5, 2),
    tone: String(d.tone || '').slice(0, 200), extra: String(d.extra || '').slice(0, 1000), fetchMinutes: n(d.fetchMinutes, 10, 1440, 60), keepDays: n(d.keepDays, 3, 365, 30), video: clampVideo(d.video) };
};

/* ── 안전한 가져오기 ── */
const ALLOW_PRIVATE = process.env.SHORTS_ALLOW_PRIVATE === '1';     // 시험용(내 컴퓨터의 RSS)만
function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const x = ip.toLowerCase();
  if (x.startsWith('::ffff:')) return privateIp(x.slice(7));
  return x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x);
}
async function checkUrl(u) {
  let url;
  try { url = new URL(u); } catch { throw new Error('주소 형식이 아닙니다'); }
  if (!/^https?:$/.test(url.protocol)) throw new Error('http 또는 https 주소만 쓸 수 있습니다');
  if (ALLOW_PRIVATE) return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => { throw new Error(`주소를 찾을 수 없습니다: ${host}`); });
  if (!addrs.length || addrs.some(a => privateIp(a.address))) throw new Error('내부망 주소는 읽을 수 없습니다');
  return url;
}
const UA = 'Mozilla/5.0 (compatible; JcalenderBot/1.0; +https://jcalender-amber.vercel.app)';
export async function safeFetch(u, { maxBytes = 3 * 1024 * 1024, timeout = 15000 } = {}) {
  let url = await checkUrl(u);
  for (let hop = 0; hop < 5; hop++) {
    const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeout), headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.9, */*;q=0.8' } });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) { url = await checkUrl(new URL(r.headers.get('location'), url).href); continue; }
    if (!r.ok) throw new Error(`읽기 실패 (${r.status})`);
    const len = Number(r.headers.get('content-length') || 0);
    if (len > maxBytes) throw new Error('파일이 너무 큽니다');
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > maxBytes) throw new Error('파일이 너무 큽니다');
    return { url: url.href, type: r.headers.get('content-type') || '', text: decode(buf, r.headers.get('content-type') || '') };
  }
  throw new Error('리디렉션이 너무 많습니다');
}
/** 글자 인코딩: 헤더 → XML 선언 · meta charset → UTF-8 (EUC-KR 게시판 대응) */
function decode(buf, type) {
  const head = buf.subarray(0, 2048).toString('latin1');
  const cs = ((type.match(/charset=([\w-]+)/i) || head.match(/encoding=["']([\w-]+)["']/i) || head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1] || 'utf-8').toLowerCase();
  try { return new TextDecoder(cs === 'ks_c_5601-1987' ? 'euc-kr' : cs).decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

/* ── HTML · RSS 읽기 ── */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', middot: '·', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”' };
export const decodeEntities = s => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') { const c = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(c) && c > 0 && c < 0x110000 ? String.fromCodePoint(c) : m; }
  return ENT[e.toLowerCase()] ?? m;
});
export function htmlToText(html) {
  return decodeEntities(String(html || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<(script|style|noscript|iframe|svg|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6]|tr|blockquote|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
const cdata = s => String(s || '').replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
const tag = (b, names) => { for (const n of names) { const m = b.match(new RegExp(`<${n}\\b[^>]*>([\\s\\S]*?)</${n}>`, 'i')); if (m && m[1].trim()) return cdata(m[1]); } return ''; };
export const isFeed = text => /<(rss|feed|rdf:RDF)\b/i.test(String(text).slice(0, 3000));
/** RSS 2.0 · Atom · RSS 1.0 → [{ link, title, body, published }] */
export function parseFeed(xml, base) {
  const out = [];
  for (const b of String(xml).match(/<(item|entry)\b[\s\S]*?<\/(item|entry)>/gi) || []) {
    let link = tag(b, ['link']).trim();
    if (!link) { const m = b.match(/<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)/i) || b.match(/<link\b[^>]*href=["']([^"']+)/i); link = m ? m[1] : ''; }
    if (!link) link = tag(b, ['guid', 'id']).trim();
    try { link = new URL(decodeEntities(link), base).href; } catch { continue; }
    const title = htmlToText(tag(b, ['title'])).replace(/\s+/g, ' ').slice(0, 300);
    const body = htmlToText(decodeEntities(tag(b, ['content:encoded', 'content', 'description', 'summary']))).slice(0, 20000);
    const d = new Date(tag(b, ['pubDate', 'published', 'updated', 'dc:date']).trim());
    out.push({ link, title, body, published: Number.isNaN(d.getTime()) ? null : d.toISOString() });
  }
  return out;
}
/** 게시판 페이지 → 안에 적힌 RSS 주소 */
export function findFeedLink(html, base) {
  for (const m of String(html).matchAll(/<link\b[^>]*>/gi)) {
    const t = m[0];
    if (/rel=["']?alternate/i.test(t) && /type=["']?application\/(rss|atom)\+xml/i.test(t)) {
      const h = t.match(/href=["']([^"']+)/i);
      if (h) return new URL(decodeEntities(h[1]), base).href;
    }
  }
  return '';
}
/** 글 페이지 → 본문 (정규식이 있으면 그 첫 괄호, 없으면 article · 본문 영역 · 설명) */
export function extractBody(html, pattern) {
  const s = String(html);
  if (pattern) { try { const m = s.match(new RegExp(pattern, 'i')); if (m) return htmlToText(m[1] ?? m[0]); } catch { /* 잘못된 정규식 → 자동 */ } }
  const art = s.match(/<article\b[\s\S]*?<\/article>/i);
  if (art) { const t = htmlToText(art[0]); if (t.length > 80) return t; }
  const zone = s.match(/<(div|section)\b[^>]*(?:id|class)=["'][^"']*(?:article|content|post|view|board|read|entry|body)[^"']*["'][^>]*>[\s\S]{200,}?<\/\1>/i);
  if (zone) { const t = htmlToText(zone[0]); if (t.length > 80) return t; }
  const og = s.match(/<meta[^>]+(?:property|name)=["'](?:og:description|description)["'][^>]+content=["']([^"']*)/i);
  return og ? decodeEntities(og[1]) : '';
}

/* ── 수집 ── */
export async function resolveFeed(url) {
  const r = await safeFetch(url);
  if (isFeed(r.text)) return { feedUrl: r.url, items: parseFeed(r.text, r.url) };
  const f = findFeedLink(r.text, r.url);
  if (!f) throw new Error('이 페이지에서 RSS 를 찾지 못했습니다. 게시판의 RSS 주소를 넣어 주세요');
  const r2 = await safeFetch(f);
  if (!isFeed(r2.text)) throw new Error('RSS 주소가 올바르지 않습니다');
  return { feedUrl: r2.url, items: parseFeed(r2.text, r2.url) };
}
async function collect(pool, src) {
  try {
    const r = await safeFetch(src.feed_url);
    if (!isFeed(r.text)) throw new Error('RSS 형식이 아닙니다');
    const items = parseFeed(r.text, r.url).slice(0, 50);
    let added = 0, full = 0;
    for (const it of items) {
      const ex = await pool.query('SELECT 1 FROM jcal.shorts_items WHERE user_id = $1 AND link = $2', [src.user_id, it.link]);
      if (ex.rowCount) continue;
      let body = it.body;
      if (src.full_text && full < 10) {                       // 새 글만, 한 번에 10개까지 본문 가져오기
        full++;
        try { const page = await safeFetch(it.link, { maxBytes: 2 * 1024 * 1024 }); const b = extractBody(page.text, src.body_pattern); if (b.length > body.length) body = b; } catch { /* 본문은 RSS 내용으로 */ }
      }
      const ins = await pool.query(`INSERT INTO jcal.shorts_items (user_id, source_id, link, title, body, published_at) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (user_id, link) DO NOTHING`,
        [src.user_id, src.id, it.link, it.title || '(제목 없음)', body.slice(0, 20000), it.published]);
      added += ins.rowCount;
    }
    await pool.query("UPDATE jcal.shorts_sources SET last_fetched_at = now(), last_count = $2, last_error = '' WHERE id = $1", [src.id, added]);
    return { added, total: items.length };
  } catch (e) {
    await pool.query('UPDATE jcal.shorts_sources SET last_fetched_at = now(), last_error = $2 WHERE id = $1', [src.id, String(e.message || e).slice(0, 300)]);
    return { added: 0, error: e.message };
  }
}
export async function settingsOf(pool, uid) {
  const { rows } = await pool.query('SELECT data FROM jcal.shorts_settings WHERE user_id = $1', [uid]);
  return clampSettings(rows[0]?.data);
}
/** 5분마다: 주기가 지난 게시판 수집 + 오래된 글 정리 (한 번에 하나씩) */
export function startShortsCron(pool, everyMs = 5 * 60 * 1000) {
  let running = false;
  const tick = async () => {
    if (running) return; running = true;
    try {
      const { rows } = await pool.query(`SELECT s.*, COALESCE((st.data->>'fetchMinutes')::int, ${DEFAULT_SETTINGS.fetchMinutes}) AS every
        FROM jcal.shorts_sources s LEFT JOIN jcal.shorts_settings st ON st.user_id = s.user_id WHERE s.active`);
      for (const s of rows) if (!s.last_fetched_at || Date.now() - new Date(s.last_fetched_at) >= Math.max(10, s.every) * 60000) await collect(pool, s);
      await pool.query(`DELETE FROM jcal.shorts_items i USING jcal.users u LEFT JOIN jcal.shorts_settings st ON st.user_id = u.id
        WHERE i.user_id = u.id AND i.status <> 'picked' AND i.fetched_at < now() - make_interval(days => COALESCE((st.data->>'keepDays')::int, ${DEFAULT_SETTINGS.keepDays}))`);
    } catch (e) { console.error('[숏폼 수집]', e.message); }
    finally { running = false; }
  };
  setTimeout(tick, 20000).unref();
  return setInterval(tick, everyMs).unref();
}

/* ── AI 제목 · 스크립트 ── */
const env = process.env;
export const aiProvider = () => (env.AI_PROVIDER === 'anthropic' || env.AI_PROVIDER === 'openai' ? env.AI_PROVIDER
  : env.OPENAI_API_KEY ? 'openai' : (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) ? 'anthropic' : 'openai');
export const aiModel = () => env.SHORTS_MODEL || (aiProvider() === 'openai' ? 'gpt-5-mini' : 'claude-opus-5-5');
export const aiReady = () => (aiProvider() === 'openai' ? !!env.OPENAI_API_KEY : !!(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN));
// Claude SDK 는 쓸 때만 불러온다 (라이브러리가 아직 설치 안 됐어도 서버 · ChatGPT 는 동작)
let Anthropic = null, client = null;
const anthropic = async () => { Anthropic ||= (await import('@anthropic-ai/sdk')).default; return (client ||= new Anthropic()); };
/** AI 오류를 화면에 보일 말로: status 는 HTTP 상태로 그대로 씀 */
export class AiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['candidates'],
  properties: { candidates: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'script', 'hashtags'],
    properties: { title: { type: 'string' }, script: { type: 'string' }, hashtags: { type: 'array', items: { type: 'string' } } } } } },
};
const SYSTEM = `당신은 한국어 숏폼(유튜브 쇼츠 · 인스타 릴스 · 틱톡) 썰 영상 작가입니다.
주어진 게시판 글을 바탕으로, 나레이션으로 읽을 영상 제목과 스크립트를 씁니다.
- 원문 문장을 그대로 옮기지 말고 자기 말로 다시 씁니다. 실명 · 연락처 · 회사명 같은 개인 정보는 빼거나 일반화합니다.
- 첫 문장은 3초 안에 궁금하게 만드는 한 줄로 시작합니다.
- 소리 내어 읽기 좋게 짧은 문장으로 씁니다. 이모지 · 괄호 · 특수기호 · 머리말("스크립트:")은 쓰지 않습니다.
- 마지막은 시청자에게 묻는 한 문장(댓글 유도)으로 끝냅니다.
- 원문에 없는 사실을 지어내지 않습니다. 글이 혐오 · 개인 공격 · 성적인 내용 중심이면 그 부분은 빼고 씁니다.`;
/** OpenAI Chat Completions + JSON 스키마(structured outputs) */
export async function askOpenAI(prompt, { system = SYSTEM, schema = SCHEMA, name = 'shorts_scripts' } = {}) {
  let r;
  try {
    r = await fetch(`${(env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST', signal: AbortSignal.timeout(180000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: aiModel(), max_completion_tokens: 16000,
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
        response_format: { type: 'json_schema', json_schema: { name, strict: true, schema } },
      }),
    });
  } catch (e) { throw new AiError(502, e.name === 'TimeoutError' ? 'AI 응답이 너무 오래 걸립니다. 다시 시도해 주세요' : 'AI 서버에 연결하지 못했습니다'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const code = j.error?.code || j.error?.type || '';
    console.error('[숏폼 AI · OpenAI]', r.status, code, j.error?.message);
    if (r.status === 401) throw new AiError(503, 'OpenAI API 키가 올바르지 않습니다 (jcal-admin ai-key 로 다시 넣기)');
    if (code === 'insufficient_quota') throw new AiError(402, 'OpenAI 크레딧(잔액)이 없습니다. platform.openai.com › Billing 에서 충전하세요');
    if (r.status === 429) throw new AiError(429, 'OpenAI 사용량 한도에 걸렸습니다. 잠시 뒤 다시 시도하세요');
    if (r.status === 404 || code === 'model_not_found') throw new AiError(503, `OpenAI 모델을 쓸 수 없습니다: ${aiModel()} (SHORTS_MODEL 확인)`);
    throw new AiError(502, `AI 서버 오류 (${r.status})`);
  }
  const ch = j.choices?.[0] || {};
  if (ch.message?.refusal) throw new AiError(422, 'AI 가 이 글로는 스크립트를 만들지 않았습니다. 다른 글을 골라 주세요');
  if (ch.finish_reason === 'length') throw new AiError(502, 'AI 응답이 너무 길어 잘렸습니다. 스크립트 글자 수를 줄여 주세요');
  return ch.message?.content || '';
}
/** Anthropic Claude (Messages API + JSON 스키마, 거절되면 권장 모델로 자동 재시도) */
export async function askClaude(prompt, { system = SYSTEM, schema = SCHEMA } = {}) {
  let res;
  try {
    res = await (await anthropic()).beta.messages.create({
      model: aiModel(), max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
      system,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (e) {
    if (!Anthropic) throw new AiError(503, 'Claude 라이브러리가 서버에 없습니다. update.sh 를 다시 실행하세요');
    if (e instanceof Anthropic.AuthenticationError) throw new AiError(503, 'Anthropic API 키가 올바르지 않습니다 (jcal-admin ai-key 로 다시 넣기)');
    if (e instanceof Anthropic.RateLimitError) throw new AiError(429, 'AI 사용량 한도에 걸렸습니다. 잠시 뒤 다시 시도하세요');
    if (e instanceof Anthropic.APIError) { console.error('[숏폼 AI · Claude]', e.status, e.message); throw new AiError(502, `AI 서버 오류 (${e.status ?? '연결'})`); }
    throw e;
  }
  if (res.stop_reason === 'refusal') throw new AiError(422, 'AI 가 이 글로는 스크립트를 만들지 않았습니다. 다른 글을 골라 주세요');
  if (res.stop_reason === 'max_tokens') throw new AiError(502, 'AI 응답이 너무 길어 잘렸습니다. 스크립트 글자 수를 줄여 주세요');
  return res.content.filter(b => b.type === 'text').map(b => b.text).join('');
}
/** 정해진 JSON 형식으로 AI 에게 묻기 (지금 설정된 회사로) */
export async function askJson(prompt, opts) {
  const text = aiProvider() === 'openai' ? await askOpenAI(prompt, opts) : await askClaude(prompt, opts);
  try { return JSON.parse(text); } catch { throw new AiError(502, 'AI 응답을 읽지 못했습니다. 다시 시도해 주세요'); }
}
export async function generateScripts(item, settings) {
  const S = clampSettings(settings);
  const prompt = `[설정]
- 후보 개수: ${S.count}개 (서로 다른 각도로)
- 제목: ${S.titleMax}자 이내, 클릭하고 싶은 한 줄
- 스크립트: 공백 포함 약 ${S.scriptChars}자 (±15%)
- 말투: ${S.tone}
- 해시태그: 후보마다 3~6개 (# 없이 단어만)${S.extra ? `\n- 추가 지시: ${S.extra}` : ''}

[게시판 글]
제목: ${item.title}
본문:
${String(item.body || '').slice(0, 12000) || '(본문 없음 — 제목만으로 씁니다)'}`;
  const text = aiProvider() === 'openai' ? await askOpenAI(prompt) : await askClaude(prompt);
  let data;
  try { data = JSON.parse(text); } catch { throw new AiError(502, 'AI 응답을 읽지 못했습니다. 다시 시도해 주세요'); }
  const list = (data.candidates || []).filter(c => c.title && c.script).slice(0, S.count);
  if (!list.length) throw new AiError(502, 'AI 가 후보를 만들지 못했습니다. 다시 시도해 주세요');
  return { model: `${aiProvider() === 'openai' ? 'ChatGPT' : 'Claude'} · ${aiModel()}`, list: list.map(c => ({ title: c.title.trim(), script: c.script.trim(), hashtags: (c.hashtags || []).map(h => String(h).replace(/^#/, '').trim()).filter(Boolean).slice(0, 8) })) };
}

/* ── 경로 ── */
export function shortsRoutes({ pool, tx, adminUser, HttpError }) {
  const user = adminUser;                                     // 1차: 관리자 계정만 (AI 비용이 관리자 키로 나가므로)
  const own = async (table, id, uid) => { const { rows } = await pool.query(`SELECT * FROM jcal.${table} WHERE id = $1 AND user_id = $2`, [id, uid]); if (!rows[0]) throw new HttpError(404, '없는 항목입니다'); return rows[0]; };
  const uuidOk = v => /^[0-9a-f-]{36}$/i.test(String(v || ''));
  const need = v => { if (!uuidOk(v)) throw new HttpError(400, 'id 가 올바르지 않습니다'); return v; };
  return {
    'GET /api/shorts': async req => {
      const u = await user(req);
      const [settings, sources, items, scripts] = await Promise.all([
        settingsOf(pool, u.id),
        pool.query('SELECT id, name, url, feed_url, full_text, body_pattern, active, last_fetched_at, last_count, last_error, created_at FROM jcal.shorts_sources WHERE user_id = $1 ORDER BY created_at', [u.id]),
        pool.query(`SELECT i.id, i.source_id, i.link, i.title, i.body, i.published_at, i.status, i.fetched_at FROM jcal.shorts_items i WHERE i.user_id = $1 ORDER BY COALESCE(i.published_at, i.fetched_at) DESC LIMIT 400`, [u.id]),
        pool.query('SELECT id, item_id, title, script, hashtags, chosen, model, created_at FROM jcal.shorts_scripts WHERE user_id = $1 ORDER BY created_at, id', [u.id]),
      ]);
      return { settings, sources: sources.rows, items: items.rows, scripts: scripts.rows, ai: { ready: aiReady(), provider: aiProvider(), model: aiModel() } };
    },

    'POST /api/shorts/settings': async (req, body) => {
      const u = await user(req);
      const cur = await settingsOf(pool, u.id);
      const data = clampSettings({ ...cur, ...body, video: body.video ? { ...cur.video, ...body.video, sub: { ...cur.video.sub, ...(body.video.sub || {}) } } : cur.video });
      await pool.query(`INSERT INTO jcal.shorts_settings (user_id, data) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [u.id, data]);
      return { settings: data };
    },

    'POST /api/shorts/source': async (req, body) => {
      const u = await user(req);
      const a = body.action;
      if (a === 'add') {
        const url = String(body.url || '').trim();
        if (!url) throw new HttpError(400, '게시판 주소를 넣어 주세요');
        let r;
        try { r = await resolveFeed(url); } catch (e) { throw new HttpError(400, e.message); }
        const { rows } = await pool.query(`INSERT INTO jcal.shorts_sources (user_id, name, url, feed_url, full_text, body_pattern) VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (user_id, feed_url) DO NOTHING RETURNING *`, [u.id, String(body.name || '').trim().slice(0, 100) || new URL(r.feedUrl).hostname, url, r.feedUrl, !!body.fullText, String(body.bodyPattern || '').slice(0, 500)]);
        if (!rows[0]) throw new HttpError(409, '이미 등록한 게시판입니다');
        const res = await collect(pool, rows[0]);
        return { source: rows[0], ...res, found: r.items.length };
      }
      const s = await own('shorts_sources', need(body.id), u.id);
      if (a === 'delete') { await pool.query('DELETE FROM jcal.shorts_sources WHERE id = $1', [s.id]); return { ok: true }; }
      if (a === 'fetch') return collect(pool, s);
      if (a === 'update') {
        await pool.query('UPDATE jcal.shorts_sources SET name = $2, active = $3, full_text = $4, body_pattern = $5 WHERE id = $1',
          [s.id, body.name !== undefined ? String(body.name).slice(0, 100) : s.name, body.active !== undefined ? !!body.active : s.active, body.fullText !== undefined ? !!body.fullText : s.full_text, body.bodyPattern !== undefined ? String(body.bodyPattern).slice(0, 500) : s.body_pattern]);
        return { ok: true };
      }
      throw new HttpError(400, 'action 은 add · update · delete · fetch 중 하나입니다');
    },

    'POST /api/shorts/item': async (req, body) => {
      const u = await user(req);
      const it = await own('shorts_items', need(body.id), u.id);
      if (!['new', 'picked', 'skipped'].includes(body.status)) throw new HttpError(400, '상태가 올바르지 않습니다');
      await pool.query('UPDATE jcal.shorts_items SET status = $2 WHERE id = $1', [it.id, body.status]);
      return { ok: true };
    },

    'POST /api/shorts/generate': async (req, body) => {
      const u = await user(req);
      if (!aiReady()) throw new HttpError(503, 'AI 키가 서버에 없습니다. VPS 터미널에서 jcal-admin ai-key 로 OpenAI API 키를 넣어 주세요');
      const it = await own('shorts_items', need(body.itemId), u.id);
      let out;
      try { out = await generateScripts(it, await settingsOf(pool, u.id)); }
      catch (e) { if (e instanceof AiError) throw new HttpError(e.status, e.message); console.error('[숏폼 AI]', e); throw new HttpError(500, 'AI 스크립트를 만들지 못했습니다'); }
      const rows = await tx(async c => {
        await c.query("UPDATE jcal.shorts_items SET status = 'picked' WHERE id = $1", [it.id]);
        const r = [];
        for (const s of out.list) r.push((await c.query('INSERT INTO jcal.shorts_scripts (user_id, item_id, title, script, hashtags, model, created_at) VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp()) RETURNING *', [u.id, it.id, s.title, s.script, s.hashtags.join(' '), out.model])).rows[0]);
        return r;
      });
      return { scripts: rows };
    },

    'POST /api/shorts/script': async (req, body) => {
      const u = await user(req);
      const s = await own('shorts_scripts', need(body.id), u.id);
      if (body.remove) { await pool.query('DELETE FROM jcal.shorts_scripts WHERE id = $1', [s.id]); return { ok: true }; }
      await tx(async c => {
        if (body.chosen === true) await c.query('UPDATE jcal.shorts_scripts SET chosen = false WHERE item_id = $1', [s.item_id]);   // 한 글에 하나만 고름
        await c.query('UPDATE jcal.shorts_scripts SET title = $2, script = $3, hashtags = $4, chosen = $5 WHERE id = $1',
          [s.id, body.title !== undefined ? String(body.title).slice(0, 300) : s.title, body.script !== undefined ? String(body.script).slice(0, 5000) : s.script,
            body.hashtags !== undefined ? String(body.hashtags).slice(0, 300) : s.hashtags, body.chosen !== undefined ? !!body.chosen : s.chosen]);
      });
      return { ok: true };
    },
  };
}
