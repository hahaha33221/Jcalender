-- 2026-10-05 숏폼 제작 3차: 영상 만들기 (나레이션 음성 · 자막 · 합성) 대기열 (server/shortsRender.mjs)
-- 완성 영상은 VPS 디스크 /var/lib/jcalender/shorts/<user_id>/renders/<id>.mp4 에 저장
SET search_path = jcal, public;
CREATE TABLE IF NOT EXISTS shorts_renders (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  script_id    uuid REFERENCES shorts_scripts ON DELETE SET NULL,   -- 스크립트를 지워도 영상은 남음
  title        text NOT NULL DEFAULT '',
  input        jsonb NOT NULL DEFAULT '{}',                  -- 만들 때의 스크립트 · 배경 · 음악 · 영상 설정 (나중에 고쳐도 안 바뀜)
  status       varchar(10) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  stage        varchar(60) NOT NULL DEFAULT '',              -- 지금 하는 일 (목소리 만드는 중 · 배경 자르는 중 · 합치는 중)
  progress     int NOT NULL DEFAULT 0,                       -- 0~100
  error        text NOT NULL DEFAULT '',
  duration     numeric(10, 2),
  size_bytes   bigint NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  started_at   timestamptz,
  finished_at  timestamptz
);
CREATE INDEX IF NOT EXISTS shorts_renders_user_idx ON shorts_renders (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS shorts_renders_queue_idx ON shorts_renders (created_at) WHERE status IN ('queued', 'running');
