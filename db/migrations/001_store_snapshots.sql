-- 2026-10-01 앱 동기화용 최신본 표 (schema.sql 에도 있음, 이미 있으면 건너뜀)
SET search_path = jcal, public;
CREATE TABLE IF NOT EXISTS store_snapshots (
  user_id     uuid PRIMARY KEY REFERENCES users ON DELETE CASCADE,
  version     bigint NOT NULL DEFAULT 0,
  data        jsonb NOT NULL,
  device      varchar(100) NOT NULL DEFAULT '',
  size_bytes  int NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'store_snapshots_touch') THEN
    CREATE TRIGGER store_snapshots_touch BEFORE UPDATE ON jcal.store_snapshots FOR EACH ROW EXECUTE FUNCTION jcal.touch_updated_at();
  END IF;
END $$;
