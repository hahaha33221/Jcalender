-- 2026-10-04 숏폼 제작 1차: 게시판(RSS) 수집 → 글 고르기 → AI 제목 · 스크립트 (server/shorts.mjs)
SET search_path = jcal, public;
CREATE TABLE IF NOT EXISTS shorts_sources (                    -- 수집할 게시판 (RSS · Atom 주소)
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  name             varchar(100) NOT NULL DEFAULT '',
  url              text NOT NULL,                              -- 사용자가 넣은 주소 (게시판 페이지여도 됨)
  feed_url         text NOT NULL,                              -- 실제로 읽는 RSS 주소 (페이지에서 찾아 둠)
  full_text        boolean NOT NULL DEFAULT false,             -- 글 페이지에 들어가 본문까지 가져오기
  body_pattern     text NOT NULL DEFAULT '',                   -- 본문을 꺼낼 정규식 (첫 번째 괄호), 비우면 자동
  active           boolean NOT NULL DEFAULT true,
  last_fetched_at  timestamptz,
  last_count       int NOT NULL DEFAULT 0,
  last_error       text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, feed_url)
);
CREATE TABLE IF NOT EXISTS shorts_items (                      -- 수집한 글
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  source_id     uuid REFERENCES shorts_sources ON DELETE SET NULL,
  link          text NOT NULL,
  title         text NOT NULL DEFAULT '',
  body          text NOT NULL DEFAULT '',
  published_at  timestamptz,
  status        varchar(10) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'picked', 'skipped')),
  fetched_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, link)
);
CREATE INDEX IF NOT EXISTS shorts_items_user_idx ON shorts_items (user_id, fetched_at DESC);
CREATE TABLE IF NOT EXISTS shorts_scripts (                    -- AI 가 만든 제목 · 스크립트 후보 (chosen = 고른 것)
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  item_id     uuid NOT NULL REFERENCES shorts_items ON DELETE CASCADE,
  title       text NOT NULL,
  script      text NOT NULL,
  hashtags    text NOT NULL DEFAULT '',
  chosen      boolean NOT NULL DEFAULT false,
  model       varchar(60) NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shorts_scripts_item_idx ON shorts_scripts (item_id);
CREATE TABLE IF NOT EXISTS shorts_settings (                   -- 사용자별 설정 (글자 수 · 후보 수 · 말투 · 수집 주기)
  user_id     uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  data        jsonb NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now()
);
