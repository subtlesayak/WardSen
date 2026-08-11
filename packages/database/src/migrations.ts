export interface Migration {
  id: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    id: "001_initial_schema",
    sql: `
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  label TEXT NOT NULL,
  username TEXT,
  server_url TEXT,
  profile_directory TEXT NOT NULL,
  account_type TEXT,
  auto_lock_minutes INTEGER NOT NULL DEFAULT 15,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  group_name TEXT,
  role TEXT,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  provider_delivery_id TEXT,
  source_provider_id TEXT NOT NULL,
  source_account_id TEXT NOT NULL,
  source_item_id TEXT NOT NULL,
  delivery_provider_id TEXT NOT NULL,
  delivery_account_id TEXT NOT NULL,
  credential_name TEXT NOT NULL,
  person_id TEXT,
  batch_id TEXT,
  delivery_method TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  view_limit INTEGER,
  access_count INTEGER,
  status TEXT NOT NULL,
  revoked_at TEXT,
  last_checked_at TEXT
);

CREATE TABLE IF NOT EXISTS delivery_batches (
  id TEXT PRIMARY KEY,
  requested_count INTEGER NOT NULL,
  completed_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  cancelled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  source_account_id TEXT,
  delivery_account_id TEXT,
  person_id TEXT,
  delivery_id TEXT,
  outcome TEXT NOT NULL,
  safe_details TEXT,
  created_at TEXT NOT NULL
);
`
  },
  {
    id: "002_constraints_indexes_retention",
    sql: `
CREATE INDEX IF NOT EXISTS idx_people_active_name ON people(active, name);
CREATE INDEX IF NOT EXISTS idx_people_email ON people(email);
CREATE INDEX IF NOT EXISTS idx_people_phone ON people(phone);
CREATE INDEX IF NOT EXISTS idx_deliveries_batch_created ON deliveries(batch_id, created_at);
CREATE INDEX IF NOT EXISTS idx_deliveries_status_checked ON deliveries(status, last_checked_at);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);

CREATE TRIGGER IF NOT EXISTS deliveries_validate_insert
BEFORE INSERT ON deliveries
WHEN NEW.status NOT IN ('queued', 'creating', 'active', 'viewed', 'limit_reached', 'expired', 'revoked', 'failed', 'cancelled')
  OR (NEW.view_limit IS NOT NULL AND NEW.view_limit <= 0)
  OR (NEW.access_count IS NOT NULL AND NEW.access_count < 0)
BEGIN
  SELECT RAISE(ABORT, 'invalid delivery metadata');
END;

CREATE TRIGGER IF NOT EXISTS deliveries_validate_update
BEFORE UPDATE ON deliveries
WHEN NEW.status NOT IN ('queued', 'creating', 'active', 'viewed', 'limit_reached', 'expired', 'revoked', 'failed', 'cancelled')
  OR (NEW.view_limit IS NOT NULL AND NEW.view_limit <= 0)
  OR (NEW.access_count IS NOT NULL AND NEW.access_count < 0)
BEGIN
  SELECT RAISE(ABORT, 'invalid delivery metadata');
END;

CREATE TRIGGER IF NOT EXISTS audit_log_validate_insert
BEFORE INSERT ON audit_log
WHEN NEW.outcome NOT IN ('success', 'failure', 'cancelled')
BEGIN
  SELECT RAISE(ABORT, 'invalid audit outcome');
END;

CREATE TRIGGER IF NOT EXISTS audit_log_validate_update
BEFORE UPDATE ON audit_log
WHEN NEW.outcome NOT IN ('success', 'failure', 'cancelled')
BEGIN
  SELECT RAISE(ABORT, 'invalid audit outcome');
END;
`
  }
];
