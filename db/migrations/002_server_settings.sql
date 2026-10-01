-- 2026-10-01 서버 전체 설정 (회원가입 방식 · 초대 코드). 사용자 데이터와 별개
SET search_path = jcal, public;
CREATE TABLE IF NOT EXISTS server_settings (
  key         varchar(50) PRIMARY KEY,                       -- signup_mode: code | open | closed, signup_code
  value       text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO server_settings (key, value) VALUES ('signup_mode', 'code') ON CONFLICT (key) DO NOTHING;
