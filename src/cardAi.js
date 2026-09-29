/* 명함 이미지 AI 분석 연동 (docs/business-card-ai.md)
   설정 store.cardAi = { mode, endpoint, token, apiKey, model }
   - mode 'off'     : 분석하지 않고 온보딩에서 직접 입력
   - mode 'server'  : 직접 만든 서버로 POST { image: 'data:image/jpeg;base64,...' } → 명함 JSON
   - mode 'claude'  : 브라우저에서 Claude API 를 바로 호출 (API 키가 이 브라우저에 저장되므로 개인 기기에서만)
   결과(명함 JSON): { name, company, title, phone, email, address } — 없는 값은 빈 문자열 */

export const CARD_AI_DEFAULT = { mode: 'off', endpoint: '', token: '', apiKey: '', model: 'claude-sonnet-5-5' };
export const FIELDS = ['name', 'company', 'title', 'phone', 'email', 'address'];

export const PROMPT = `이 명함 사진에서 정보를 읽어 아래 JSON 한 개만 답하세요. 설명이나 코드 블록 없이 JSON 만 출력합니다.
{"name":"이름","company":"회사","title":"직함","phone":"휴대폰 번호(없으면 대표 번호)","email":"이메일","address":"주소"}
읽을 수 없는 항목은 빈 문자열로 둡니다. 전화번호는 010-1234-5678 형식으로 씁니다.`;

/** 여러 형태의 응답을 명함 JSON 으로 맞춤 */
export function normalizeCard(j) {
  const src = j && typeof j === 'object' ? (j.card || j.result || j.data || j) : {};
  const out = {};
  FIELDS.forEach(k => { out[k] = String(src[k] ?? src[{ phone: 'mobile', title: 'position', company: 'organization' }[k]] ?? '').trim(); });
  return out;
}

/** 글 속의 첫 JSON 객체 꺼내기 */
export function extractJson(text) {
  const s = String(text || ''), i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j <= i) throw new Error('AI 응답에서 JSON 을 찾지 못했습니다');
  return JSON.parse(s.slice(i, j + 1));
}

export async function analyzeCard(dataUrl, cfg) {
  const c = { ...CARD_AI_DEFAULT, ...(cfg || {}) };
  if (c.mode === 'server') {
    if (!c.endpoint) throw new Error('서버 주소가 없습니다');
    const r = await fetch(c.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(c.token ? { Authorization: `Bearer ${c.token}` } : {}) },
      body: JSON.stringify({ image: dataUrl }),
    });
    if (!r.ok) throw new Error(`서버 응답 ${r.status}`);
    return normalizeCard(await r.json());
  }
  if (c.mode === 'claude') {
    if (!c.apiKey) throw new Error('API 키가 없습니다');
    const [head, data] = dataUrl.split(',');
    const media = (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({
        model: c.model || CARD_AI_DEFAULT.model, max_tokens: 1024,
        messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: media, data } }, { type: 'text', text: PROMPT }] }],
      }),
    });
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(j?.error?.message || `API 응답 ${r.status}`);
    return normalizeCard(extractJson((j.content || []).map(b => b.text || '').join('')));
  }
  return null;                                           // 분석 안 함 → 직접 입력
}
