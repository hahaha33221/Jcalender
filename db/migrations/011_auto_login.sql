-- 2026-10-13 자동 로그인: 세션 종류 (app = 화면이 쓰는 토큰, remember = 자동 로그인 열쇠 · HttpOnly 쿠키로만 오감)
SET search_path = jcal, public;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS kind varchar(12) NOT NULL DEFAULT 'app';
