-- 2026-11-25 녹음 · 회의록: 휴대폰 녹음 서버(recording-api)의 녹음별 받아쓰기 · AI 회의록 (server/recordings.mjs)
-- rec_id = recording-api 의 녹음 번호. 녹음 파일 자체는 recording-api 에만 보관한다
SET search_path = jcal, public;
CREATE TABLE IF NOT EXISTS recording_minutes (
  rec_id        bigint PRIMARY KEY,
  sha256        varchar(64) NOT NULL DEFAULT '',
  device        varchar(60) NOT NULL DEFAULT '',
  filename      text NOT NULL DEFAULT '',
  size_bytes    bigint NOT NULL DEFAULT 0,
  recorded_at   timestamptz,
  uploaded_at   timestamptz,
  status        varchar(12) NOT NULL DEFAULT 'idle',   -- idle(수동) · queued · stt · summary · done · failed · skipped
  auto_run      boolean NOT NULL DEFAULT true,          -- false = 화면에서 버튼으로 요청 (하루 한도 · 길이 제한 없음)
  error         text NOT NULL DEFAULT '',
  duration      numeric,                                -- 초
  transcript    text NOT NULL DEFAULT '',
  minutes       jsonb,                                  -- { title, kind, summary, overview, agenda, details, conclusion, next_steps, etc }
  stt_model     varchar(80) NOT NULL DEFAULT '',
  ai_model      varchar(80) NOT NULL DEFAULT '',
  processed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recording_minutes_status ON recording_minutes (status);
