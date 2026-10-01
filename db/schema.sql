-- ============================================================================
-- Jcalender 서버 DB (VPS · PostgreSQL 16) 테이블 설계
-- 기준: 앱 저장 구조 v2 (src/schema.js, docs/ERD.md)
--
-- 설계 원칙
--   1) 여러 사용자: 모든 데이터 테이블에 user_id. 기본 키는 (user_id, id)
--      → 앱이 만든 짧은 id(예: 'k3x9a1b2')를 그대로 써서 오프라인에서 만든 항목도 충돌 없이 올라온다
--   2) 동기화: created_at · updated_at(행이 바뀔 때마다 트리거로 갱신) · deleted_at(휴지통, 30일 뒤 영구 삭제)
--      기기는 "updated_at > 마지막 동기화 시각" 인 행만 주고받는다
--   3) 비밀 정보(API 키 · 토큰)는 user_secrets 에 암호화해서 따로 둔다 (일반 조회 · 백업에서 제외)
--   4) 날짜는 date, 시각은 time, 금액은 bigint(원), 영역은 'P' 개인 · 'W' 근로 · 'B' 사업
--   5) 형식이 자주 바뀌는 묶음(외부 앱 연동 데이터, 화면 설정 등)만 jsonb
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;          -- gen_random_uuid(), 비밀 정보 암호화
CREATE SCHEMA IF NOT EXISTS jcal;
SET search_path = jcal, public;

-- 공통 도메인 ------------------------------------------------------------------
CREATE DOMAIN area_code AS char(1) CHECK (VALUE IN ('P', 'W', 'B'));
CREATE DOMAIN app_id    AS varchar(40) CHECK (VALUE ~ '^[A-Za-z0-9_@:.-]+$');

-- updated_at 자동 갱신
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

-- ============================================================================
-- 1. 사용자 · 인증 · 기기 · 설정
-- ============================================================================
CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          varchar(255) NOT NULL UNIQUE,
  name           varchar(100) NOT NULL DEFAULT '',
  password_hash  text NOT NULL,                              -- argon2id / bcrypt
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);

CREATE TABLE sessions (                                       -- 로그인 세션 (토큰은 해시만 저장)
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  token_hash  bytea NOT NULL UNIQUE,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE devices (                                        -- 기기별 마지막 동기화 시각
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  name          varchar(100) NOT NULL,                       -- 예: 맥북 크롬, 아이폰 사파리
  last_sync_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_settings (                                  -- 사용자 1명당 1행
  user_id           uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  schema_version    int  NOT NULL DEFAULT 2,
  check_rules       jsonb NOT NULL DEFAULT '{"weekDay":0,"monthDay":"last","yearMonth":12,"yearDay":30}',
  anniv_days        int  NOT NULL DEFAULT 10,
  notify_enabled    boolean NOT NULL DEFAULT false,
  notify_event_min  int  NOT NULL DEFAULT 10,
  notify_plan_days  int  NOT NULL DEFAULT 1,
  card_ai           jsonb NOT NULL DEFAULT '{}',              -- mode · endpoint · model (키는 user_secrets)
  onedrive          jsonb NOT NULL DEFAULT '{}',              -- clientId · tenant · pins · last
  board_view        jsonb NOT NULL DEFAULT '{}',              -- 단계 보드 칸반/게시판
  ui                jsonb NOT NULL DEFAULT '{}',              -- 재무 · 기획 화면 상태
  last_backup_at    timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_secrets (                                   -- API 키 · 토큰 (pgp_sym_encrypt 로 암호화)
  user_id     uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  key         varchar(100) NOT NULL,                         -- 예: card_ai.apiKey, feed:<feed id>
  value_enc   bytea NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE store_snapshots (                                -- 앱 동기화: 사용자 데이터 전체(비밀 정보 제외) 최신본
  user_id     uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  version     bigint NOT NULL DEFAULT 0,                     -- 올릴 때마다 +1 (기기가 가진 버전과 다르면 충돌)
  data        jsonb NOT NULL,
  device      varchar(100) NOT NULL DEFAULT '',              -- 마지막으로 올린 기기
  size_bytes  int NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. 카테고리 · 체크리스트
--    체크 항목 정의(CHECK_ROW)는 앱 코드(data.js)에 있어 테이블로 두지 않고 row_id 문자열로 참조
-- ============================================================================
CREATE TABLE categories (
  user_id     uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  key         varchar(80) NOT NULL,                          -- '영역|카테고리'
  area        area_code NOT NULL,
  name        varchar(60) NOT NULL,
  sort_order  int NOT NULL DEFAULT 0,
  hidden      boolean NOT NULL DEFAULT false,
  has_goal    boolean NOT NULL DEFAULT true,
  reviewed_on date,                                          -- 검수 완료 표시
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE check_done (                                     -- 체크 완료 (행 id × 기간)
  user_id  uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  row_id   varchar(20) NOT NULL,                             -- 예: WD3
  period   varchar(12) NOT NULL,                             -- 2026-09-30 · 2026-W40 · 2026-09 · 2026
  done_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, row_id, period)
);

CREATE TABLE check_prefs (                                    -- 우선순위 · 실행 결과
  user_id     uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  row_id      varchar(20) NOT NULL,
  prio        smallint CHECK (prio BETWEEN 1 AND 3),
  output      jsonb,
  memo        text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, row_id)
);

CREATE TABLE run_logs (                                       -- 실행 로그
  id       bigserial PRIMARY KEY,
  user_id  uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  at       timestamptz NOT NULL DEFAULT now(),
  area     area_code NOT NULL,
  item     varchar(80),
  action   varchar(120),
  ty       varchar(10)
);
CREATE INDEX run_logs_user_at_idx ON run_logs (user_id, at DESC);

-- ============================================================================
-- 3. 공통: 프로젝트 · 태그 · 첨부 · 알림
-- ============================================================================
CREATE TABLE projects (
  user_id     uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  id          app_id NOT NULL,
  name        varchar(120) NOT NULL,
  note        text NOT NULL DEFAULT '',
  status      varchar(4) NOT NULL DEFAULT '진행' CHECK (status IN ('진행', '보류', '완료')),
  start_date  date,
  end_date    date,
  areas       char(1)[] NOT NULL DEFAULT '{P}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  PRIMARY KEY (user_id, id),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE TABLE tags (
  user_id     uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  id          app_id NOT NULL,
  name        varchar(40) NOT NULL,
  color       varchar(9) NOT NULL DEFAULT '#4a5563',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, name)
);

CREATE TABLE attachments (                                    -- 일정 · 기획에 붙는 링크 / OneDrive 경로
  user_id     uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  id          app_id NOT NULL,
  owner_type  varchar(10) NOT NULL CHECK (owner_type IN ('event', 'plan')),
  owner_id    app_id NOT NULL,
  kind        varchar(10) NOT NULL CHECK (kind IN ('link', 'onedrive')),
  title       varchar(200) NOT NULL,
  url         text NOT NULL,
  added_on    date NOT NULL DEFAULT current_date,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX attachments_owner_idx ON attachments (user_id, owner_type, owner_id);

CREATE TABLE notifications (                                  -- 보낸 알림 기록
  user_id  uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  key      varchar(120) NOT NULL,                            -- event:<id>@<날짜> · plan:<id>:<마감>
  title    varchar(200) NOT NULL,
  body     text,
  at       timestamptz NOT NULL,
  sent_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- ============================================================================
-- 4. 캘린더
-- ============================================================================
CREATE TABLE events (
  user_id       uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  id            app_id NOT NULL,
  date          date NOT NULL,                               -- 반복이면 첫 날
  time          time,                                         -- NULL = 종일
  title         varchar(200) NOT NULL,
  area          area_code NOT NULL DEFAULT 'P',
  memo          text NOT NULL DEFAULT '',
  project_id    app_id,
  remind_min    int,                                          -- NULL = 설정값, -1 = 알림 없음
  repeat_freq   char(1) CHECK (repeat_freq IN ('D', 'W', 'M')),
  repeat_until  date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, project_id) REFERENCES projects (user_id, id) ON DELETE SET NULL (project_id),
  CHECK (repeat_until IS NULL OR repeat_until >= date)
);
CREATE INDEX events_user_date_idx ON events (user_id, date) WHERE deleted_at IS NULL;

CREATE TABLE event_skips (                                    -- 반복 일정에서 뺀 회차
  user_id   uuid NOT NULL,
  event_id  app_id NOT NULL,
  occ_date  date NOT NULL,
  PRIMARY KEY (user_id, event_id, occ_date),
  FOREIGN KEY (user_id, event_id) REFERENCES events (user_id, id) ON DELETE CASCADE
);

CREATE TABLE event_tags (
  user_id   uuid NOT NULL,
  event_id  app_id NOT NULL,
  tag_id    app_id NOT NULL,
  PRIMARY KEY (user_id, event_id, tag_id),
  FOREIGN KEY (user_id, event_id) REFERENCES events (user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, tag_id)   REFERENCES tags (user_id, id)   ON DELETE CASCADE
);

CREATE TABLE event_notes (                                    -- 날짜 없는 일정 노트
  user_id     uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  id          app_id NOT NULL,
  title       varchar(200) NOT NULL,
  area        area_code NOT NULL DEFAULT 'P',
  time        time,
  memo        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  PRIMARY KEY (user_id, id)
);

-- ============================================================================
-- 5. 인맥 · 기념일 · D-day
-- ============================================================================
CREATE TABLE people_imports (                                 -- 엑셀 가져오기 기록
  user_id  uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  id       app_id NOT NULL,
  at       timestamptz NOT NULL DEFAULT now(),
  file     varchar(255),
  detail   jsonb NOT NULL DEFAULT '{}',                       -- added · patched (되돌리기용)
  PRIMARY KEY (user_id, id)
);

CREATE TABLE people (
  user_id      uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  id           app_id NOT NULL,
  name         varchar(100) NOT NULL,
  grp          varchar(10) NOT NULL DEFAULT '지인' CHECK (grp IN ('가족', '친구', '동료', '지인', '업무')),
  areas        char(1)[] NOT NULL DEFAULT '{P}',
  company      varchar(150) NOT NULL DEFAULT '',
  dept         varchar(200) NOT NULL DEFAULT '',
  title        varchar(150) NOT NULL DEFAULT '',
  phone        varchar(40)  NOT NULL DEFAULT '',
  phone2       varchar(80)  NOT NULL DEFAULT '',
  tel          varchar(80)  NOT NULL DEFAULT '',
  fax          varchar(80)  NOT NULL DEFAULT '',
  email        varchar(255) NOT NULL DEFAULT '',
  email2       varchar(255) NOT NULL DEFAULT '',
  address      text NOT NULL DEFAULT '',
  birthday     date,
  anniv_name   varchar(60) NOT NULL DEFAULT '',
  anniv_date   date,
  card_url     text,                                          -- 명함 이미지 (파일 저장소 경로, 앱의 data URL 은 업로드 후 교체)
  note         text NOT NULL DEFAULT '',
  needs_check  boolean NOT NULL DEFAULT false,               -- 번호 확인 필요
  src          varchar(200) NOT NULL DEFAULT '',
  import_id    app_id,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, import_id) REFERENCES people_imports (user_id, id) ON DELETE SET NULL (import_id)
);
CREATE INDEX people_user_name_idx ON people (user_id, name) WHERE deleted_at IS NULL;
CREATE INDEX people_user_phone_idx ON people (user_id, right(regexp_replace(phone, '\D', '', 'g'), 8));

CREATE TABLE anniversaries (
  user_id      uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  id           app_id NOT NULL,
  name         varchar(120) NOT NULL,
  person_text  varchar(100) NOT NULL DEFAULT '',
  person_id    app_id,
  date         date NOT NULL,                                 -- 음력이면 음력 월·일, 연도 모름이면 2000년
  kind         varchar(4) NOT NULL DEFAULT '생일' CHECK (kind IN ('생일', '기념일')),
  yearly       boolean NOT NULL DEFAULT true,
  lunar        boolean NOT NULL DEFAULT false,
  leap         boolean NOT NULL DEFAULT false,
  no_year      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, person_id) REFERENCES people (user_id, id) ON DELETE SET NULL (person_id),
  CHECK (NOT leap OR lunar)
);

CREATE TABLE ddays (
  user_id     uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  id          app_id NOT NULL,
  name        varchar(120) NOT NULL,
  date        date NOT NULL,
  mode        varchar(5) NOT NULL CHECK (mode IN ('until', 'since')),
  start_one   boolean NOT NULL DEFAULT true,
  pin         boolean NOT NULL DEFAULT true,
  memo        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  PRIMARY KEY (user_id, id)
);

-- ============================================================================
-- 6. 개인 재무
-- ============================================================================
CREATE TABLE finance_settings (
  user_id           uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  monthly_budget    bigint NOT NULL DEFAULT 0,
  card_installment  varchar(4) NOT NULL DEFAULT 'bill' CHECK (card_installment IN ('bill', 'use')),
  report_next       text NOT NULL DEFAULT '',                -- 보고서 비고 · 향후 계획
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE expense_categories (
  user_id     uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  name        varchar(30) NOT NULL,
  budget      bigint NOT NULL DEFAULT 0,
  keywords    text[] NOT NULL DEFAULT '{}',
  sort_order  int NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, name)
);

CREATE TABLE card_imports (
  user_id   uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  id        app_id NOT NULL,
  at        timestamptz NOT NULL DEFAULT now(),
  files     jsonb NOT NULL DEFAULT '[]',
  added     int NOT NULL DEFAULT 0,
  total     bigint NOT NULL DEFAULT 0,
  months    jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (user_id, id)
);

CREATE TABLE shopping_items (
  user_id    uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  id         app_id NOT NULL,
  name       varchar(120) NOT NULL,
  qty        int NOT NULL DEFAULT 1 CHECK (qty > 0),
  price      bigint NOT NULL DEFAULT 0,
  cat        varchar(30) NOT NULL DEFAULT '생활용품',
  added_on   date NOT NULL DEFAULT current_date,
  bought_on  date,
  paid       bigint,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE expenses (
  user_id      uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  id           app_id NOT NULL,
  date         date NOT NULL,
  amount       bigint NOT NULL,
  cat          varchar(30) NOT NULL DEFAULT '기타',
  memo         varchar(300) NOT NULL DEFAULT '',
  card         varchar(60),
  project_id   app_id,
  import_id    app_id,
  shopping_id  app_id,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, project_id)  REFERENCES projects (user_id, id)       ON DELETE SET NULL (project_id),
  FOREIGN KEY (user_id, import_id)   REFERENCES card_imports (user_id, id)   ON DELETE CASCADE,
  FOREIGN KEY (user_id, shopping_id) REFERENCES shopping_items (user_id, id) ON DELETE SET NULL (shopping_id)
);
CREATE INDEX expenses_user_date_idx ON expenses (user_id, date);
CREATE INDEX expenses_user_project_idx ON expenses (user_id, project_id) WHERE project_id IS NOT NULL;

CREATE TABLE income_fixed (                                   -- 정기 수입
  user_id  uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  id       app_id NOT NULL,
  cat      varchar(20) NOT NULL,
  source   varchar(100) NOT NULL DEFAULT '',
  amount   bigint NOT NULL,
  day      smallint NOT NULL CHECK (day BETWEEN 1 AND 31),
  PRIMARY KEY (user_id, id)
);

CREATE TABLE incomes (
  user_id   uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  id        app_id NOT NULL,
  date      date NOT NULL,
  amount    bigint NOT NULL,
  cat       varchar(20) NOT NULL DEFAULT '기타',
  source    varchar(100) NOT NULL DEFAULT '',
  memo      varchar(300) NOT NULL DEFAULT '',
  fixed_id  app_id,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, fixed_id) REFERENCES income_fixed (user_id, id) ON DELETE SET NULL (fixed_id)
);
CREATE INDEX incomes_user_date_idx ON incomes (user_id, date);

-- ============================================================================
-- 7. 건강
-- ============================================================================
CREATE TABLE health_settings (
  user_id     uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  goal_sleep  int NOT NULL DEFAULT 420,                      -- 분
  goal_kcal   int NOT NULL DEFAULT 2000,
  imported    jsonb                                           -- 삼성 헬스 가져오기 기록
);
CREATE TABLE workouts (
  user_id  uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  id       app_id NOT NULL,
  date     date NOT NULL,
  type     varchar(20) NOT NULL,
  minutes  int NOT NULL CHECK (minutes >= 0),
  kcal     int,
  PRIMARY KEY (user_id, id)
);
CREATE TABLE sleep_logs (
  user_id  uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  id       app_id NOT NULL,
  date     date NOT NULL,                                     -- 기상한 날
  bed      time NOT NULL,
  wake     time NOT NULL,
  PRIMARY KEY (user_id, id)
);
CREATE TABLE meals (
  user_id  uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  id       app_id NOT NULL,
  date     date NOT NULL,
  meal     varchar(10) NOT NULL,
  name     varchar(120) NOT NULL,
  kcal     int,
  src      varchar(40),
  PRIMARY KEY (user_id, id)
);
CREATE TABLE clinic_visits (
  user_id   uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  id        app_id NOT NULL,
  date      date NOT NULL,
  hospital  varchar(120) NOT NULL,
  dept      varchar(40),
  note      text,
  rx        text,
  next_on   date,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX workouts_user_date_idx ON workouts (user_id, date);
CREATE INDEX sleep_user_date_idx ON sleep_logs (user_id, date);
CREATE INDEX meals_user_date_idx ON meals (user_id, date);

-- ============================================================================
-- 8. 목표 (WBS · 마일스톤)
-- ============================================================================
CREATE TABLE goal_items (
  user_id     uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  id          app_id NOT NULL,
  cat_key     varchar(80) NOT NULL,                          -- 어느 카테고리의 목표 보드인지
  parent_id   app_id,                                         -- NULL = 최상위 목표
  name        varchar(200) NOT NULL,
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  progress    smallint CHECK (progress BETWEEN 0 AND 100),
  link_row    varchar(20),                                    -- 진행률 기준 체크 항목
  sort_order  int NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, parent_id) REFERENCES goal_items (user_id, id) ON DELETE CASCADE,
  CHECK (end_date >= start_date)
);
CREATE INDEX goal_items_board_idx ON goal_items (user_id, cat_key);

CREATE TABLE milestones (
  user_id  uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  id       app_id NOT NULL,
  cat_key  varchar(80) NOT NULL,
  item_id  app_id,
  name     varchar(200) NOT NULL,
  date     date NOT NULL,
  done     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, item_id) REFERENCES goal_items (user_id, id) ON DELETE SET NULL (item_id)
);

-- ============================================================================
-- 9. 기획 · 조사
-- ============================================================================
CREATE TABLE research_topics (
  user_id     uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  id          app_id NOT NULL,
  title       varchar(200) NOT NULL,
  purpose     text NOT NULL DEFAULT '',
  due         date,
  status      varchar(6) NOT NULL DEFAULT '조사 중' CHECK (status IN ('조사 중', '정리 완료')),
  summary     text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE research_sources (
  user_id   uuid NOT NULL,
  id        app_id NOT NULL,
  topic_id  app_id NOT NULL,
  title     varchar(300) NOT NULL,
  url       text NOT NULL DEFAULT '',
  source    varchar(150) NOT NULL DEFAULT '',                 -- 출처
  date      date,
  memo      text NOT NULL DEFAULT '',
  tags      text[] NOT NULL DEFAULT '{}',
  star      smallint NOT NULL DEFAULT 2 CHECK (star BETWEEN 1 AND 3),
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, topic_id) REFERENCES research_topics (user_id, id) ON DELETE CASCADE
);

CREATE TABLE plan_feeds (                                     -- API 가져오기 연결 (토큰은 user_secrets)
  user_id     uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  id          app_id NOT NULL,
  name        varchar(100) NOT NULL,
  url         text NOT NULL,
  header      varchar(60) NOT NULL DEFAULT 'Authorization',
  field_map   jsonb NOT NULL DEFAULT '{}',
  last_sync   date,
  item_count  int NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE plans (
  user_id     uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  id          app_id NOT NULL,
  title       varchar(200) NOT NULL,
  status      varchar(4) NOT NULL DEFAULT '아이디어' CHECK (status IN ('아이디어', '초안', '검토', '확정', '보류')),
  due         date,
  project_id  app_id,
  s1_overview text NOT NULL DEFAULT '',                      -- 1. 개요
  s2_agenda   text NOT NULL DEFAULT '',                      -- 2. 안건
  s3_detail   text NOT NULL DEFAULT '',                      -- 3. 안건 별 주요 내용
  s4_result   text NOT NULL DEFAULT '',                      -- 4. 결론
  s5_next     text NOT NULL DEFAULT '',                      -- 5. 향후 진행 사항
  s6_etc      text NOT NULL DEFAULT '',                      -- 6. 기타
  ext_feed_id app_id,
  ext_key     varchar(200),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  PRIMARY KEY (user_id, id),
  FOREIGN KEY (user_id, project_id)  REFERENCES projects (user_id, id)   ON DELETE SET NULL (project_id),
  FOREIGN KEY (user_id, ext_feed_id) REFERENCES plan_feeds (user_id, id) ON DELETE SET NULL (ext_feed_id),
  UNIQUE (user_id, ext_feed_id, ext_key)
);
CREATE INDEX plans_user_due_idx ON plans (user_id, due) WHERE deleted_at IS NULL;

CREATE TABLE plan_topics (
  user_id   uuid NOT NULL,
  plan_id   app_id NOT NULL,
  topic_id  app_id NOT NULL,
  PRIMARY KEY (user_id, plan_id, topic_id),
  FOREIGN KEY (user_id, plan_id)  REFERENCES plans (user_id, id)           ON DELETE CASCADE,
  FOREIGN KEY (user_id, topic_id) REFERENCES research_topics (user_id, id) ON DELETE CASCADE
);

CREATE TABLE plan_tags (
  user_id  uuid NOT NULL,
  plan_id  app_id NOT NULL,
  tag_id   app_id NOT NULL,
  PRIMARY KEY (user_id, plan_id, tag_id),
  FOREIGN KEY (user_id, plan_id) REFERENCES plans (user_id, id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, tag_id)  REFERENCES tags (user_id, id)  ON DELETE CASCADE
);

-- ============================================================================
-- 10. 카테고리 도구 기록 · 저널링 · 학습 · 앱 연동
-- ============================================================================
CREATE TABLE tool_records (                                   -- toolConfigs.js 설정형 표 (업무 할일/프로젝트, 고객 관리 등)
  user_id     uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  id          app_id NOT NULL,
  cat_key     varchar(80) NOT NULL,
  data        jsonb NOT NULL,                                 -- 카테고리마다 필드가 달라 jsonb
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);
CREATE INDEX tool_records_cat_idx ON tool_records (user_id, cat_key);

CREATE TABLE journal_entries (
  user_id  uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  id       app_id NOT NULL,
  date     date NOT NULL,
  mood     smallint NOT NULL CHECK (mood BETWEEN 1 AND 5),
  text     text NOT NULL DEFAULT '',
  tags     text[] NOT NULL DEFAULT '{}',
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, date)
);

CREATE TABLE week_reviews (
  user_id   uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  id        app_id NOT NULL,
  week      char(8) NOT NULL,                                -- 2026-W40
  keep      text NOT NULL DEFAULT '',
  problem   text NOT NULL DEFAULT '',
  try_next  text NOT NULL DEFAULT '',
  saved_on  date,
  PRIMARY KEY (user_id, id),
  UNIQUE (user_id, week)
);

CREATE TABLE study_subjects (
  user_id     uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  id          app_id NOT NULL,
  cat_key     varchar(80) NOT NULL,
  name        varchar(60) NOT NULL,
  target_min  int NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, id)
);
CREATE TABLE study_logs (
  user_id  uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  id       app_id NOT NULL,
  cat_key  varchar(80) NOT NULL,
  date     date NOT NULL,
  subject  varchar(60) NOT NULL,
  minutes  int NOT NULL CHECK (minutes >= 0),
  memo     text NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, id)
);

CREATE TABLE learn_apps (                                     -- 직접 만든 학습 · 여가 앱 연동 (영어 · IT · 자격증 · 여행 · 독서 · 기타 · 밴드)
  user_id    uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  key        varchar(20) NOT NULL,
  app_name   varchar(60),
  open_url   text,
  data_url   text,
  data       jsonb,
  synced_at  timestamptz,
  PRIMARY KEY (user_id, key)
);

-- ============================================================================
-- 11. updated_at 트리거 · 휴지통 보기 · 정리 함수
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT table_name FROM information_schema.columns
           WHERE table_schema = 'jcal' AND column_name = 'updated_at' LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON jcal.%I FOR EACH ROW EXECUTE FUNCTION jcal.touch_updated_at()', t || '_touch', t);
  END LOOP;
END $$;

-- 휴지통: deleted_at 이 있는 행을 한 목록으로
CREATE VIEW trash AS
  SELECT user_id, 'event'::text AS type, id, title AS label, deleted_at FROM events          WHERE deleted_at IS NOT NULL
  UNION ALL SELECT user_id, 'eventNote', id, title, deleted_at FROM event_notes              WHERE deleted_at IS NOT NULL
  UNION ALL SELECT user_id, 'person',    id, name,  deleted_at FROM people                   WHERE deleted_at IS NOT NULL
  UNION ALL SELECT user_id, 'anniv',     id, name,  deleted_at FROM anniversaries            WHERE deleted_at IS NOT NULL
  UNION ALL SELECT user_id, 'dday',      id, name,  deleted_at FROM ddays                    WHERE deleted_at IS NOT NULL
  UNION ALL SELECT user_id, 'plan',      id, title, deleted_at FROM plans                    WHERE deleted_at IS NOT NULL
  UNION ALL SELECT user_id, 'topic',     id, title, deleted_at FROM research_topics          WHERE deleted_at IS NOT NULL
  UNION ALL SELECT user_id, 'project',   id, name,  deleted_at FROM projects                 WHERE deleted_at IS NOT NULL;

-- 30일 지난 휴지통 항목 영구 삭제 (cron 으로 하루 1번: SELECT jcal.purge_trash();)
CREATE OR REPLACE FUNCTION purge_trash(days int DEFAULT 30) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int := 0; c int; t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['events','event_notes','people','anniversaries','ddays','plans','research_topics','projects'] LOOP
    EXECUTE format('DELETE FROM jcal.%I WHERE deleted_at < now() - make_interval(days => $1)', t) USING days;
    GET DIAGNOSTICS c = ROW_COUNT; n := n + c;
  END LOOP;
  DELETE FROM jcal.notifications WHERE sent_at < now() - interval '90 days';
  RETURN n;
END $$;

-- 동기화: 한 사용자의 바뀐 행 수를 테이블별로 (since 이후)
CREATE OR REPLACE FUNCTION changes_since(uid uuid, since timestamptz)
RETURNS TABLE (table_name text, changed bigint) LANGUAGE plpgsql AS $$
DECLARE t text;
BEGIN
  FOR t IN SELECT c.table_name FROM information_schema.columns c
           WHERE c.table_schema = 'jcal' AND c.column_name = 'updated_at'
             AND EXISTS (SELECT 1 FROM information_schema.columns u WHERE u.table_schema = 'jcal' AND u.table_name = c.table_name AND u.column_name = 'user_id')
           ORDER BY 1 LOOP
    RETURN QUERY EXECUTE format('SELECT %L::text, count(*) FROM jcal.%I WHERE user_id = $1 AND updated_at > $2', t, t) USING uid, since;
  END LOOP;
END $$;
