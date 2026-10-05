# Jcalender API 서버 설치 · 연결 안내

기준: 2026-10-01 · Hostinger KVM 2 (31.97.71.87, 다른 서비스와 함께 쓰는 VPS) · 파일 `server/`, `db/`

## 1. 개요

- 목적: 맥북 · 휴대폰 · Vercel 주소 어디서 열어도 같은 데이터를 쓰도록 VPS에 로그인 · 동기화 서버를 둔다.
- 구성: 화면(Vercel `https://jcalender-amber.vercel.app` 또는 맥북 `npm run dev`) → `https://jcal-31-97-71-87.sslip.io` (기존 Nginx 에 전용 설정 1개) → API 서버(전용 Node, 127.0.0.1:8787) → 기존 PostgreSQL 16 클러스터(5433) 안의 전용 `jcal` DB (테이블 48개).
- 도메인: 사지 않는다. `jcal-31-97-71-87.sslip.io` 는 무료 주소로 31.97.71.87 로 연결되며, Jcalender 만 쓰는 이름이라 다른 사이트와 겹치지 않는다.
- 다른 서비스와 분리: 아래 3-6 표 참고. 방화벽 · 다른 Nginx 사이트 · 도커 · 시스템 Node · pm2 는 건드리지 않는다.

## 2. 안건

| 번호 | 안건 | 결과물 |
|---|---|---|
| 1 | VPS 설치 | `server/deploy/setup.sh` (전용 DB · 전용 Node · Nginx 전용 설정 · 인증서 · 매일 백업) |
| 2 | API 서버 | `server/index.mjs` (로그인 · 동기화), `server/admin.mjs` (사용자 관리) |
| 3 | 앱 동기화 · 로그인 | 처음 화면 로그인 / 회원가입 (`src/Welcome.jsx`), 설정 › 계정 · 서버 연결 (`src/serverSync.js`) |
| 4 | 표 갱신 | 올릴 때마다 `db/convert.mjs` 규칙으로 47개 표도 함께 갱신 |

## 3. 안건 별 주요 내용

### 3-1. 설치 (맥북 터미널, 처음 한 번 · 업데이트할 때도 같은 명령)

| 순서 | 명령 | 설명 |
|---|---|---|
| 1 | `cd ~/Jcalender && git pull` | 최신 파일 받기 |
| 2 | `bash server/deploy/update.sh` | 파일을 VPS 로 보내고 설치. root 비밀번호를 물으면 hPanel 에서 정한 비밀번호 입력 (5~10분) |
| 3 | `ssh root@31.97.71.87` | VPS 접속 |
| 4 | `jcal-admin add-user 내이메일 이름` | 앱 로그인 계정 만들기. 비밀번호(8자 이상)를 두 번 입력 (화면에 안 보임) |
| 5 | `curl https://jcal-31-97-71-87.sslip.io/api/health` | `{"ok":true,...}` 가 나오면 완료 |

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
| 접속 | HTTPS 만 (certbot 이 인증서 자동 갱신). API 서버와 DB 는 밖에서 직접 접속 불가 |
| 방화벽 | 기존 설정 그대로 (이미 80 · 443 허용). 스크립트는 ufw 를 바꾸지 않음 |
| 비밀번호 | scrypt 해시로 저장, 15분에 10번 틀리면 잠시 막음 |
| 로그인 토큰 | 서버에는 해시만 저장, 90일 유효, 로그아웃하면 바로 무효 |
| 화면 주소 제한 | `https://jcalender-amber.vercel.app`, `http://localhost:5288` 에서 온 요청만 허용 (`/etc/jcalender.env` 의 `ALLOWED_ORIGINS`) |
| DB 비밀번호 | 설치할 때 무작위로 만들어 `/etc/jcalender.env` (root 만 읽기) 에 저장 |

### 3-5. 여러 사용자 (회원가입 · 사용자별 데이터)

| 항목 | 내용 |
|---|---|
| 처음 화면 | 사이트를 열면 로그인 / 회원가입 화면. 로그인해야 앱이 열린다 ("로그인 없이 둘러보기"는 이 기기에만 저장) |
| 회원가입 | 이름 · 이메일 · 비밀번호(8자 이상) · 초대 코드. 가입하면 빈 데이터로 시작 |
| 데이터 분리 | 서버의 모든 표가 사용자별(user_id)로 나뉘어 다른 사람 데이터를 볼 수 없음. 카테고리 · 체크 규칙 · 기록 모두 각자 설정 |
| 같은 기기를 여럿이 | 로그아웃하면 그 브라우저의 데이터를 지움 (서버에는 남음). 다음 사람이 로그인하면 자기 데이터만 받음 |
| 새 기기 | 로그인하면 서버의 내 데이터를 바로 받음 |
| 비밀번호 | 설정 › 계정 · 서버 연결 › 비밀번호 바꾸기 (다른 기기는 다시 로그인) |

관리자 명령 (VPS):

| 명령 | 설명 |
|---|---|
| `jcal-admin signup` | 회원가입 방식 · 초대 코드 보기 |
| `jcal-admin signup code` | 새 초대 코드 만들기 (예전 코드는 못 씀) |
| `jcal-admin role <이메일> member\|suspended` | 권한 바꾸기: 일반 · 정지(로그인 불가). 앱의 "회원 관리" 메뉴에서도 바꿀 수 있음 |
| `jcal-admin ai-key` | 숏폼 제작용 ChatGPT(OpenAI, sk-…) 또는 Claude(sk-ant-…) API 키 넣기 · 바꾸기 (화면에 안 보임, 저장 뒤 서버 재시작). 영상 나레이션 음성은 OpenAI 키로만 만든다. docs/shorts.md 참고 |
| `jcal-admin pexels-key` | 숏폼 무료 소재(Pexels) API 키 넣기 · 바꾸기 (pexels.com/api 에서 무료) |
| `jcal-admin youtube-key` | 숏폼 유튜브 업로드용 Google OAuth 클라이언트 ID · 보안 비밀번호 (docs/shorts.md 3-6) |
| `jcal-admin instagram-key` | 숏폼 인스타그램 업로드용 Meta 앱의 Instagram 앱 ID · 시크릿 (docs/shorts.md 3-6) |
| `jcal-admin signup open` / `closed` | 누구나 가입 / 가입 막기 |
| `jcal-admin list` | 사용자 · 동기화 현황 |
| `jcal-admin rename 이메일 새이름` | 표시 이름 바꾸기 |
| `jcal-admin set-password 이메일` | 비밀번호 초기화 (잊었을 때) |
| `jcal-admin delete-user 이메일` | 사용자와 그 데이터 삭제 |

### 3-6. 다른 서비스와 분리 (2026-10-01 VPS 점검 결과 기준)

| 항목 | VPS 에 이미 있는 것 | Jcalender 가 쓰는 것 |
|---|---|---|
| 웹 서버 | Nginx (80 · 443, 다른 사이트) | 설정 파일 `/etc/nginx/sites-available/jcalender.conf` 1개, 주소 `jcal-31-97-71-87.sslip.io` 만 담당. 설정 검사 실패 시 자동으로 되돌림 |
| 인증서 | 다른 사이트 인증서 | `jcal-31-97-71-87.sslip.io` 인증서 1개 (certbot) |
| DB | 도커 PostgreSQL(5432) · MySQL(3306 · 3307) · Redis, 호스트 PostgreSQL 16(5433) | 호스트 PostgreSQL 16(5433) 안에 DB `jcal` · 계정 `jcal` 만 따로 |
| Node | 시스템 Node 20 · pm2(hansfamily-backend) · 4000 · 5005 번 | 전용 Node 22 `/opt/jcalender/node`, systemd 서비스 `jcal-api`, 127.0.0.1:8787 |
| 도커 | haruhansu · wyd · hansfamily · jugyeongyadok | 사용 안 함 |
| 방화벽 | ufw 켜짐 (22 · 80 · 443) | 변경 없음 |
| 파일 · 계정 | - | `/opt/jcalender`, `/etc/jcalender.env`, 리눅스 사용자 `jcal`, `/var/backups/jcalender`, `/etc/cron.d/jcalender`, `/usr/local/bin/jcal-admin` · `jcal-backup` |

- 지우고 싶을 때 (Jcalender 만): `systemctl disable --now jcal-api; rm /etc/systemd/system/jcal-api.service /etc/nginx/sites-enabled/jcalender.conf /etc/nginx/sites-available/jcalender.conf /etc/cron.d/jcalender /usr/local/bin/jcal-*; systemctl reload nginx; runuser -u postgres -- dropdb -p 5433 jcal`

## 4. 결론

- 맥북에서 명령 두 줄(`update.sh`, `add-user`)로 VPS 설치가 끝나고, 앱 설정에서 로그인하면 여러 기기가 같은 데이터를 쓴다.
- 이 환경의 Ubuntu 24.04 에 기존 Nginx 사이트를 둔 상태로 설치 스크립트를 두 번 실행해, 기존 사이트는 그대로 응답하고 Jcalender 주소만 API 로 연결되는 것을 확인했다. API 점검 23개 · 두 기기 동기화 점검 12개 통과.

## 5. 향후 진행 사항

| 순서 | 할 일 | 내용 |
|---|---|---|
| 1 | 설치 실행 | 위 3-1 순서대로 (막히면 터미널 화면을 그대로 보내 주기) |
| 2 | Vercel 주소 제한 (완료) | `https://jcalender-amber.vercel.app` 만 허용. 주소가 바뀌면 `ALLOWED_ORIGINS=새주소,http://localhost:5288 bash server/deploy/update.sh` |
| 3 | 명함 이미지 파일 저장소 | 지금은 데이터 안에 함께 올라감 (최대 30MB). 많아지면 서버 파일로 분리 |
| 4 | 비밀 정보 동기화 | 필요하면 API 키를 서버 `user_secrets` 에 암호화해 저장 |

## 6. 기타

- 서버 상태: `systemctl status jcal-api` · 로그: `journalctl -u jcal-api -n 50`
- 사용자 · 동기화 현황: `jcal-admin list`
- 비밀번호 바꾸기: `jcal-admin set-password 내이메일` (모든 기기 로그아웃)
- 백업: 매일 새벽 4시 17분 `/var/backups/jcalender/` (14일 보관) · 로그 `/var/log/jcal-backup.log`
- 백업으로 되돌리기 (root):
  - `systemctl stop jcal-api && runuser -u postgres -- dropdb -p 5433 jcal && runuser -u postgres -- createdb -p 5433 -O jcal jcal`
  - `set -a; . /etc/jcalender.env; set +a; gunzip -c /var/backups/jcalender/jcal_날짜.sql.gz | psql "$DATABASE_URL" && systemctl start jcal-api`
- Hostinger hPanel › VPS › 방화벽을 따로 켜 두었다면 80 · 443 번도 허용해야 인증서가 발급된다.
- Nginx 로그: `/var/log/nginx/jcalender.access.log` · `jcalender.error.log`

## 회원 권한 (2026-10-04, 서버 1.2.0)

| 권한 | 누구 | 할 수 있는 것 |
|---|---|---|
| 관리자 | 관리자 계정 하나 (`OWNER_EMAILS`, 기본 koreamate2026@gmail.com) | 내 데이터 + 회원 관리(정지 · 기기 로그아웃 · 회원가입 방식 · 초대 코드) + 진행 현황 |
| 일반 (member) | 가입한 회원 | 내 데이터만 |
| 정지 (suspended) | 관리자가 정지한 회원 | 로그인 불가, 로그인 중인 기기도 모두 로그아웃. 데이터는 지우지 않음 |

- 다른 회원을 관리자로 만들 수 없음 (관리자 계정을 바꾸려면 `/etc/jcalender.env` 의 `OWNER_EMAILS` 를 고치고 `systemctl restart jcal-api`)
- 볼 수 있는 영역: 회원 관리 표에서 회원마다 개인 · 사업 · 근로를 체크 (하나 이상). 체크를 푼 영역은 그 회원의 메뉴 · 체크리스트 · 대시보드에서 빠지고 데이터는 그대로 (`users.areas`, 004)
- DB: `db/migrations/003_user_roles.sql` (users.role), `004_user_areas.sql` (users.areas). `bash server/deploy/update.sh` 가 자동으로 적용

## 회원 화면 키 (2026-10-04, 서버 1.4.1)

- 회원 관리 › 회원 화면: 켜면 회원에게는 관리자가 "검수 완료로 표시"한 기본 카테고리만 보인다 (메뉴 · 영역 화면 · 체크리스트 · 추천받기). 회원이 직접 만든 카테고리는 그대로 보인다
- 관리자 계정에는 적용되지 않는다. 검수 표시를 바꾸면 서버 목록이 자동으로 바뀌고, 회원 화면은 회원이 앱을 새로 열거나 5분 안에 반영된다
- 서버: `server_settings.member_screen` = `{ on, cats }`, `GET/POST /api/admin/screen`
