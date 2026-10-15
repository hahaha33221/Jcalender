/* 아이디어 뱅크 · 숙원 사업 — 녹음(아이디어 · 회의)을 글로 받아 적고(STT), "중요"로 올린 것을 AI 가 핵심 3줄 + 할 일로 정리한다
   - POST /api/ideas/voice (본문 = 녹음 파일 audio/webm · mp4 · ogg · mpeg · wav, 최대 15MB) → { text }
     긴 녹음은 화면이 3분 단위 구간으로 나눠 녹음하는 동안 차례로 보냄 (구간마다 한 번)
     OpenAI 받아쓰기 (STT_MODEL 기본 gpt-4o-mini-transcribe, 키는 OPENAI_API_KEY — AI 공급자가 Claude 여도 받아쓰기는 OpenAI)
   - POST /api/ideas/structure { text, today, areas: [{ a, n, cats: [] }], goals: [{ id, name, a, cat, end }] }
     → { title, summary, area, cat, tags, points: ['핵심 한 줄' 3개, 긴 회의는 5개까지],
         actions(할 일): [{ type: event | todo | check | goal | note, title, who, date, time, cycle, goal, detail }] }
   - 로그인한 사람 누구나, 비용은 서버의 AI 키 → 한 사람 하루 받아쓰기 300구간(약 15시간) · 정리 60번 (IDEA_VOICE_DAILY · IDEA_AI_DAILY)
   - 녹음 파일은 받아 적은 뒤 바로 버린다 (서버에 남기지 않음) */
import { aiReady, aiProvider, aiModel, askJson, AiError } from './shorts.mjs';

const env = process.env;
const MAX_AUDIO = 15 * 1024 * 1024;
const LIMIT = { voice: Number(env.IDEA_VOICE_DAILY || 300), ai: Number(env.IDEA_AI_DAILY || 60) };
const MAX_TEXT = 80000;                                          // 받아 적은 글 (90분 회의 ≈ 3만 자)
const used = new Map();                                          // `${user}|${kind}` → { day, n }
const sttModel = () => env.STT_MODEL || 'gpt-4o-mini-transcribe';
const sttReady = () => !!env.OPENAI_API_KEY;
const EXT = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav' };

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['title', 'summary', 'area', 'cat', 'tags', 'points', 'actions'],
  properties: {
    title: { type: 'string' }, summary: { type: 'string' }, area: { type: 'string' }, cat: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    points: { type: 'array', items: { type: 'string' } },
    actions: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['type', 'title', 'who', 'date', 'time', 'cycle', 'goal', 'detail'], properties: {
      type: { type: 'string', enum: ['event', 'todo', 'check', 'goal', 'note'] }, title: { type: 'string' }, who: { type: 'string' }, date: { type: 'string' }, time: { type: 'string' },
      cycle: { type: 'string', enum: ['', 'D', 'W', 'M'] }, goal: { type: 'string' }, detail: { type: 'string' },
    } } },
  },
};
const SYSTEM = `당신은 녹음(혼자 말한 아이디어 또는 여러 사람의 회의)이나 메모를 받아 적은 글을 짧게 정리하고, 바로 실행할 일로 나눠 주는 한국어 비서입니다.
- 입력은 음성을 받아 적은 글이라 "어, 음, 그러니까" 같은 군말 · 반복 · 받아쓰기 오류가 있을 수 있습니다. 뜻을 살려 정리하고, 말하지 않은 사실은 지어내지 않습니다.
- title: 30자 이내 한 줄 (아이디어의 핵심, 회의면 회의 주제). summary: 전체를 한 문장으로.
- area: 주어진 영역 코드(P · W · B) 중 가장 맞는 하나. cat: 그 영역의 카테고리 목록에서 가장 맞는 하나 (없으면 빈 칸). tags: 2~5개 짧은 단어.
- points (핵심): 꼭 기억할 내용을 한 줄씩 3개 (짧은 메모면 1~2개, 긴 회의는 5개까지). 한 줄은 40자 안팎, 정해진 것 · 수치 · 이유를 우선. 할 일과 겹치는 내용은 쓰지 않습니다.
- actions (할 일): 지금 바로 적용할 다음 행동 1~6개 (who = 담당자, 말에 나오면. 없으면 빈 칸). 각 행동의 type:
  event = 날짜가 정해진 일 (캘린더 일정, date 필수 · 시각을 말했으면 time HH:MM)
  todo  = 목표에 붙일 할 일 (주어진 목표 목록 중 맞는 것이 있으면 goal 에 그 id, 없으면 빈 칸)
  check = 반복해서 할 습관 · 점검 (cycle: D 매일 · W 매주 · M 매월)
  goal  = 새로 세울 목표 (date = 마감, 말하지 않았으면 빈 칸)
  note  = 기록만 해 둘 것
- 날짜는 오늘을 기준으로 "내일 · 다음 주 화요일 · 이달 말"을 YYYY-MM-DD 로 바꿉니다. 정해지지 않았으면 빈 칸.
- 쓰지 않는 칸은 빈 문자열. 정해진 JSON 형식으로만 답합니다.`;

/* 숙원 사업 "AI 로 구체화": POST /api/wishes/shape { title, stage, q: { what, why, who, need, first, block, when }, refs: [글], today }
   → { fill: { 비어 있는 질문에 넣을 제안 }, next: [다음 작은 일 3개], cases: [비슷한 사례 · 참고할 점 2~3개] } */
const QK = ['what', 'why', 'who', 'need', 'first', 'block', 'when'];
const WISH_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['fill', 'next', 'cases'],
  properties: {
    fill: { type: 'object', additionalProperties: false, required: QK, properties: Object.fromEntries(QK.map(k => [k, { type: 'string' }])) },
    next: { type: 'array', items: { type: 'string' } }, cases: { type: 'array', items: { type: 'string' } },
  },
};
const WISH_SYSTEM = `당신은 "언젠가 꼭 하고 싶은 일(숙원 사업)"을 아직 아이디어 단계에서 조금씩 구체화하도록 돕는 한국어 코치입니다.
- 사용자가 적은 숙원 이름 · 단계 · 이미 답한 질문 · 모은 자료를 보고 돕습니다. 사용자가 말하지 않은 개인 사정은 지어내지 않습니다.
- fill: 7가지 질문(what 무엇을 · why 왜 · who 누구를 위해 · need 필요한 것(돈 · 시간 · 사람) · first 첫 작은 실험 · block 걸림돌 · when 언제쯤) 중
  이미 답한 칸은 빈 문자열, 비어 있는 칸만 한두 문장 제안 (사용자가 고쳐 쓸 초안. 금액 · 기간은 대략적인 범위로).
- next: 지금 단계에서 30분~2시간이면 할 수 있는 다음 작은 일 3개 (구체적인 행동, 한 줄씩).
- cases: 비슷한 일을 해 본 사람들의 일반적인 방식이나 참고할 점 2~3개 (특정인 · 가게 이름을 지어내지 않음).
- 정해진 JSON 형식으로만 답합니다.`;
const WISH_STAGE = ['', '씨앗(마음만 있음)', '탐색(자료 모으는 중)', '구체화(질문에 답하는 중)', '준비(첫 실험 · 필요한 것 정하는 중)', '착수'];

const okDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !Number.isNaN(new Date(`${s}T00:00:00`).getTime());
const clean = (s, n) => String(s || '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, n);

export function ideaRoutes({ authUser, HttpError }) {
  const take = (u, kind) => {
    const day = new Date().toISOString().slice(0, 10), k = `${u.id}|${kind}`, c = used.get(k);
    const n = c?.day === day ? c.n : 0;
    if (n >= LIMIT[kind]) throw new HttpError(429, `${kind === 'voice' ? '받아쓰기' : 'AI 정리'}는 하루 ${LIMIT[kind]}번까지입니다. 내일 다시 하거나 글로 적어 주세요`);
    return () => used.set(k, { day, n: n + 1 });
  };

  /** 녹음 → 글 (OpenAI 받아쓰기) */
  const voice = async req => {
    const u = await authUser(req);
    if (!sttReady()) throw new HttpError(503, '받아쓰기에 OpenAI API 키가 필요합니다. 관리자가 VPS 에서 jcal-admin ai-key 로 넣어야 합니다 (글로 적기는 그대로 쓸 수 있음)');
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!EXT[type]) throw new HttpError(415, '녹음 파일 형식이 아닙니다');
    const done = take(u, 'voice');
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > MAX_AUDIO) throw new HttpError(413, '녹음이 너무 깁니다 (15MB 까지, 약 10분)'); chunks.push(c); }
    if (size < 1000) throw new HttpError(400, '녹음이 너무 짧습니다');
    const fd = new FormData();
    fd.append('file', new Blob([Buffer.concat(chunks)], { type }), `idea.${EXT[type]}`);
    fd.append('model', sttModel());
    fd.append('language', 'ko');
    fd.append('response_format', 'json');
    let r;
    try {
      r = await fetch(`${(env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '')}/audio/transcriptions`, {
        method: 'POST', body: fd, signal: AbortSignal.timeout(120000), headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      });
    } catch (e) { throw new HttpError(502, e.name === 'TimeoutError' ? '받아쓰기가 너무 오래 걸립니다. 다시 시도해 주세요' : '받아쓰기 서버에 연결하지 못했습니다'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const code = j.error?.code || j.error?.type || '';
      console.error('[아이디어 받아쓰기]', r.status, code, j.error?.message);
      if (r.status === 401) throw new HttpError(503, 'OpenAI API 키가 올바르지 않습니다 (jcal-admin ai-key 로 다시 넣기)');
      if (code === 'insufficient_quota') throw new HttpError(402, 'OpenAI 크레딧(잔액)이 없습니다');
      if (r.status === 404 || code === 'model_not_found') throw new HttpError(503, `받아쓰기 모델을 쓸 수 없습니다: ${sttModel()} (STT_MODEL 확인)`);
      throw new HttpError(502, `받아쓰기 오류 (${r.status})`);
    }
    done();
    const text = clean(j.text, MAX_TEXT);
    if (!text) throw new HttpError(422, '말소리를 알아듣지 못했습니다. 조금 더 크게 다시 녹음해 주세요');
    return { text, model: sttModel() };
  };

  return {
    raw: { 'POST /api/ideas/voice': voice },
    json: {
      'GET /api/ideas/config': async req => { await authUser(req); return { stt: sttReady(), ai: aiReady() }; },
      'POST /api/wishes/shape': async (req, body) => {
        const u = await authUser(req);
        if (!aiReady()) throw new HttpError(503, 'AI 키가 서버에 없어 구체화 제안은 못 합니다');
        const title = clean(body.title, 100);
        if (title.length < 2) throw new HttpError(400, '숙원 이름이 너무 짧습니다');
        const stage = Math.min(5, Math.max(1, Number(body.stage) || 1)), q = body.q && typeof body.q === 'object' ? body.q : {};
        const refs = (Array.isArray(body.refs) ? body.refs : []).slice(0, 20).map(r => clean(r, 300)).filter(Boolean);
        const today = okDate(body.today) ? body.today : new Date().toISOString().slice(0, 10);
        const done = take(u, 'ai');
        const L = { what: '무엇을', why: '왜', who: '누구를 위해', need: '필요한 것', first: '첫 작은 실험', block: '걸림돌', when: '언제쯤' };
        const prompt = `[오늘] ${today}
[숙원] ${title}
[지금 단계] ${WISH_STAGE[stage]}
[질문과 답]
${QK.map(k => `- ${k} ${L[k]}: ${clean(q[k], 500) || '(비어 있음)'}`).join('\n')}
[모은 자료]
${refs.map(r => `- ${r}`).join('\n') || '- 없음'}`;
        let out;
        try { out = await askJson(prompt, { system: WISH_SYSTEM, schema: WISH_SCHEMA, name: 'wish_shape' }); }
        catch (e) { if (e instanceof AiError) throw new HttpError(e.status, e.message); console.error('[숙원 AI]', e); throw new HttpError(502, 'AI 제안을 받지 못했습니다. 다시 시도해 주세요'); }
        done();
        return {
          fill: Object.fromEntries(QK.map(k => [k, clean(q[k], 10) ? '' : clean(out.fill?.[k], 400)])),
          next: (out.next || []).map(x => clean(x, 120)).filter(Boolean).slice(0, 3),
          cases: (out.cases || []).map(x => clean(x, 300)).filter(Boolean).slice(0, 3),
          model: `${aiProvider() === 'openai' ? 'ChatGPT' : 'Claude'} · ${aiModel()}`,
        };
      },
      /** 글 → 정리 · 다음 행동 */
      'POST /api/ideas/structure': async (req, body) => {
        const u = await authUser(req);
        if (!aiReady()) throw new HttpError(503, 'AI 키가 서버에 없어 정리는 못 합니다. 아이디어는 그대로 저장됩니다');
        const text = clean(body.text, MAX_TEXT);
        if (text.length < 4) throw new HttpError(400, '아이디어 내용이 너무 짧습니다');
        const today = okDate(body.today) ? body.today : new Date().toISOString().slice(0, 10);
        const areas = (Array.isArray(body.areas) ? body.areas : []).slice(0, 3).map(a => ({ a: clean(a.a, 1), n: clean(a.n, 20), cats: (Array.isArray(a.cats) ? a.cats : []).slice(0, 40).map(c => clean(c, 30)).filter(Boolean) })).filter(a => /^[PWB]$/.test(a.a));
        const goals = (Array.isArray(body.goals) ? body.goals : []).slice(0, 40).map(g => ({ id: clean(g.id, 40), name: clean(g.name, 100), a: clean(g.a, 1), cat: clean(g.cat, 30), end: okDate(g.end) ? g.end : '' })).filter(g => g.id && g.name);
        const done = take(u, 'ai');
        const W = '일월화수목금토'[new Date(`${today}T00:00:00`).getDay()];
        const prompt = `[오늘] ${today} (${W}요일)

[영역 · 카테고리]
${areas.map(a => `- ${a.a} ${a.n}: ${a.cats.join(', ') || '(없음)'}`).join('\n') || '- P 개인: (없음)'}

[지금 있는 목표] (todo 를 붙일 때 id 를 그대로)
${goals.map(g => `- ${g.id} · ${g.name} (${g.a} ${g.cat}${g.end ? ` · 마감 ${g.end}` : ''})`).join('\n') || '- 없음'}

[녹음을 받아 적은 글]
${text}`;
        let out;
        try { out = await askJson(prompt, { system: SYSTEM, schema: SCHEMA, name: 'idea_card' }); }
        catch (e) { if (e instanceof AiError) throw new HttpError(e.status, e.message); console.error('[아이디어 AI]', e); throw new HttpError(502, 'AI 정리를 받지 못했습니다. 다시 시도해 주세요'); }
        done();
        const ids = new Set(goals.map(g => g.id)), A = areas.find(a => a.a === out.area) || areas[0] || { a: 'P', cats: [] };
        return {
          title: clean(out.title, 60) || clean(text, 30), summary: clean(out.summary, 800), area: A.a, cat: A.cats.includes(out.cat) ? out.cat : '',
          tags: (out.tags || []).map(t => clean(t, 20).replace(/^#/, '')).filter(Boolean).slice(0, 6),
          points: (out.points || []).map(p => clean(p, 300).replace(/^[-·•\s]+/, '')).filter(Boolean).slice(0, 5),
          actions: (out.actions || []).slice(0, 10).map(x => ({
            type: ['event', 'todo', 'check', 'goal', 'note'].includes(x.type) ? x.type : 'note', title: clean(x.title, 120), who: clean(x.who, 40), date: okDate(x.date) ? x.date : '',
            time: /^([01]\d|2[0-3]):[0-5]\d$/.test(x.time) ? x.time : '', cycle: ['D', 'W', 'M'].includes(x.cycle) ? x.cycle : '', goal: ids.has(x.goal) ? x.goal : '', detail: clean(x.detail, 300),
          })).filter(x => x.title),
          model: `${aiProvider() === 'openai' ? 'ChatGPT' : 'Claude'} · ${aiModel()}`,
        };
      },
    },
  };
}
