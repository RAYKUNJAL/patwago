CREATE TABLE IF NOT EXISTS analytics_events (
  id text PRIMARY KEY,
  name varchar(60) NOT NULL,
  session_id varchar(120),
  anonymous_id varchar(120),
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analytics_events_created_idx ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_name_idx ON analytics_events(name);
CREATE INDEX IF NOT EXISTS analytics_events_session_idx ON analytics_events(session_id);
