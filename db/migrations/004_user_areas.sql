-- 2026-10-04 회원별로 볼 수 있는 영역 (관리자 계정이 회원 관리에서 체크): P 개인 · B 사업 · W 근로 를 이어 쓴 글자 (예: 'PW')
SET search_path = jcal, public;
ALTER TABLE users ADD COLUMN IF NOT EXISTS areas varchar(3) NOT NULL DEFAULT 'PBW' CHECK (areas ~ '^[PBW]{1,3}$');
