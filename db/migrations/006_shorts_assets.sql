-- 2026-10-04 숏폼 제작 2차: 소재함(배경 영상 · 이미지 · 음악) · 제작 준비(스크립트별 배경 · 음악) (server/shortsAssets.mjs)
-- 파일은 DB 가 아니라 VPS 디스크 /var/lib/jcalender/shorts/<user_id>/ 에 저장
SET search_path = jcal, public;
CREATE TABLE IF NOT EXISTS shorts_assets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  kind         varchar(10) NOT NULL CHECK (kind IN ('video', 'image', 'music')),
  name         varchar(200) NOT NULL DEFAULT '',
  ext          varchar(10) NOT NULL,
  mime         varchar(100) NOT NULL DEFAULT '',
  size_bytes   bigint NOT NULL DEFAULT 0,
  width        int,
  height       int,
  duration     numeric(10, 2),                               -- 초 (영상 · 음악)
  tags         text NOT NULL DEFAULT '',                     -- 띄어쓰기로 구분 (분위기 · 주제)
  source       varchar(20) NOT NULL DEFAULT 'upload',        -- upload | pexels
  source_url   text NOT NULL DEFAULT '',
  credit       text NOT NULL DEFAULT '',                     -- 촬영자 (무료 소재 출처 표시용)
  has_thumb    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shorts_assets_user_idx ON shorts_assets (user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS shorts_projects (                   -- 고른 스크립트 1개 = 영상 1개의 재료
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  script_id    uuid NOT NULL UNIQUE REFERENCES shorts_scripts ON DELETE CASCADE,
  backgrounds  uuid[] NOT NULL DEFAULT '{}',                 -- 나오는 순서대로
  music_id     uuid REFERENCES shorts_assets ON DELETE SET NULL,
  keywords     text NOT NULL DEFAULT '',                     -- 소재 검색어 (AI 추천)
  mood         varchar(30) NOT NULL DEFAULT '',
  status       varchar(20) NOT NULL DEFAULT 'draft',         -- draft (3차에서 rendering · done 추가)
  updated_at   timestamptz NOT NULL DEFAULT now()
);
