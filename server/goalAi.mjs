/* 목표 관리 온보딩 › 상세 To do 추천 (AI) — POST /api/goals/todos
   {area, start, end, level(0~2), hours(0~2), note, goals: [{ name, cat }]} → { goals: [{ milestones: [{name, date}], todos: [{name, start, end, how}] }], model }
   - 로그인한 사람 누구나 (회원 포함), 비용은 서버의 AI 키로 나가므로 한 사람 하루 20번까지
   - 날짜는 기간 안으로 맞추고 순서대로 정렬 */
import { aiReady, aiProvider, aiModel, askJson, AiError } from './shorts.mjs';

const AREA = { P: '개인 생활', B: '사업(자영업 · 1인 사업)', W: '직장 업무' };
const LEVEL = ['처음 시작함', '조금 해 봄', '꾸준히 하는 중'];
const HOURS = ['주 1~2시간', '주 3~5시간', '주 6시간 이상'];
const DAILY = Number(process.env.GOAL_AI_DAILY || 20);
const used = new Map();                                        // 사용자 → { day, n }
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['goals'],
  properties: { goals: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['index', 'milestones', 'todos'], properties: {
    index: { type: 'integer' },
    milestones: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'date'], properties: { name: { type: 'string' }, date: { type: 'string' } } } },
    todos: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'start', 'end', 'how'], properties: { name: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' }, how: { type: 'string' } } } },
  } } } },
};
const SYSTEM = `당신은 목표를 실행 가능한 할 일로 쪼개 주는 한국어 코치입니다.
- 할 일(To do)은 "무엇을 · 얼마나"가 분명한 구체적인 행동으로 씁니다 (예: "헬스장 3곳 비교하고 등록", "교재 1~3장 읽고 요약"). "열심히 하기" 같은 막연한 말은 쓰지 않습니다.
- 사람의 수준과 일주일에 쓸 수 있는 시간을 넘지 않게 양을 정합니다. 처음 시작하는 사람에게는 준비 · 습관 만들기부터 넣습니다.
- 할 일은 시간 순서대로, 기간 전체에 고르게 퍼지게 놓습니다. 반복되는 일은 "매주 ~" 처럼 한 줄로 기간을 길게 잡습니다.
- 마일스톤은 중간에 확인할 수 있는 결과(숫자 · 완성물)로 2~4개.
- 날짜는 YYYY-MM-DD, 반드시 주어진 기간 안. 정해진 JSON 형식으로만 답합니다.`;

const okDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !Number.isNaN(new Date(`${s}T00:00:00`).getTime());
const clampDate = (s, a, b) => (!okDate(s) ? a : s < a ? a : s > b ? b : s);

export function goalAiRoutes({ authUser, HttpError }) {
  return {
    'POST /api/goals/todos': async (req, body) => {
      const u = await authUser(req);
      if (!aiReady()) throw new HttpError(503, 'AI 키가 서버에 없습니다. 관리자가 VPS 에서 jcal-admin ai-key 로 넣어야 합니다 (기본 추천은 그대로 쓸 수 있음)');
      const day = new Date().toISOString().slice(0, 10), c = used.get(u.id);
      const n = c?.day === day ? c.n : 0;
      if (n >= DAILY) throw new HttpError(429, `AI 추천은 하루 ${DAILY}번까지입니다. 내일 다시 받거나 기본 추천을 쓰세요`);
      const start = String(body.start || ''), end = String(body.end || '');
      if (!okDate(start) || !okDate(end) || end < start) throw new HttpError(400, '기간이 올바르지 않습니다');
      const goals = (Array.isArray(body.goals) ? body.goals : []).map(g => ({ name: String(g.name || '').trim().slice(0, 120), cat: String(g.cat || '').slice(0, 40) })).filter(g => g.name).slice(0, 6);
      if (!goals.length) throw new HttpError(400, '목표를 하나 이상 적어 주세요');
      const days = Math.round((new Date(`${end}T00:00:00`) - new Date(`${start}T00:00:00`)) / 864e5) + 1;
      const per = Math.max(4, Math.min(12, Math.round(days / 14) + 3));
      const prompt = `[사람]
- 영역: ${AREA[body.area] || '개인 생활'}
- 지금 수준: ${LEVEL[body.level] ?? LEVEL[1]}
- 일주일에 쓸 수 있는 시간: ${HOURS[body.hours] ?? HOURS[1]}
- 추가로 알려 준 것: ${String(body.note || '').slice(0, 500) || '없음'}

[기간] ${start} ~ ${end} (${days}일)

[목표] (index 를 그대로 돌려주세요)
${goals.map((g, i) => `${i}. ${g.name}${g.cat ? ` (분야: ${g.cat})` : ''}`).join('\n')}

목표마다 상세 할 일 ${per}개 안팎과 마일스톤 2~4개를 만들어 주세요.`;
      let out;
      try { out = await askJson(prompt, { system: SYSTEM, schema: SCHEMA, name: 'goal_todos' }); }
      catch (e) { if (e instanceof AiError) throw new HttpError(e.status, e.message); console.error('[목표 AI]', e); throw new HttpError(502, 'AI 추천을 받지 못했습니다. 다시 시도해 주세요'); }
      used.set(u.id, { day, n: n + 1 });
      const res = goals.map((_, i) => {
        const g = (out.goals || []).find(x => x.index === i) || (out.goals || [])[i] || { milestones: [], todos: [] };
        const todos = (g.todos || []).filter(t => String(t.name || '').trim()).slice(0, 20).map(t => {
          const s = clampDate(t.start, start, end), e = clampDate(t.end, s, end);
          return { name: String(t.name).trim().slice(0, 120), start: s, end: e < s ? s : e, how: String(t.how || '').trim().slice(0, 200) };
        }).sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
        const milestones = (g.milestones || []).filter(m => String(m.name || '').trim()).slice(0, 6).map(m => ({ name: String(m.name).trim().slice(0, 120), date: clampDate(m.date, start, end) })).sort((a, b) => a.date.localeCompare(b.date));
        return { milestones, todos };
      });
      return { goals: res, model: `${aiProvider() === 'openai' ? 'ChatGPT' : 'Claude'} · ${aiModel()}`, left: DAILY - n - 1 };
    },
  };
}
