# Recording API

안드로이드 휴대폰의 녹음 파일을 주기적으로 받아 저장하는 API 서버입니다.

## 1. 서버 설치/실행

```bash
npm install
API_TOKEN=길고_랜덤한_문자열 node server.js
```

| 환경변수 | 설명 | 기본값 |
|---|---|---|
| API_TOKEN | 인증 토큰 (필수) | 없음 |
| PORT | 포트 | 3000 |
| DATA_DIR | 파일·DB 저장 위치 | ./data |

토큰 생성 예: `openssl rand -hex 32`

저장 구조: `data/files/` (녹음 파일), `data/recordings.db` (SQLite 메타데이터)

운영 시 확인 사항
- HTTPS 적용 (nginx 등 리버스 프록시 사용 권장)
- nginx 사용 시 `client_max_body_size 200M;` 추가 (기본 1MB라 업로드 거절됨)
- 상시 실행: `pm2 start server.js --name recording-api` 등

## 2. API 명세

모든 요청(health 제외)에 헤더 필요: `Authorization: Bearer <API_TOKEN>`

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | /api/health | 서버 상태 확인 (인증 불필요) |
| POST | /api/recordings | 녹음 파일 업로드 (multipart: curl, Termux, 웹 폼) |
| POST | /api/recordings/raw | 녹음 파일 업로드 (본문에 파일 그대로: MacroDroid) |
| GET | /api/recordings | 목록 조회 |
| GET | /api/recordings/:id | 단건 정보 |
| GET | /api/recordings/:id/file | 파일 다운로드/재생 |
| DELETE | /api/recordings/:id | 삭제 |

### POST /api/recordings

multipart/form-data

| 필드 | 필수 | 설명 |
|---|---|---|
| device | 선택 | 기기 이름 (영문/숫자/-/_) |
| recorded_at | 선택 | 녹음 시각 (유닉스 초) |
| file | 필수 | 오디오 파일 (m4a, mp3, amr, wav, 3gp, ogg, aac / 최대 200MB) |

응답
- 201: 새로 저장됨 `{"duplicate": false, "recording": {...}}`
- 200: 같은 내용의 파일이 이미 있음 `{"duplicate": true, "recording": {...}}`
- 400: file 없음 / 401: 토큰 오류 / 413: 용량 초과 / 415: 허용되지 않는 형식

recording 객체
```json
{
  "id": 1,
  "device": "phone01",
  "filename": "통화 녹음 홍길동_261125.m4a",
  "size": 50000,
  "sha256": "6eba...",
  "recorded_at": "2026-11-25T00:10:35.000Z",
  "uploaded_at": "2026-11-25 00:15:35",
  "download_url": "/api/recordings/1/file"
}
```

중복 판정은 파일 내용(SHA-256) 기준입니다.

### POST /api/recordings/raw (MacroDroid용)

요청 본문 = 파일 내용 그대로 (Content-Type: application/octet-stream 등)

| 쿼리 파라미터 | 필수 | 설명 |
|---|---|---|
| filename | 필수 | 원래 파일 이름 (확장자 포함, 한글 가능) |
| device | 선택 | 기기 이름 |
| recorded_at | 선택 | 녹음 시각 (유닉스 초) |

응답 코드와 형식은 `/api/recordings`와 같습니다.

```bash
curl -H "Authorization: Bearer 토큰" -H "Content-Type: application/octet-stream" \
     --data-binary "@test.m4a" -X POST \
     "https://내사이트.com/api/recordings/raw?device=test&filename=test.m4a"
```

### GET /api/recordings

쿼리: `device`, `from`(YYYY-MM-DD), `to`(YYYY-MM-DD), `limit`(기본 50, 최대 500), `offset`

```json
{ "total": 1, "limit": 50, "offset": 0, "items": [ {recording}, ... ] }
```

### 테스트 (PC에서)

```bash
curl -H "Authorization: Bearer 토큰" --form-string "device=test" \
     -F "file=@test.m4a" https://내사이트.com/api/recordings
curl -H "Authorization: Bearer 토큰" https://내사이트.com/api/recordings
```

## 3. 휴대폰 설정

- MacroDroid 사용: `phone/macrodroid-guide.md` 참고
- Termux 사용 (보조 또는 대안): 아래 참고

### Termux

1. F-Droid에서 Termux, Termux:API 설치
2. Termux에서 실행
   ```bash
   pkg update && pkg install curl termux-api
   termux-setup-storage
   ```
3. `phone/upload.sh`를 휴대폰 `~/upload.sh`로 복사 후 URL, TOKEN, DEVICE, SRC 수정
4. 테스트
   ```bash
   chmod +x ~/upload.sh
   ~/upload.sh
   cat ~/upload.log
   ```
5. 15분마다 자동 실행 (Wi-Fi일 때만, 재부팅 후 유지)
   ```bash
   termux-job-scheduler --script ~/upload.sh --period-ms 900000 \
     --network unmetered --persisted true
   ```
   확인 `termux-job-scheduler --pending` / 해제 `termux-job-scheduler --cancel-all`
6. 휴대폰 설정 → 애플리케이션 → Termux, Termux:API → 배터리 → 제한 없음
