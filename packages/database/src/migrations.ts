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
  },
  {
    id: "003_delivery_idempotency",
    sql: `
ALTER TABLE deliveries ADD COLUMN operation_id TEXT;
ALTER TABLE deliveries ADD COLUMN operation_fingerprint TEXT;
ALTER TABLE deliveries ADD COLUMN policy_snapshot TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_deliveries_operation_id
ON deliveries(operation_id)
WHERE operation_id IS NOT NULL;
`
  },
  {
    id: "004_employee_request_catalog",
    sql: `
CREATE TABLE IF NOT EXISTS employees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  assigned_email TEXT NOT NULL UNIQUE,
  team TEXT,
  role TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS credential_catalog (
  id TEXT PRIMARY KEY,
  source_provider_id TEXT NOT NULL,
  source_account_id TEXT NOT NULL,
  source_item_id TEXT NOT NULL,
  credential_name TEXT NOT NULL,
  username TEXT,
  domain TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  risk_tier TEXT NOT NULL DEFAULT 'medium',
  allowed_employee_ids TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS credential_access_requests (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  assigned_email TEXT NOT NULL,
  catalog_entry_id TEXT NOT NULL,
  source_provider_id TEXT NOT NULL,
  source_account_id TEXT NOT NULL,
  source_item_id TEXT NOT NULL,
  credential_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  ticket_ref TEXT,
  expected_duration_minutes INTEGER,
  status TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  decided_at TEXT,
  approver TEXT,
  decision_reason TEXT,
  delivery_id TEXT,
  delivery_provider_id TEXT,
  delivery_account_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_employees_active_name ON employees(active, name);
CREATE INDEX IF NOT EXISTS idx_employees_assigned_email ON employees(assigned_email);
CREATE INDEX IF NOT EXISTS idx_catalog_active_name ON credential_catalog(active, credential_name);
CREATE INDEX IF NOT EXISTS idx_access_requests_employee_status ON credential_access_requests(employee_id, status, requested_at);
CREATE INDEX IF NOT EXISTS idx_access_requests_status_requested ON credential_access_requests(status, requested_at);

CREATE TRIGGER IF NOT EXISTS credential_catalog_validate_insert
BEFORE INSERT ON credential_catalog
WHEN NEW.risk_tier NOT IN ('low', 'medium', 'high', 'critical')
BEGIN
  SELECT RAISE(ABORT, 'invalid credential catalog risk tier');
END;

CREATE TRIGGER IF NOT EXISTS credential_catalog_validate_update
BEFORE UPDATE ON credential_catalog
WHEN NEW.risk_tier NOT IN ('low', 'medium', 'high', 'critical')
BEGIN
  SELECT RAISE(ABORT, 'invalid credential catalog risk tier');
END;

CREATE TRIGGER IF NOT EXISTS credential_access_requests_validate_insert
BEFORE INSERT ON credential_access_requests
WHEN NEW.status NOT IN ('pending', 'approved', 'denied', 'fulfilled', 'cancelled')
  OR length(trim(NEW.reason)) = 0
  OR (NEW.expected_duration_minutes IS NOT NULL AND NEW.expected_duration_minutes <= 0)
BEGIN
  SELECT RAISE(ABORT, 'invalid credential access request');
END;

CREATE TRIGGER IF NOT EXISTS credential_access_requests_validate_update
BEFORE UPDATE ON credential_access_requests
WHEN NEW.status NOT IN ('pending', 'approved', 'denied', 'fulfilled', 'cancelled')
  OR length(trim(NEW.reason)) = 0
  OR (NEW.expected_duration_minutes IS NOT NULL AND NEW.expected_duration_minutes <= 0)
BEGIN
  SELECT RAISE(ABORT, 'invalid credential access request');
END;
`
  },
  {
    id: "005_employee_portal_auth",
    sql: `
CREATE TABLE IF NOT EXISTS employee_sign_in_codes (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  assigned_email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS employee_sessions (
  id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  assigned_email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_employee_codes_employee_hash ON employee_sign_in_codes(employee_id, code_hash);
CREATE INDEX IF NOT EXISTS idx_employee_codes_expiry ON employee_sign_in_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_employee_sessions_token ON employee_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_employee_sessions_employee_expiry ON employee_sessions(employee_id, expires_at);

CREATE TRIGGER IF NOT EXISTS employee_sign_in_codes_validate_insert
BEFORE INSERT ON employee_sign_in_codes
WHEN length(trim(NEW.code_hash)) < 32 OR NEW.expires_at <= NEW.created_at
BEGIN
  SELECT RAISE(ABORT, 'invalid employee sign-in code');
END;

CREATE TRIGGER IF NOT EXISTS employee_sign_in_codes_validate_update
BEFORE UPDATE ON employee_sign_in_codes
WHEN length(trim(NEW.code_hash)) < 32 OR NEW.expires_at <= NEW.created_at
BEGIN
  SELECT RAISE(ABORT, 'invalid employee sign-in code');
END;

CREATE TRIGGER IF NOT EXISTS employee_sessions_validate_insert
BEFORE INSERT ON employee_sessions
WHEN length(trim(NEW.token_hash)) < 32 OR NEW.expires_at <= NEW.created_at
BEGIN
  SELECT RAISE(ABORT, 'invalid employee session');
END;

CREATE TRIGGER IF NOT EXISTS employee_sessions_validate_update
BEFORE UPDATE ON employee_sessions
WHEN length(trim(NEW.token_hash)) < 32 OR NEW.expires_at <= NEW.created_at
BEGIN
  SELECT RAISE(ABORT, 'invalid employee session');
END;
`
  },
  {
    id: "006_request_replacement_metadata",
    sql: `
ALTER TABLE credential_access_requests ADD COLUMN previous_delivery_id TEXT;
ALTER TABLE credential_access_requests ADD COLUMN replacement_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE credential_access_requests ADD COLUMN last_replacement_at TEXT;

CREATE INDEX IF NOT EXISTS idx_access_requests_delivery_id ON credential_access_requests(delivery_id);
CREATE INDEX IF NOT EXISTS idx_access_requests_previous_delivery_id ON credential_access_requests(previous_delivery_id);
`
  },
  {
    id: "007_employee_person_link",
    sql: `
ALTER TABLE employees ADD COLUMN person_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_person_id
ON employees(person_id)
WHERE person_id IS NOT NULL;
`
  },
  {
    id: "008_catalog_policy_rules",
    sql: `
ALTER TABLE credential_catalog ADD COLUMN allowed_teams TEXT NOT NULL DEFAULT '[]';
ALTER TABLE credential_catalog ADD COLUMN allowed_roles TEXT NOT NULL DEFAULT '[]';
`
  },
  {
    id: "009_catalog_auto_approval_policy",
    sql: `
ALTER TABLE credential_catalog ADD COLUMN auto_approval_policy TEXT;
`
  },
  {
    id: "010_credential_request_break_glass",
    sql: `
ALTER TABLE credential_access_requests ADD COLUMN break_glass INTEGER NOT NULL DEFAULT 0;
ALTER TABLE credential_access_requests ADD COLUMN break_glass_justification TEXT;
ALTER TABLE credential_access_requests ADD COLUMN break_glass_confirmed_at TEXT;

DROP TRIGGER IF EXISTS credential_access_requests_validate_insert;
DROP TRIGGER IF EXISTS credential_access_requests_validate_update;

CREATE TRIGGER IF NOT EXISTS credential_access_requests_validate_insert
BEFORE INSERT ON credential_access_requests
WHEN NEW.status NOT IN ('pending', 'approved', 'break_glass', 'denied', 'fulfilled', 'cancelled')
  OR length(trim(NEW.reason)) = 0
  OR (NEW.expected_duration_minutes IS NOT NULL AND NEW.expected_duration_minutes <= 0)
  OR NEW.break_glass NOT IN (0, 1)
  OR (NEW.status = 'break_glass' AND NEW.break_glass != 1)
  OR (NEW.break_glass = 1 AND (
    NEW.break_glass_justification IS NULL
    OR length(trim(NEW.break_glass_justification)) < 12
    OR NEW.break_glass_confirmed_at IS NULL
  ))
BEGIN
  SELECT RAISE(ABORT, 'invalid credential access request');
END;

CREATE TRIGGER IF NOT EXISTS credential_access_requests_validate_update
BEFORE UPDATE ON credential_access_requests
WHEN NEW.status NOT IN ('pending', 'approved', 'break_glass', 'denied', 'fulfilled', 'cancelled')
  OR length(trim(NEW.reason)) = 0
  OR (NEW.expected_duration_minutes IS NOT NULL AND NEW.expected_duration_minutes <= 0)
  OR NEW.break_glass NOT IN (0, 1)
  OR (NEW.status = 'break_glass' AND NEW.break_glass != 1)
  OR (NEW.break_glass = 1 AND (
    NEW.break_glass_justification IS NULL
    OR length(trim(NEW.break_glass_justification)) < 12
    OR NEW.break_glass_confirmed_at IS NULL
  ))
BEGIN
  SELECT RAISE(ABORT, 'invalid credential access request');
END;
`
  },
  {
    id: "011_employee_auth_retention_indexes",
    sql: `
CREATE INDEX IF NOT EXISTS idx_employee_sessions_expiry ON employee_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_employee_sessions_revoked_at ON employee_sessions(revoked_at);
`
  },
  {
    id: "012_delivery_manual_handoff_status",
    sql: `
DROP TRIGGER IF EXISTS deliveries_validate_insert;
DROP TRIGGER IF EXISTS deliveries_validate_update;

CREATE TRIGGER IF NOT EXISTS deliveries_validate_insert
BEFORE INSERT ON deliveries
WHEN NEW.status NOT IN ('queued', 'creating', 'handoff_pending', 'active', 'viewed', 'limit_reached', 'expired', 'revoked', 'failed', 'cancelled')
  OR (NEW.view_limit IS NOT NULL AND NEW.view_limit <= 0)
  OR (NEW.access_count IS NOT NULL AND NEW.access_count < 0)
BEGIN
  SELECT RAISE(ABORT, 'invalid delivery metadata');
END;

CREATE TRIGGER IF NOT EXISTS deliveries_validate_update
BEFORE UPDATE ON deliveries
WHEN NEW.status NOT IN ('queued', 'creating', 'handoff_pending', 'active', 'viewed', 'limit_reached', 'expired', 'revoked', 'failed', 'cancelled')
  OR (NEW.view_limit IS NOT NULL AND NEW.view_limit <= 0)
  OR (NEW.access_count IS NOT NULL AND NEW.access_count < 0)
BEGIN
  SELECT RAISE(ABORT, 'invalid delivery metadata');
END;
`
  },
  {
    id: "013_delivery_first_viewed_at",
    sql: `
ALTER TABLE deliveries ADD COLUMN first_viewed_at TEXT;
CREATE INDEX IF NOT EXISTS idx_deliveries_first_viewed_at ON deliveries(first_viewed_at);
`
  }
];
