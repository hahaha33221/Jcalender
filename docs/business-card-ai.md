# 명함 AI 분석 연동 안내

**개인 › 인맥 관리 › 명함 촬영**에서 찍은 명함 사진을 AI 로 분석해 이름·회사·연락처를 채웁니다.
설정은 화면의 **AI 분석 설정** 버튼에서 합니다. 설정 값은 이 브라우저에만 저장됩니다(store.cardAi).

## 1. 사용 흐름

1. **명함 촬영**(휴대폰에서는 카메라가 열림) → 찍을 때마다 대기열에 쌓이고 바로 뒤에서 분석합니다.
   **한 장 더 촬영**으로 계속 찍거나, **사진에서 여러 장 선택**으로 한 번에 올릴 수 있습니다.
2. **등록 시작** → 명함마다 온보딩 4단계
   1. 결과 확인: AI 가 읽은 이름·휴대폰·회사·직함·이메일·주소를 확인하고 고칩니다.
   2. 관계: 가족 / 친구 / 동료 / 지인
   3. 생일·기념일: 있어요(날짜 입력, "기념일 관리에도 추가" 선택) / 없어요
   4. 완료: 요약을 보고 저장 → 다음 명함으로 넘어갑니다.
3. 분석에 실패하거나 AI 를 쓰지 않으면 1단계에서 직접 입력합니다.

## 2. 분석 방식

| 방식 | 설명 |
|---|---|
| 사용 안 함 | 분석 없이 온보딩에서 직접 입력 |
| 내 서버 (권장) | 직접 만든 서버에 사진을 보내고 결과 JSON 을 받습니다. API 키는 서버에만 둡니다. |
| Claude API 직접 호출 | 브라우저에서 Claude API 를 바로 부릅니다. API 키가 브라우저에 저장되므로 개인 기기에서만 쓰세요. |

## 3. 내 서버 형식

요청

```
POST {서버 주소}
Content-Type: application/json
Authorization: Bearer {인증 토큰}      (설정한 경우만)

{ "image": "data:image/jpeg;base64,/9j/4AAQ..." }
```

응답 (없는 값은 빈 문자열)

```json
{ "name": "홍길동", "company": "예시상사", "title": "팀장", "phone": "010-1234-5678", "email": "hong@example.com", "address": "서울시 ..." }
```

- `{ "card": {...} }`, `{ "result": {...} }` 처럼 한 번 감싸도 읽습니다.
- 생활 관리 앱과 주소가 다르면 CORS 헤더(`Access-Control-Allow-Origin`)가 필요합니다.

## 4. 서버 예시 (Node.js 18+, Claude API 사용)

```js
// server.js  —  ANTHROPIC_API_KEY=sk-ant-... node server.js
import http from 'node:http';

const PROMPT = '이 명함 사진에서 정보를 읽어 {"name","company","title","phone","email","address"} JSON 하나만 답하세요. 없는 값은 빈 문자열.';

http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.end();
  let body = '';
  for await (const chunk of req) body += chunk;
  const { image } = JSON.parse(body);
  const [head, data] = image.split(',');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-5-5', max_tokens: 1024,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: head.match(/data:([^;]+)/)[1], data } },
        { type: 'text', text: PROMPT },
      ] }],
    }),
  });
  const j = await r.json();
  const text = (j.content || []).map(b => b.text || '').join('');
  res.setHeader('Content-Type', 'application/json');
  res.end(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1) || '{}');
}).listen(8787, () => console.log('http://localhost:8787'));
```

서버 주소에 `http://localhost:8787` 을 넣으면 됩니다.
