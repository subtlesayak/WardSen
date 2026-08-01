import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";
import type { AccountRecord, AuditLogRecord, DeliveryBatchRecord, DeliveryRecord, PaginatedResult, PaginationInput, PersonRecord } from "@wardsen/core";
import { migrations } from "./migrations";
import type { DeliveryQuery, PeopleQuery, PersonUpsertInput, WardSenRepository } from "./repositories";

export class SqliteWardSenRepository implements WardSenRepository {
  private readonly db: DatabaseSync;
  private readonly databasePath: string;

  constructor(databasePath: string) {
    this.databasePath = databasePath;
    mkdirSync(path.dirname(databasePath), { recursive: true });
    hardenFileMode(path.dirname(databasePath), 0o700);
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.applyMigrations();
    hardenDatabaseFiles(databasePath);
  }

  close(): void {
    hardenDatabaseFiles(this.databasePath);
    this.db.close();
  }

  async listAccounts(): Promise<AccountRecord[]> {
    return this.db.prepare("SELECT * FROM accounts ORDER BY label ASC").all().map(accountFromRow);
  }

  async upsertAccount(input: Omit<AccountRecord, "createdAt" | "updatedAt" | "status"> & { status?: AccountRecord["status"] }): Promise<AccountRecord> {
    const now = new Date().toISOString();
    const existing = this.db.prepare("SELECT * FROM accounts WHERE id = ?").get(input.id) as AccountRow | undefined;
    this.db.prepare(`
      INSERT INTO accounts (id, provider_id, label, username, server_url, profile_directory, account_type, auto_lock_minutes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider_id = excluded.provider_id,
        label = excluded.label,
        username = excluded.username,
        server_url = excluded.server_url,
        profile_directory = excluded.profile_directory,
        account_type = excluded.account_type,
        auto_lock_minutes = excluded.auto_lock_minutes,
        updated_at = excluded.updated_at
    `).run(
      input.id,
      input.providerId,
      input.label,
      input.username ?? null,
      input.serverUrl ?? null,
      input.profileDirectory,
      input.accountType ?? null,
      input.autoLockMinutes,
      existing?.created_at ?? now,
      now
    );
    return {
      ...input,
      status: input.status ?? "locked",
      createdAt: existing?.created_at ?? now,
      updatedAt: now
    };
  }

  async deleteAccount(id: string): Promise<void> {
    this.db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
  }

  async listPeople(query: PeopleQuery): Promise<PaginatedResult<PersonRecord>> {
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    if (query.active !== undefined) {
      where.push("active = ?");
      params.push(query.active ? 1 : 0);
    }
    if (query.groupName) {
      where.push("group_name = ?");
      params.push(query.groupName);
    }
    if (query.search?.trim()) {
      where.push("(name LIKE ? OR email LIKE ? OR phone LIKE ? OR group_name LIKE ? OR role LIKE ?)");
      const pattern = `%${query.search.trim()}%`;
      params.push(pattern, pattern, pattern, pattern, pattern);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const sortMap = { name: "name", groupName: "group_name", createdAt: "created_at" } as const;
    const sortBy = sortMap[query.sortBy ?? "name"];
    const sortDirection = query.sortDirection === "desc" ? "DESC" : "ASC";
    const page = Math.max(1, query.page);
    const pageSize = Math.min(Math.max(1, query.pageSize), 100);
    const offset = (page - 1) * pageSize;
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS count FROM people ${whereSql}`).get(...params) as { count: number }).count);
    const rows = this.db
      .prepare(`SELECT * FROM people ${whereSql} ORDER BY ${sortBy} ${sortDirection} LIMIT ? OFFSET ?`)
      .all(...params, pageSize, offset)
      .map(personFromRow);
    return { items: rows, page, pageSize, total };
  }

  async getPerson(id: string): Promise<PersonRecord | undefined> {
    const row = this.db.prepare("SELECT * FROM people WHERE id = ?").get(id);
    return row ? personFromRow(row) : undefined;
  }

  async upsertPerson(input: PersonUpsertInput): Promise<PersonRecord> {
    const now = new Date().toISOString();
    const id = input.id ?? crypto.randomUUID();
    const active = input.active ?? true;
    const existing = this.db.prepare("SELECT * FROM people WHERE id = ?").get(id) as PersonRow | undefined;
    this.db.prepare(`
      INSERT INTO people (id, name, phone, email, group_name, role, notes, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        phone = excluded.phone,
        email = excluded.email,
        group_name = excluded.group_name,
        role = excluded.role,
        notes = excluded.notes,
        active = excluded.active,
        updated_at = excluded.updated_at
    `).run(
      id,
      input.name,
      input.phone ?? null,
      input.email ?? null,
      input.groupName ?? null,
      input.role ?? null,
      input.notes ?? null,
      active ? 1 : 0,
      existing?.created_at ?? now,
      now
    );
    return { ...input, id, active, createdAt: existing?.created_at ?? now, updatedAt: now };
  }

  async archivePerson(id: string): Promise<void> {
    this.db.prepare("UPDATE people SET active = 0, updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  }

  async restorePerson(id: string): Promise<void> {
    this.db.prepare("UPDATE people SET active = 1, updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  }

  async deletePerson(id: string): Promise<void> {
    this.db.prepare("DELETE FROM people WHERE id = ?").run(id);
  }

  async findDuplicatePeople(input: { email?: string; phone?: string }): Promise<PersonRecord[]> {
    if (!input.email && !input.phone) return [];
    const where: string[] = [];
    const params: string[] = [];
    if (input.email) {
      where.push("email = ?");
      params.push(input.email);
    }
    if (input.phone) {
      where.push("phone = ?");
      params.push(input.phone);
    }
    return this.db.prepare(`SELECT * FROM people WHERE ${where.join(" OR ")}`).all(...params).map(personFromRow);
  }

  async createDelivery(record: Omit<DeliveryRecord, "id" | "createdAt"> & { id?: string }): Promise<DeliveryRecord> {
    const id = record.id ?? crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO deliveries (
        id, provider_delivery_id, source_provider_id, source_account_id, source_item_id, delivery_provider_id,
        delivery_account_id, credential_name, person_id, batch_id, delivery_method, created_at, expires_at,
        view_limit, access_count, status, revoked_at, last_checked_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      record.providerDeliveryId ?? null,
      record.sourceProviderId,
      record.sourceAccountId,
      record.sourceItemId,
      record.deliveryProviderId,
      record.deliveryAccountId,
      record.credentialName,
      record.personId ?? null,
      record.batchId ?? null,
      record.deliveryMethod ?? null,
      createdAt,
      record.expiresAt,
      record.viewLimit ?? null,
      record.accessCount ?? null,
      record.status,
      record.revokedAt ?? null,
      record.lastCheckedAt ?? null
    );
    return { ...record, id, createdAt };
  }

  async getDelivery(id: string): Promise<DeliveryRecord | undefined> {
    const row = this.db.prepare("SELECT * FROM deliveries WHERE id = ?").get(id);
    return row ? deliveryFromRow(row) : undefined;
  }

  async listDeliveries(query: DeliveryQuery): Promise<PaginatedResult<DeliveryRecord>> {
    const page = Math.max(1, query.page);
    const pageSize = Math.min(Math.max(1, query.pageSize), 100);
    const offset = (page - 1) * pageSize;
    const whereSql = query.batchId ? "WHERE batch_id = ?" : "";
    const params: SQLInputValue[] = query.batchId ? [query.batchId] : [];
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS count FROM deliveries ${whereSql}`).get(...params) as { count: number }).count);
    const rows = this.db
      .prepare(`SELECT * FROM deliveries ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, offset)
      .map(deliveryFromRow);
    return { items: rows, page, pageSize, total };
  }

  async updateDelivery(id: string, patch: Partial<DeliveryRecord>): Promise<DeliveryRecord> {
    const existing = this.db.prepare("SELECT * FROM deliveries WHERE id = ?").get(id) as DeliveryRow | undefined;
    if (!existing) throw new Error(`Unknown delivery: ${id}`);
    const updated = { ...deliveryFromRow(existing), ...patch };
    this.db.prepare(`
      UPDATE deliveries SET
        provider_delivery_id = ?, expires_at = ?, access_count = ?, status = ?, revoked_at = ?, last_checked_at = ?
      WHERE id = ?
    `).run(
      updated.providerDeliveryId ?? null,
      updated.expiresAt,
      updated.accessCount ?? null,
      updated.status,
      updated.revokedAt ?? null,
      updated.lastCheckedAt ?? null,
      id
    );
    return updated;
  }

  async createBatch(record: Omit<DeliveryBatchRecord, "createdAt" | "completedAt"> & { completedAt?: string }): Promise<DeliveryBatchRecord> {
    const createdAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO delivery_batches (id, requested_count, completed_count, failed_count, cancelled, created_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.id,
      record.requestedCount,
      record.completedCount,
      record.failedCount,
      record.cancelled ? 1 : 0,
      createdAt,
      record.completedAt ?? null
    );
    return { ...record, createdAt };
  }

  async getBatch(id: string): Promise<DeliveryBatchRecord | undefined> {
    const row = this.db.prepare("SELECT * FROM delivery_batches WHERE id = ?").get(id);
    return row ? batchFromRow(row) : undefined;
  }

  async listBatches(query: PaginationInput): Promise<PaginatedResult<DeliveryBatchRecord>> {
    const page = Math.max(1, query.page);
    const pageSize = Math.min(Math.max(1, query.pageSize), 100);
    const offset = (page - 1) * pageSize;
    const total = Number((this.db.prepare("SELECT COUNT(*) AS count FROM delivery_batches").get() as { count: number }).count);
    const rows = this.db
      .prepare("SELECT * FROM delivery_batches ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?")
      .all(pageSize, offset)
      .map(batchFromRow);
    return { items: rows, page, pageSize, total };
  }

  async updateBatch(id: string, patch: Partial<DeliveryBatchRecord>): Promise<DeliveryBatchRecord> {
    const existing = await this.getBatch(id);
    if (!existing) throw new Error(`Unknown batch: ${id}`);
    const updated = { ...existing, ...patch };
    this.db.prepare(`
      UPDATE delivery_batches
      SET requested_count = ?, completed_count = ?, failed_count = ?, cancelled = ?, completed_at = ?
      WHERE id = ?
    `).run(
      updated.requestedCount,
      updated.completedCount,
      updated.failedCount,
      updated.cancelled ? 1 : 0,
      updated.completedAt ?? null,
      id
    );
    return updated;
  }

  async appendAuditLog(record: Omit<AuditLogRecord, "id" | "createdAt"> & { id?: string }): Promise<AuditLogRecord> {
    const audit: AuditLogRecord = { ...record, id: record.id ?? crypto.randomUUID(), createdAt: new Date().toISOString() };
    this.db.prepare(`
      INSERT INTO audit_log (
        id, action, source_account_id, delivery_account_id, person_id, delivery_id, outcome, safe_details, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      audit.id,
      audit.action,
      audit.sourceAccountId ?? null,
      audit.deliveryAccountId ?? null,
      audit.personId ?? null,
      audit.deliveryId ?? null,
      audit.outcome,
      audit.safeDetails ?? null,
      audit.createdAt
    );
    return audit;
  }

  async listAuditLog(query: PaginationInput): Promise<PaginatedResult<AuditLogRecord>> {
    const page = Math.max(1, query.page);
    const pageSize = Math.min(Math.max(1, query.pageSize), 100);
    const offset = (page - 1) * pageSize;
    const total = Number((this.db.prepare("SELECT COUNT(*) AS count FROM audit_log").get() as { count: number }).count);
    const rows = this.db.prepare("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ? OFFSET ?").all(pageSize, offset).map(auditFromRow);
    return { items: rows, page, pageSize, total };
  }

  private applyMigrations(): void {
    this.db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);");
    const applied = new Set(
      this.db.prepare("SELECT id FROM schema_migrations").all().map((row) => (row as { id: string }).id)
    );
    for (const migration of migrations) {
      if (applied.has(migration.id)) continue;
      this.db.exec("BEGIN");
      try {
        this.db.exec(migration.sql);
        this.db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(migration.id, new Date().toISOString());
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
  }
}

function hardenDatabaseFiles(databasePath: string): void {
  hardenFileMode(databasePath, 0o600);
  hardenFileMode(`${databasePath}-wal`, 0o600);
  hardenFileMode(`${databasePath}-shm`, 0o600);
}

function hardenFileMode(targetPath: string, mode: number): void {
  if (process.platform === "win32") return;
  try {
    chmodSync(targetPath, mode);
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
    if (code !== "ENOENT") throw error;
  }
}

interface AccountRow {
  id: string;
  provider_id: string;
  label: string;
  username: string | null;
  server_url: string | null;
  profile_directory: string;
  account_type: string | null;
  auto_lock_minutes: number;
  created_at: string;
  updated_at: string;
}

interface PersonRow {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  group_name: string | null;
  role: string | null;
  notes: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

interface DeliveryRow {
  id: string;
  provider_delivery_id: string | null;
  source_provider_id: string;
  source_account_id: string;
  source_item_id: string;
  delivery_provider_id: string;
  delivery_account_id: string;
  credential_name: string;
  person_id: string | null;
  batch_id: string | null;
  delivery_method: string | null;
  created_at: string;
  expires_at: string;
  view_limit: number | null;
  access_count: number | null;
  status: DeliveryRecord["status"];
  revoked_at: string | null;
  last_checked_at: string | null;
}

interface BatchRow {
  id: string;
  requested_count: number;
  completed_count: number;
  failed_count: number;
  cancelled: number;
  created_at: string;
  completed_at: string | null;
}

interface AuditRow {
  id: string;
  action: string;
  source_account_id: string | null;
  delivery_account_id: string | null;
  person_id: string | null;
  delivery_id: string | null;
  outcome: AuditLogRecord["outcome"];
  safe_details: string | null;
  created_at: string;
}

function accountFromRow(row: unknown): AccountRecord {
  const item = row as AccountRow;
  return {
    id: item.id,
    providerId: item.provider_id,
    label: item.label,
    username: item.username ?? undefined,
    serverUrl: item.server_url ?? undefined,
    profileDirectory: item.profile_directory,
    accountType: item.account_type ?? undefined,
    autoLockMinutes: item.auto_lock_minutes,
    status: "locked",
    createdAt: item.created_at,
    updatedAt: item.updated_at
  };
}

function personFromRow(row: unknown): PersonRecord {
  const item = row as PersonRow;
  return {
    id: item.id,
    name: item.name,
    phone: item.phone ?? undefined,
    email: item.email ?? undefined,
    groupName: item.group_name ?? undefined,
    role: item.role ?? undefined,
    notes: item.notes ?? undefined,
    active: item.active === 1,
    createdAt: item.created_at,
    updatedAt: item.updated_at
  };
}

function deliveryFromRow(row: unknown): DeliveryRecord {
  const item = row as DeliveryRow;
  return {
    id: item.id,
    providerDeliveryId: item.provider_delivery_id ?? undefined,
    sourceProviderId: item.source_provider_id,
    sourceAccountId: item.source_account_id,
    sourceItemId: item.source_item_id,
    deliveryProviderId: item.delivery_provider_id,
    deliveryAccountId: item.delivery_account_id,
    credentialName: item.credential_name,
    personId: item.person_id ?? undefined,
    batchId: item.batch_id ?? undefined,
    deliveryMethod: item.delivery_method as DeliveryRecord["deliveryMethod"],
    createdAt: item.created_at,
    expiresAt: item.expires_at,
    viewLimit: item.view_limit ?? undefined,
    accessCount: item.access_count ?? undefined,
    status: item.status,
    revokedAt: item.revoked_at ?? undefined,
    lastCheckedAt: item.last_checked_at ?? undefined
  };
}

function batchFromRow(row: unknown): DeliveryBatchRecord {
  const item = row as BatchRow;
  return {
    id: item.id,
    requestedCount: item.requested_count,
    completedCount: item.completed_count,
    failedCount: item.failed_count,
    cancelled: item.cancelled === 1,
    createdAt: item.created_at,
    completedAt: item.completed_at ?? undefined
  };
}

function auditFromRow(row: unknown): AuditLogRecord {
  const item = row as AuditRow;
  return {
    id: item.id,
    action: item.action,
    sourceAccountId: item.source_account_id ?? undefined,
    deliveryAccountId: item.delivery_account_id ?? undefined,
    personId: item.person_id ?? undefined,
    deliveryId: item.delivery_id ?? undefined,
    outcome: item.outcome,
    safeDetails: item.safe_details ?? undefined,
    createdAt: item.created_at
  };
}
