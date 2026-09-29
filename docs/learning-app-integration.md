# 자기계발/학습 앱 연동 안내

생활 관리 앱의 **개인 › 자기계발/학습** 화면에는 영어 · 독서 · 기타 3개의 카드가 있습니다.
직접 개발하는 학습 앱이 아래 형식의 JSON 을 제공하면, 카드와 아래 공부 시간 · 과목별 진도 · 공부 기록에 함께 반영됩니다.

## 1. 연결 방법

1. 카드의 **연동 설정** 을 누릅니다.
2. 입력 항목
   - 앱 이름: 카드에 표시할 이름
   - 앱 주소 (열기): 아이콘과 "앱 열기" 버튼이 여는 주소 (웹 주소 또는 앱 링크)
   - 데이터 주소 (동기화, JSON): 아래 형식의 JSON 을 돌려주는 주소
3. **동기화** 를 누르면 데이터 주소에서 기록을 가져옵니다.
   서버가 없다면 **JSON 파일 불러오기** 로 같은 형식의 파일을 직접 넣을 수 있습니다.

카드 키: `english`(영어), `reading`(독서), `guitar`(기타)

## 2. JSON 형식

```json
{
  "app": "나의 영어 앱",
  "updatedAt": "2026-09-29T21:00:00+09:00",
  "summary": {
    "todayMinutes": 25,
    "weekMinutes": 45,
    "streakDays": 6,
    "progress": 62,
    "progressLabel": "단어장 진도"
  },
  "sessions": [
    { "date": "2026-09-29", "minutes": 25, "title": "단어 30개 암기" }
  ]
}
```

| 항목 | 필수 | 설명 |
|---|---|---|
| app | 선택 | 앱 이름 |
| updatedAt | 선택 | 데이터 생성 시각 |
| summary.todayMinutes | 선택 | 오늘 학습 시간(분) |
| summary.weekMinutes | 선택 | 이번 주 학습 시간(분) |
| summary.streakDays | 선택 | 연속 학습 일수 |
| summary.progress | 선택 | 진행률 0~100 (없으면 막대 숨김) |
| summary.progressLabel | 선택 | 진행률 이름 (예: 단어장 진도) |
| sessions[] | 선택 | 학습 기록. date(YYYY-MM-DD), minutes(분), title(내용) |

- `summary` 와 `sessions` 중 하나는 있어야 합니다.
- 기록은 최근 50건까지 저장합니다. 동기화할 때마다 해당 카드의 기록 전체를 새 값으로 바꿉니다.
- sessions 는 "공부 기록"에 "앱 연동" 표시로 들어가고, 이름이 카드 이름(영어/독서/기타)으로 시작하는 과목의 진도에 합산됩니다.
- 연동 기록이 하나라도 있으면 예시 공부 기록은 계산에서 빠집니다.

## 3. CORS (브라우저 보안)

생활 관리 앱은 브라우저에서 바로 데이터 주소를 요청합니다. 학습 앱 서버가 다른 주소라면 응답에 아래 헤더가 필요합니다.

```
Access-Control-Allow-Origin: *        (또는 생활 관리 앱 주소, 예: http://localhost:5288)
Content-Type: application/json
```

헤더가 없으면 "동기화하지 못했습니다" 메시지가 나옵니다. 이때는 JSON 파일 불러오기를 사용하세요.

## 4. 시험용 파일

- `samples/learning_english_sample.json`
- `samples/learning_reading_sample.json`
- `samples/learning_guitar_sample.json`
