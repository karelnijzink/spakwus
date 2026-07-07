-- Copyright Nisse Group Ltd
-- Public web reporting, trust levels, moderation, and steward overrides.

-- Extend reports for public/web submissions and moderation.
ALTER TABLE reports ADD COLUMN IF NOT EXISTS incident_type text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS trust_level text NOT NULL DEFAULT 'anon';
ALTER TABLE reports ADD COLUMN IF NOT EXISTS contact text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS device_token text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS severity text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS moderation_state text NOT NULL DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS reports_moderation_idx ON reports (moderation_state);
CREATE INDEX IF NOT EXISTS reports_device_token_idx ON reports (device_token);

-- Manual steward status overrides (deriveStatus rule 6). Reason is required and
-- is shown publicly on the affected segment.
CREATE TABLE IF NOT EXISTS steward_overrides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id  text NOT NULL REFERENCES segments (id),
  status      text NOT NULL,
  reason      text NOT NULL,
  steward_id  text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz,
  cleared_at  timestamptz
);
CREATE INDEX IF NOT EXISTS steward_overrides_active_idx ON steward_overrides (segment_id, active);

-- Append-only moderation / admin audit trail (complements status_changes).
CREATE TABLE IF NOT EXISTS audit_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor        text NOT NULL,
  action       text NOT NULL,
  target_type  text,
  target_id    text,
  reason       text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log (created_at);
