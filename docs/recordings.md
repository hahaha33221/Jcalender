# 녹음 · 회의록 (서버 1.18.0)

휴대폰 통화 · 음성 녹음이 올라오면 서버가 받아 적고(STT) AI 가 회의록으로 정리해, 대시보드 맨 아래 "녹음 · 회의록" 칸(관리자 계정만)에 저절로 보여 준다.

## 1. 개요

- 녹음 받기: `recording-api/` (서비스 `jcal-recording`, 127.0.0.1:8790, 설치 `recording-api/deploy/update.sh`). 휴대폰은 `https://rec-31-97-71-87.sslip.io/api/recordings/raw` 로 올린다
- 받아쓰기 · 회의록: `server/recordings.mjs` (jcal-api 안의 작업자, 1분마다 새 녹음 확인, 한 번에 1건)
- 저장: `jcal.recording_minutes` (`db/migrations/013_recordings.sql`). 녹음 파일은 jcal-recording 에만 있고 jcal-api 는 처리할 때만 임시로 받는다
- 화면: `src/Recordings.jsx` (30초마다, 처리 중이면 10초마다 목록 갱신)

## 2. 안건

1. 처리 흐름
2. API
3. 설정

## 3. 안건 별 주요 내용

### 처리 흐름

1. 새 녹음 발견 → 최근 `MINUTES_BACKFILL_HOURS`(48시간) 안에 올라온 것은 "대기", 더 오래된 것은 "수동"(버튼으로 만들기)
2. ffmpeg 로 16kHz 모노 mp3 · 10분 조각 → OpenAI 받아쓰기 (`MINUTES_STT_MODEL`, 기본 gpt-4o-mini-transcribe, 한국어)
3. AI 회의록 (JSON 스키마 고정): 제목 · 종류 · 한 줄 요약 · 1. 개요 · 2. 안건 · 3. 안건 별 주요 내용 · 4. 결론 · 5. 향후 진행 사항(할 일 · 담당 · 기한) · 6. 기타
   - Anthropic 키가 있으면 Claude (`MINUTES_MODEL`, 기본 claude-opus-5-5), 없으면 ChatGPT
4. 실패하면 "실패" + 이유. 화면의 "다시 시도" · "다시 만들기"는 대기열 맨 앞으로 (하루 한도 · 길이 제한 없음)
5. 서버가 처리 중에 꺼지면 다시 켜질 때 이어서 처리

### API (관리자만)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | /api/minutes | 목록 · 준비 상태(녹음 서버 · 받아쓰기 키 · AI 키) · 오늘 자동 처리 수 |
| GET | /api/minutes/item?id= | 회의록 · 전문 |
| POST | /api/minutes/process {id} | 지금 만들기 · 다시 만들기 |
| POST | /api/minutes/delete {id} | 녹음 파일 · 회의록 지우기 |
| GET | /api/minutes/audio?id= | 녹음 파일 (재생) |

### 설정 (/etc/jcalender.env)

| 이름 | 기본값 | 설명 |
|---|---|---|
| RECORDING_API_URL | http://127.0.0.1:8790 | server/deploy/setup.sh 가 /etc/jcal-recording.env 의 PORT 로 넣음 |
| RECORDING_API_TOKEN | /etc/jcal-recording.env 의 API_TOKEN | setup.sh 가 옮겨 넣음 (휴대폰에도 같은 값) |
| MINUTES_AUTO | 1 | 0 이면 버튼으로만 |
| MINUTES_DAILY | 30 | 하루 자동 처리 한도 |
| MINUTES_BACKFILL_HOURS | 48 | 처음 발견했을 때 자동 처리할 범위 |
| MINUTES_MAX_MIN | 180 | 이보다 긴 녹음은 자동 처리 안 함 (분) |
| MINUTES_STT_MODEL | gpt-4o-mini-transcribe | 받아쓰기 모델 (더 정확: gpt-4o-transcribe) |
| MINUTES_PROVIDER | Anthropic 키가 있으면 anthropic | anthropic 또는 openai |
| MINUTES_MODEL | claude-opus-5-5 | 비용을 줄이려면 claude-sonnet-5-5 |
| MINUTES_POLL_SEC | 60 | 새 녹음 확인 주기 (초) |
| MINUTES_WORKER | 1 | 0 이면 작업자 끔 |

## 4. 결론

recording-api 는 받기 전용, 받아쓰기 · 회의록은 jcal-api 가 맡는다. 키 · 토큰은 VPS 설정 파일에만 둔다.

## 5. 향후 진행 사항

1. `bash recording-api/deploy/update.sh` (녹음 서버 jcal-recording 설치, 끝나면 주소 · 토큰을 보여 줌)
2. `bash server/deploy/update.sh` (DB 표 추가 · 녹음 서버 토큰 연결 · jcal-api 재시작)
3. VPS 에서 `jcal-admin ai-key` 로 OpenAI 키 · Anthropic 키 넣기 (각각 한 번씩)
4. 휴대폰 MacroDroid 에 1번의 주소 · 토큰 넣기 (`recording-api/macrodroid-guide.md`)
5. 짧은 시험 녹음 → 1~2분 뒤 대시보드 맨 아래 확인

## 6. 기타

- 확인: `journalctl -u jcal-recording -n 30` (녹음 받기) · `journalctl -u jcal-api -n 50 | grep 회의록` (처리)
- 2단계 후보: 화자 구분(CLOVA Speech), 할 일을 목표 To do · 체크리스트로, 회의록 직접 고치기
