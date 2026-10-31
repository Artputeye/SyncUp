CREATE TABLE IF NOT EXISTS tenant_settings (
  key VARCHAR(120) PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID,
  action VARCHAR(160) NOT NULL,
  resource_type VARCHAR(120),
  resource_id VARCHAR(160),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS audit_events_created_at_idx ON audit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_events_actor_id_idx ON audit_events (actor_id);

CREATE TABLE IF NOT EXISTS tenant_migrations (
  version VARCHAR(80) PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);