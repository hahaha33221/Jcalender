# Jcalender API 서버 설치 · 연결 안내

기준: 2026-10-01 · Hostinger KVM 2 (srv1809055.hstgr.cloud · 31.97.71.87) · 파일 `server/`, `db/`

## 1. 개요

- 목적: 맥북 · 휴대폰 · Vercel 주소 어디서 열어도 같은 데이터를 쓰도록 VPS에 로그인 · 동기화 서버를 둔다.
- 구성: 화면(Vercel 또는 맥북 `npm run dev`) → `https://srv1809055.hstgr.cloud` (Caddy, HTTPS 자동) → API 서버(Node, 8787번, 밖에서 직접 접속 불가) → PostgreSQL 16 (`jcal` DB, 테이블 48개).
- 도메인: 따로 사지 않는다. Hostinger 가 준 서버 이름 `srv1809055.hstgr.cloud` 가 이미 31.97.71.87 로 연결되어 있어 Let's Encrypt 인증서를 받을 수 있다.

## 2. 안건

| 번호 | 안건 | 결과물 |
|---|---|---|
| 1 | VPS 설치 | `server/deploy/setup.sh` (PostgreSQL 16 · Node 22 · Caddy · 방화벽 · 매일 백업) |
| 2 | API 서버 | `server/index.mjs` (로그인 · 동기화), `server/admin.mjs` (사용자 관리) |
| 3 | 앱 동기화 | 설정 › 서버 연결 (`src/serverSync.js`) |
| 4 | 표 갱신 | 올릴 때마다 `db/convert.mjs` 규칙으로 47개 표도 함께 갱신 |

## 3. 안건 별 주요 내용

### 3-1. 설치 (맥북 터미널, 처음 한 번 · 업데이트할 때도 같은 명령)

| 순서 | 명령 | 설명 |
|---|---|---|
| 1 | `cd ~/Jcalender && git pull` | 최신 파일 받기 |
| 2 | `bash server/deploy/update.sh` | 파일을 VPS 로 보내고 설치. root 비밀번호를 물으면 hPanel 에서 정한 비밀번호 입력 (5~10분) |
| 3 | `ssh root@31.97.71.87` | VPS 접속 |
| 4 | `cd /opt/jcalender/server && node admin.mjs add-user 내이메일 이름` | 앱 로그인 계정 만들기. 비밀번호(8자 이상)를 두 번 입력 (화면에 안 보임) |
| 5 | `curl https://srv1809055.hstgr.cloud/api/health` | `{"ok":true,...}` 가 나오면 완료 |

- 마지막 줄에 "완료"와 API 주소가 나오면 설치가 끝난 것이다.
- `ssh` 가 처음이면 "Are you sure you want to continue connecting" 에 `yes` 를 입력한다.

### 3-2. 앱에서 연결

1. 앱 › 설정 › **서버 연결**: 서버 주소(기본값 그대로), 이메일, 비밀번호 → 로그인
2. 처음 로그인한 기기(맥북)는 서버가 비어 있으므로 이 기기 데이터를 바로 올린다.
3. 두 번째 기기(휴대폰 · Vercel)는 "서버에 이미 데이터가 있습니다" → **서버 데이터 받기**를 고른다.
4. 그 뒤로는 바뀐 내용이 3초 뒤 자동으로 올라가고, 앱을 열거나 창으로 돌아올 때 · 5분마다 새 내용을 받는다.

### 3-3. 동기화 규칙

| 상황 | 동작 |
|---|---|
| 이 기기에서 바꿈 | 3초 뒤 서버로 올림 (버전 +1) |
| 다른 기기가 올림, 이 기기는 바꾼 것 없음 | 자동으로 받음 |
| 둘 다 바꿈 (충돌) | 화면 위 안내 → 설정에서 "서버 데이터 받기" 또는 "이 기기 데이터로 서버 덮어쓰기" 선택 |
| 인터넷 끊김 | 이 기기에 저장, 다시 연결되면 올림 |
| API 키 · 토큰 | 서버로 보내지 않음 (기기마다 따로) |

### 3-4. 보안

| 항목 | 내용 |
|---|---|
| 접속 | HTTPS 만 (Caddy 가 인증서 자동 갱신). API 서버와 DB 는 밖에서 직접 접속 불가 |
| 방화벽 | 22(SSH) · 80 · 443 만 허용 |
| 비밀번호 | scrypt 해시로 저장, 15분에 10번 틀리면 잠시 막음 |
| 로그인 토큰 | 서버에는 해시만 저장, 90일 유효, 로그아웃하면 바로 무효 |
| 화면 주소 제한 | `*.vercel.app`, `http://localhost:5288` 에서 온 요청만 허용 (`/etc/jcalender.env` 의 `ALLOWED_ORIGINS`) |
| DB 비밀번호 | 설치할 때 무작위로 만들어 `/etc/jcalender.env` (root 만 읽기) 에 저장 |

## 4. 결론

- 맥북에서 명령 두 줄(`update.sh`, `add-user`)로 VPS 설치가 끝나고, 앱 설정에서 로그인하면 여러 기기가 같은 데이터를 쓴다.
- 이 환경의 Ubuntu 24.04 에서 설치 스크립트를 두 번 실행해 같은 결과(테이블 48개 · API 응답 · 백업)를 확인했고, API 점검 23개 · 두 기기 동기화 점검 12개를 통과했다.

## 5. 향후 진행 사항

| 순서 | 할 일 | 내용 |
|---|---|---|
| 1 | 설치 실행 | 위 3-1 순서대로 (막히면 터미널 화면을 그대로 보내 주기) |
| 2 | Vercel 주소 확정 후 제한 | `ALLOWED_ORIGINS=https://내주소.vercel.app,http://localhost:5288 bash server/deploy/update.sh` |
| 3 | 명함 이미지 파일 저장소 | 지금은 데이터 안에 함께 올라감 (최대 30MB). 많아지면 서버 파일로 분리 |
| 4 | 비밀 정보 동기화 | 필요하면 API 키를 서버 `user_secrets` 에 암호화해 저장 |

## 6. 기타

- 서버 상태: `systemctl status jcal-api` · 로그: `journalctl -u jcal-api -n 50`
- 사용자 · 동기화 현황: `cd /opt/jcalender/server && node admin.mjs list`
- 비밀번호 바꾸기: `node admin.mjs set-password 내이메일` (모든 기기 로그아웃)
- 백업: 매일 새벽 4시 17분 `/var/backups/jcalender/` (14일 보관) · 로그 `/var/log/jcal-backup.log`
- 백업으로 되돌리기 (root):
  - `systemctl stop jcal-api && runuser -u postgres -- dropdb jcal && runuser -u postgres -- createdb -O jcal jcal`
  - `set -a; . /etc/jcalender.env; set +a; gunzip -c /var/backups/jcalender/jcal_날짜.sql.gz | psql "$DATABASE_URL" && systemctl start jcal-api`
- Hostinger hPanel › VPS › 방화벽을 따로 켜 두었다면 80 · 443 번도 허용해야 인증서가 발급된다.
