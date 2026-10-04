-- 2026-10-04 회원 권한: admin(관리자) · member(일반) · suspended(정지, 로그인 불가)
-- 서버 설정 OWNER_EMAILS(기본 koreamate2026@gmail.com)의 계정은 항상 관리자 (화면에서 바꿀 수 없음)
SET search_path = jcal, public;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role varchar(20) NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member', 'suspended'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_updated_at timestamptz;
