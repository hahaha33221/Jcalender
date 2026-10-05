-- 2026-10-05 숏폼 제작 4차: 유튜브 쇼츠 · 인스타그램 릴스 연결 · 업로드(예약) · 성과 (server/shortsSocial.mjs)
SET search_path = jcal, public;
CREATE TABLE IF NOT EXISTS shorts_channels (                   -- 연결한 계정 (토큰은 암호화해서 저장)
  user_id        uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  platform       varchar(20) NOT NULL CHECK (platform IN ('youtube', 'instagram')),
  account_id     text NOT NULL DEFAULT '',
  account_name   text NOT NULL DEFAULT '',
  account_url    text NOT NULL DEFAULT '',
  access_token   text NOT NULL DEFAULT '',
  refresh_token  text NOT NULL DEFAULT '',
  expires_at     timestamptz,
  error          text NOT NULL DEFAULT '',                     -- 다시 연결이 필요할 때 이유
  connected_at   timestamptz NOT NULL DEFAULT now(),
  refreshed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, platform)
);
CREATE TABLE IF NOT EXISTS shorts_posts (                      -- 업로드 (플랫폼마다 1줄)
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  render_id     uuid REFERENCES shorts_renders ON DELETE SET NULL,
  script_id     uuid REFERENCES shorts_scripts ON DELETE SET NULL,
  platform      varchar(20) NOT NULL CHECK (platform IN ('youtube', 'instagram')),
  title         text NOT NULL DEFAULT '',
  caption       text NOT NULL DEFAULT '',                     -- 유튜브 설명 · 인스타 캡션
  privacy       varchar(10) NOT NULL DEFAULT 'public',        -- 유튜브: public | unlisted | private
  scheduled_at  timestamptz NOT NULL DEFAULT now(),           -- 이 시각에 서버가 올림
  status        varchar(10) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'uploading', 'done', 'failed')),
  stage         text NOT NULL DEFAULT '',
  external_id   text NOT NULL DEFAULT '',                     -- 유튜브 영상 id · 인스타 미디어 id
  url           text NOT NULL DEFAULT '',
  error         text NOT NULL DEFAULT '',
  stats         jsonb NOT NULL DEFAULT '{}',                  -- { views, likes, comments, shares, saves, reach }
  stats_at      timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  posted_at     timestamptz
);
CREATE INDEX IF NOT EXISTS shorts_posts_user_idx ON shorts_posts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS shorts_posts_due_idx ON shorts_posts (scheduled_at) WHERE status IN ('scheduled', 'uploading');
