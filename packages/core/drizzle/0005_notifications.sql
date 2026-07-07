-- Copyright Nisse Group Ltd
-- Notification system: subscriptions + delivery dedup. Alerts fire ONLY off
-- status_changes rows (the deterministic engine), never off raw reports or
-- community requests.

CREATE TABLE IF NOT EXISTS notification_subscriptions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel           text NOT NULL,                 -- webpush | email | telegram | sms
  scope             text NOT NULL DEFAULT 'corridor', -- corridor | segment
  segment_id        text REFERENCES segments (id),
  direction         text NOT NULL DEFAULT 'both',  -- both | north | south
  target            text NOT NULL,                 -- push JSON | email | chat_id | phone
  target_key        text NOT NULL,                 -- stable key for de-dup of identical subs
  verified          boolean NOT NULL DEFAULT false,
  verify_token      text,
  unsubscribe_token text NOT NULL,
  quiet_hours       boolean NOT NULL DEFAULT false,
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);
-- One active subscription per (channel target, scope, segment, direction).
CREATE UNIQUE INDEX IF NOT EXISTS notification_subscriptions_unique
  ON notification_subscriptions (channel, target_key, scope, coalesce(segment_id, ''), direction)
  WHERE active = true;
CREATE INDEX IF NOT EXISTS notification_subscriptions_scope_idx ON notification_subscriptions (scope, segment_id, active);
CREATE INDEX IF NOT EXISTS notification_subscriptions_verify_idx ON notification_subscriptions (verify_token);
CREATE INDEX IF NOT EXISTS notification_subscriptions_unsub_idx ON notification_subscriptions (unsubscribe_token);

-- One delivery row per (subscription, status_change) — the de-dup guarantee.
CREATE TABLE IF NOT EXISTS notification_deliveries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id  uuid NOT NULL REFERENCES notification_subscriptions (id) ON DELETE CASCADE,
  status_change_id uuid NOT NULL REFERENCES status_changes (id) ON DELETE CASCADE,
  channel          text NOT NULL,
  sent             boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subscription_id, status_change_id)
);

-- Fan-out cursor: which status_changes rows have been processed.
ALTER TABLE status_changes ADD COLUMN IF NOT EXISTS notified_at timestamptz;

-- OPTIONAL: notify a requester when someone responds to their community request
-- (kept entirely separate from the status alert stream).
ALTER TABLE community_requests ADD COLUMN IF NOT EXISTS notify_channel text;
ALTER TABLE community_requests ADD COLUMN IF NOT EXISTS notify_target text;
