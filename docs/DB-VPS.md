# Jcalender VPS DB 테이블 설계서

기준: 2026-10-01 · PostgreSQL 16 · 앱 저장 구조 v2 · 파일 `db/schema.sql`, `db/import-backup.mjs`

## 1. 개요

- 목적: 지금 브라우저(localStorage)에만 있는 앱 데이터를 VPS 서버 DB로 옮겨, 여러 기기(맥북 · 휴대폰 · Vercel 주소)에서 같은 데이터를 쓰고 서버에서 백업한다.
- 구성(제안): VPS(Ubuntu 24.04, 1vCPU · 1GB 이상) + PostgreSQL 16 + API 서버(Node) + Nginx(HTTPS). 화면은 지금처럼 Vercel 에 두고 API 만 VPS 로 호출한다.
- 범위: 앱의 모든 데이터(체크리스트 · 캘린더 · 기념일 · 인맥 · 재무 · 건강 · 목표 · 기획 · 저널링 · 학습)와 사용자 · 로그인 · 기기 · 비밀 정보.
- 검증: 이 설계를 PostgreSQL 16 에 실제로 만들고, 앱 백업 파일을 넣어 테이블 47개 생성 · 데이터 변환 · 다시 넣기(같은 결과) · 휴지통 정리를 확인했다.

## 2. 안건 (테이블 묶음)

| 묶음 | 테이블 | 수 |
|---|---|---|
| 사용자 · 인증 | users, sessions, devices, user_settings, user_secrets | 5 |
| 카테고리 · 체크리스트 | categories, check_done, check_prefs, run_logs | 4 |
| 공통 | projects, tags, attachments, notifications | 4 |
| 캘린더 | events, event_skips, event_tags, event_notes | 4 |
| 인맥 · 기념일 · D-day | people_imports, people, anniversaries, ddays | 4 |
| 개인 재무 | finance_settings, expense_categories, card_imports, shopping_items, expenses, income_fixed, incomes | 7 |
| 건강 | health_settings, workouts, sleep_logs, meals, clinic_visits | 5 |
| 목표 | goal_items, milestones | 2 |
| 기획 · 조사 | research_topics, research_sources, plan_feeds, plans, plan_topics, plan_tags | 6 |
| 기타 기록 | tool_records, journal_entries, week_reviews, study_subjects, study_logs, learn_apps | 6 |
| 보기 · 함수 | trash(보기), purge_trash(), changes_since(), touch_updated_at() | - |

## 3. 안건 별 주요 내용

### 3-1. 공통 규칙

| 항목 | 규칙 | 이유 |
|---|---|---|
| 기본 키 | (user_id, id). id 는 앱이 만든 짧은 글자(`app_id`, 영문·숫자 40자 이내) | 오프라인에서 만든 항목도 서버에 그대로 올라오고, 사용자끼리 id 가 겹쳐도 안전 |
| 외래 키 | (user_id, xxx_id) 복합 참조 | 다른 사용자 데이터와 절대 섞이지 않음 |
| 사용자 삭제 | users 를 지우면 모든 데이터 ON DELETE CASCADE | 탈퇴 처리 한 번에 |
| 동기화 | created_at · updated_at(트리거 자동 갱신) · deleted_at | "마지막 동기화 이후 바뀐 행"만 주고받음 (`changes_since`) |
| 휴지통 | 주요 테이블에 deleted_at, `trash` 보기로 모아 봄, `purge_trash()` 로 30일 뒤 삭제 | 앱의 휴지통과 같은 동작 |
| 영역 | `area_code` = 'P' · 'W' · 'B' | 개인 · 근로 · 사업 |
| 값 형식 | 날짜 date, 시각 time, 금액 bigint(원), 여러 값은 배열(text[] · char(1)[]) | 계산 · 정렬 · 검색이 쉬움 |
| jsonb 사용 | 화면 설정, 외부 앱 연동 데이터, 카드 반영 상세, 도구 기록(카테고리마다 필드가 다름) | 자주 바뀌는 형식만 |
| 비밀 정보 | user_secrets 에 pgcrypto 로 암호화(`pgp_sym_encrypt`, 키는 서버 환경 변수) | 명함 AI 키 · API 토큰이 일반 조회 · 백업에 나오지 않음 |

### 3-2. 앱 데이터 → 테이블 대응

| 앱 (store) | 테이블 | 비고 |
|---|---|---|
| rules · annivDays · notify · cardAi · onedrive · boardView · meta | user_settings | 사용자 1명당 1행 |
| cardAi.apiKey · token, plan.feeds[].token | user_secrets | 암호화 |
| categories · reviewed | categories | 검수일 reviewed_on 포함 |
| done | check_done | 키 `행id@기간` → (row_id, period) |
| prio · outs | check_prefs | |
| log | run_logs | |
| projects · tags · attachments · notifications | 같은 이름 | |
| events | events + event_skips(반복 제외 회차) + event_tags | remind 'off' → -1 |
| eventNotes | event_notes | |
| people · peopleImport | people · people_imports | 명함 이미지(data URL)는 파일 저장소로 옮긴 뒤 card_url |
| anniv | anniversaries | personId → person_id |
| ddays | ddays | |
| finance.* | finance_settings · expense_categories · card_imports · shopping_items · expenses · income_fixed · incomes | |
| health.* | health_settings · workouts · sleep_logs · meals · clinic_visits | |
| goals.boards[카테고리] | goal_items(cat_key, parent_id 자기 참조) · milestones | |
| plan.* | research_topics · research_sources · plan_feeds · plans(sec → s1~s6 칸) · plan_topics · plan_tags | ext → ext_feed_id · ext_key (UNIQUE) |
| tools[카테고리] | tool_records(cat_key, data jsonb) | |
| journal · study · learn | journal_entries · week_reviews · study_subjects · study_logs · learn_apps | 일기는 사용자별 날짜 1건(UNIQUE) |
| trash | (각 테이블 deleted_at + trash 보기) | 별도 테이블 없음 |

### 3-3. 주요 테이블

| 테이블 | 핵심 칸 | 제약 · 인덱스 |
|---|---|---|
| users | id(uuid), email(UNIQUE), name, password_hash | |
| sessions | user_id, token_hash(UNIQUE), expires_at | 토큰 원문 저장 안 함 |
| devices | user_id, name, last_sync_at | 기기별 동기화 기준 시각 |
| events | date, time(NULL=종일), title, area, memo, project_id, remind_min, repeat_freq(D·W·M), repeat_until | (user_id, date) 인덱스, repeat_until ≥ date |
| people | name, grp(가족·친구·동료·지인·업무), areas[], company, dept, title, phone…, needs_check, import_id | 이름 인덱스, 휴대폰 끝 8자리 인덱스(중복 찾기) |
| anniversaries | date, kind, yearly, lunar, leap, no_year, person_id | leap 은 lunar 일 때만 |
| expenses | date, amount, cat, memo, card, project_id, import_id, shopping_id | (user_id, date), (user_id, project_id) 인덱스. 카드 반영을 지우면 그 지출도 함께 삭제 |
| goal_items | cat_key, parent_id, start_date, end_date, progress, link_row | end ≥ start, 상위를 지우면 하위도 삭제 |
| plans | title, status(아이디어~보류), due, project_id, s1_overview~s6_etc, ext_feed_id, ext_key | (user_id, ext_feed_id, ext_key) UNIQUE → API 다시 가져오기 |
| tool_records | cat_key, data(jsonb) | (user_id, cat_key) 인덱스 |

전체 칸과 제약은 `db/schema.sql` 에 주석과 함께 있다.

## 4. 결론

- 앱 저장 구조 v2 를 빠짐없이 47개 테이블로 옮길 수 있고, 앱의 짧은 id 를 그대로 기본 키로 써서 앱 ↔ 서버 동기화가 단순하다.
- 모든 테이블이 user_id 로 나뉘어 여러 사용자를 받을 수 있고, 비밀 정보는 암호화 테이블로 분리된다.
- 지금 앱의 백업 파일을 `db/import-backup.mjs` 로 바로 서버 DB 에 넣을 수 있다 (몇 번 실행해도 같은 결과).

## 5. 향후 진행 사항

| 순서 | 할 일 | 내용 |
|---|---|---|
| 1 | VPS 준비 | Ubuntu 서버 · PostgreSQL 16 설치, `db/schema.sql` 적용, 매일 `pg_dump` 백업 · `purge_trash()` cron |
| 2 | API 서버 | 로그인(이메일 · 비밀번호, 세션 토큰), `GET /sync?since=` · `POST /sync`(바뀐 행 주고받기), Nginx + HTTPS |
| 3 | 앱 동기화 | 설정에 "서버 연결" 추가, 변경 시 서버로 보내고 앱을 열 때 받아오기 (지금처럼 오프라인에서도 동작) |
| 4 | 데이터 옮기기 | 맥북 앱 백업 → `node db/import-backup.mjs 백업.json 이메일 > import.sql` → `psql -f import.sql` |
| 5 | 파일 저장소 | 명함 이미지를 서버 파일(또는 오브젝트 저장소)로 옮기고 people.card_url 로 연결 |

## 6. 기타

- 적용 명령
  - `createdb jcal`
  - `psql -d jcal -v ON_ERROR_STOP=1 -f db/schema.sql`
  - `node db/import-backup.mjs jcalender_backup_YYYYMMDD.json 내이메일 > import.sql`
  - `psql -d jcal -v ON_ERROR_STOP=1 -f import.sql`
- 동기화 확인: `SELECT * FROM jcal.changes_since('<사용자 uuid>', now() - interval '1 day');`
- 휴지통 정리: `SELECT jcal.purge_trash();` (기본 30일)
- 체크 항목 정의(어떤 체크가 있는지)는 앱 코드 `src/data.js` 에 있어 DB 에는 체크 기록만 저장한다.
