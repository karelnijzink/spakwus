-- Copyright Nisse Group Ltd
-- 0006_history.sql — historical corridor incident events, backfilled from the
-- DriveBC historical event CSV exports by scripts/load-history.ts. This table
-- powers the retrospective /api/history/stats view ONLY; it is never read by
-- deriveStatus or any live status path.

CREATE TABLE IF NOT EXISTS historical_events (
  -- DriveBC event id (or a synthesized stable id) — primary key for idempotent reloads.
  id               text PRIMARY KEY,
  event_type       text,
  severity         text,
  is_closure       boolean NOT NULL DEFAULT false,
  road_name        text,
  direction        text,
  segment_id       text REFERENCES segments(id),
  description      text,
  geom             geometry(Point, 4326),
  started_at       timestamptz,
  ended_at         timestamptz,
  updated_at       timestamptz,
  -- Closure/event duration in minutes, when both ends are known.
  duration_minutes integer,
  imported_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS historical_events_started_idx ON historical_events (started_at);
CREATE INDEX IF NOT EXISTS historical_events_segment_idx ON historical_events (segment_id);
CREATE INDEX IF NOT EXISTS historical_events_closure_idx ON historical_events (is_closure);
CREATE INDEX IF NOT EXISTS historical_events_geom_idx ON historical_events USING gist (geom);
