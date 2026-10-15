-- 2026-10-15 안드로이드 앱 서버 푸시 (FCM): 기기 토큰 · 그 기기가 스스로 예약해 둔 알람 (server/push.mjs)
SET search_path = jcal, public;
CREATE TABLE IF NOT EXISTS fcm_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  token       text NOT NULL UNIQUE,
  device      varchar(100) NOT NULL DEFAULT '',
  scheduled   jsonb NOT NULL DEFAULT '[]',
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_ok     timestamptz,
  fails       int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS fcm_tokens_user ON fcm_tokens (user_id);
