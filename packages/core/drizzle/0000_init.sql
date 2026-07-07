-- Copyright Nisse Group Ltd
-- Spakwus core schema: PostGIS extension, tables, indexes.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS segments (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  from_label  text NOT NULL,
  to_label    text NOT NULL,
  ord         integer NOT NULL,
  geom        geometry(LineString, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS segments_geom_idx ON segments USING gist (geom);

CREATE TABLE IF NOT EXISTS incidents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id  text NOT NULL REFERENCES segments (id),
  kind        text NOT NULL,
  status      text NOT NULL,
  source      text NOT NULL,
  confidence  text NOT NULL,
  summary     text,
  geom        geometry(Point, 4326),
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS incidents_segment_active_idx ON incidents (segment_id, active);
CREATE INDEX IF NOT EXISTS incidents_geom_idx ON incidents USING gist (geom);

CREATE TABLE IF NOT EXISTS reports (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id   text NOT NULL REFERENCES segments (id),
  incident_id  uuid REFERENCES incidents (id),
  source       text NOT NULL,
  kind         text NOT NULL,
  reporter_id  text NOT NULL,
  is_steward   boolean NOT NULL DEFAULT false,
  external_id  text,
  raw_text     text,
  summary      text,
  confidence   text,
  geom         geometry(Point, 4326),
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
-- Idempotent upsert target for Open511 (and other upstream) ingestion.
CREATE UNIQUE INDEX IF NOT EXISTS reports_external_id_key
  ON reports (external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS reports_segment_created_idx ON reports (segment_id, created_at);
CREATE INDEX IF NOT EXISTS reports_active_idx ON reports (active);
CREATE INDEX IF NOT EXISTS reports_geom_idx ON reports USING gist (geom);

CREATE TABLE IF NOT EXISTS segment_status (
  segment_id  text PRIMARY KEY REFERENCES segments (id),
  status      text NOT NULL,
  source      text NOT NULL,
  confidence  text NOT NULL,
  reason      text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webcams (
  id                text PRIMARY KEY,
  segment_id        text NOT NULL REFERENCES segments (id),
  label             text NOT NULL,
  image_url         text NOT NULL,
  source_url        text,
  attribution       text,
  refresh_seconds   integer NOT NULL DEFAULT 120,
  last_captured_at  timestamptz,
  last_image_url    text,
  active            boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS status_changes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id  text NOT NULL REFERENCES segments (id),
  from_state  text,
  to_state    text NOT NULL,
  cause       text NOT NULL,
  actor       text NOT NULL,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS status_changes_segment_idx ON status_changes (segment_id, created_at);
