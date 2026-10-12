-- 2026-10-12 웹 푸시: 기기 구독 · 보낸 알림 기록 (server/push.mjs)
SET search_path = jcal, public;
CREATE TABLE IF NOT EXISTS push_subs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  endpoint    text NOT NULL UNIQUE,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  device      varchar(100) NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_ok     timestamptz,
  fails       int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS push_subs_user ON push_subs (user_id);
CREATE TABLE IF NOT EXISTS push_sent (
  user_id  uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  key      varchar(200) NOT NULL,
  sent_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
