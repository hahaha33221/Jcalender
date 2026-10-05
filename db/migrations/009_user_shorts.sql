-- 2026-10-05 회원별 숏폼 제작 권한 (관리자가 회원 관리에서 켬, 관리자 계정은 늘 가능)
SET search_path = jcal, public;
ALTER TABLE users ADD COLUMN IF NOT EXISTS shorts boolean NOT NULL DEFAULT false;
