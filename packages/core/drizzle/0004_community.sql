-- Copyright Nisse Group Ltd
-- Community plane: requests board. STRICTLY separate from the status plane —
-- these rows are never read by deriveStatus.

CREATE TABLE IF NOT EXISTS community_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind           text NOT NULL,          -- need | offer | info
  category       text NOT NULL,          -- welfare | supplies | ride | shelter | eyes_on | other
  segment_id     text NOT NULL REFERENCES segments (id),
  incident_id    uuid REFERENCES incidents (id),   -- auto-linked at creation; nullable
  geom           geometry(Point, 4326),
  location_desc  text,
  body           text NOT NULL,
  contact_method text NOT NULL DEFAULT 'in_app',   -- in_app | phone | none
  contact_value  text,
  status         text NOT NULL DEFAULT 'open',      -- open | matched | resolved | expired
  created_by     text NOT NULL,          -- anonymous device token
  flag_count     integer NOT NULL DEFAULT 0,
  removed_at     timestamptz,
  removed_by     text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS community_requests_segment_status_idx ON community_requests (segment_id, status);
CREATE INDEX IF NOT EXISTS community_requests_incident_idx ON community_requests (incident_id);
CREATE INDEX IF NOT EXISTS community_requests_expiry_idx ON community_requests (status, expires_at);
CREATE INDEX IF NOT EXISTS community_requests_geom_idx ON community_requests USING gist (geom);

CREATE TABLE IF NOT EXISTS request_responses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id    uuid NOT NULL REFERENCES community_requests (id) ON DELETE CASCADE,
  body          text NOT NULL,
  responder_ref text NOT NULL,
  flag_count    integer NOT NULL DEFAULT 0,
  removed_at    timestamptz,
  removed_by    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS request_responses_request_idx ON request_responses (request_id, created_at);
