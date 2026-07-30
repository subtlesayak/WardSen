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
  }
];
