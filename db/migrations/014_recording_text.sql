-- 2026-11-25 녹음 · 회의록: 예전 TXT(받아 적은 글 · 메모) 올리기 — 녹음 없이 글로 회의록을 만든다
-- 글만 있는 항목은 rec_id 를 음수(recording_text_seq)로 둔다 (녹음 서버 번호와 겹치지 않게)
SET search_path = jcal, public;
ALTER TABLE recording_minutes ADD COLUMN IF NOT EXISTS has_text boolean NOT NULL DEFAULT false;      -- 올린 글을 받아쓴 글로 씀 (받아쓰기 건너뜀)
ALTER TABLE recording_minutes ADD COLUMN IF NOT EXISTS text_sha256 varchar(64) NOT NULL DEFAULT '';  -- 같은 TXT 다시 올림 방지
CREATE SEQUENCE IF NOT EXISTS recording_text_seq;
CREATE INDEX IF NOT EXISTS recording_minutes_text_sha ON recording_minutes (text_sha256) WHERE text_sha256 <> '';
