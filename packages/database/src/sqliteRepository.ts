import { chmodSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SQLInputValue } from "node:sqlite";
import type {
  AccountRecord,
  AuditLogRecord,
  CredentialAccessRequestRecord,
  CredentialCatalogEntry,
  DeliveryBatchRecord,
  DeliveryPolicySnapshot,
  DeliveryRecord,
  EmployeeRecord,
  EmployeeSessionRecord,
  EmployeeSignInCodeRecord,
  PaginatedResult,
  PaginationInput,
  PersonRecord
} from "@wardsen/core";
import { migrations } from "./migrations";
import type {
  CredentialAccessRequestCreateInput,
  CredentialAccessRequestQuery,
  CredentialCatalogQuery,
  CredentialCatalogUpsertInput,
  DeliveryQuery,
  EmployeeQuery,
  EmployeeSessionCreateInput,
  EmployeeSignInCodeCreateInput,
  EmployeeUpsertInput,
  PeopleQuery,
  PersonUpsertInput,
  WardSenRepository
} from "./repositories";

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
      INSERT INTO accounts (id, provider_id, label, username, server_url, provider_principal_id, profile_directory, account_type, auto_lock_minutes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        provider_id = excluded.provider_id,
        label = excluded.label,
        username = excluded.username,
        server_url = excluded.server_url,
        provider_principal_id = excluded.provider_principal_id,
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
      input.providerPrincipalId ?? existing?.provider_principal_id ?? null,
      input.profileDirectory,
      input.accountType ?? null,
      input.autoLockMinutes,
      existing?.created_at ?? now,
      now
    );
    return {
      ...input,
      providerPrincipalId: input.providerPrincipalId ?? existing?.provider_principal_id ?? undefined,
      status: input.status ?? "locked",
      createdAt: existing?.created_at ?? now,
      updatedAt: now
    };
  }

  async deleteAccount(id: string): Promise<void> {
    this.db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
  }

  async getLocalSetting(key: string): Promise<string | undefined> {
    const row = this.db.prepare("SELECT value FROM local_settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value;
  }

  async setLocalSetting(key: string, value: string): Promise<void> {
    this.db.prepare(`
      INSERT INTO local_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, value, new Date().toISOString());
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

  async listEmployees(query: EmployeeQuery): Promise<PaginatedResult<EmployeeRecord>> {
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    if (query.active !== undefined) {
      where.push("active = ?");
      params.push(query.active ? 1 : 0);
    }
    if (query.search?.trim()) {
      where.push("(name LIKE ? OR assigned_email LIKE ? OR team LIKE ? OR role LIKE ? OR person_id LIKE ?)");
      const pattern = `%${query.search.trim()}%`;
      params.push(pattern, pattern, pattern, pattern, pattern);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const page = Math.max(1, query.page);
    const pageSize = Math.min(Math.max(1, query.pageSize), 100);
    const offset = (page - 1) * pageSize;
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS count FROM employees ${whereSql}`).get(...params) as { count: number }).count);
    const rows = this.db
      .prepare(`SELECT * FROM employees ${whereSql} ORDER BY name ASC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, offset)
      .map(employeeFromRow);
    return { items: rows, page, pageSize, total };
  }

  async getEmployee(id: string): Promise<EmployeeRecord | undefined> {
    const row = this.db.prepare("SELECT * FROM employees WHERE id = ?").get(id);
    return row ? employeeFromRow(row) : undefined;
  }

  async getEmployeeByAssignedEmail(assignedEmail: string): Promise<EmployeeRecord | undefined> {
    const row = this.db.prepare("SELECT * FROM employees WHERE assigned_email = ?").get(normalizeEmail(assignedEmail));
    return row ? employeeFromRow(row) : undefined;
  }

  async upsertEmployee(input: EmployeeUpsertInput): Promise<EmployeeRecord> {
    const now = new Date().toISOString();
    const id = input.id ?? crypto.randomUUID();
    const assignedEmail = normalizeEmail(input.assignedEmail);
    const active = input.active ?? true;
    const existing = this.db.prepare("SELECT * FROM employees WHERE id = ?").get(id) as EmployeeRow | undefined;
    this.db.prepare(`
      INSERT INTO employees (id, person_id, name, assigned_email, team, role, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        person_id = excluded.person_id,
        name = excluded.name,
        assigned_email = excluded.assigned_email,
        team = excluded.team,
        role = excluded.role,
        active = excluded.active,
        updated_at = excluded.updated_at
    `).run(
      id,
      input.personId ?? null,
      input.name,
      assignedEmail,
      input.team ?? null,
      input.role ?? null,
      active ? 1 : 0,
      existing?.created_at ?? now,
      now
    );
    return { ...input, id, personId: input.personId, assignedEmail, active, createdAt: existing?.created_at ?? now, updatedAt: now };
  }

  async createEmployeeSignInCode(input: EmployeeSignInCodeCreateInput): Promise<EmployeeSignInCodeRecord> {
    const code: EmployeeSignInCodeRecord = {
      ...input,
      id: input.id ?? crypto.randomUUID(),
      assignedEmail: normalizeEmail(input.assignedEmail),
      createdAt: new Date().toISOString()
    };
    this.db.prepare(`
      INSERT INTO employee_sign_in_codes (id, employee_id, assigned_email, code_hash, expires_at, used_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(code.id, code.employeeId, code.assignedEmail, code.codeHash, code.expiresAt, code.usedAt ?? null, code.createdAt);
    return code;
  }

  async getEmployeeSignInCodeByHash(employeeId: string, codeHash: string): Promise<EmployeeSignInCodeRecord | undefined> {
    const row = this.db
      .prepare("SELECT * FROM employee_sign_in_codes WHERE employee_id = ? AND code_hash = ? ORDER BY created_at DESC LIMIT 1")
      .get(employeeId, codeHash);
    return row ? employeeSignInCodeFromRow(row) : undefined;
  }

  async updateEmployeeSignInCode(id: string, patch: Partial<EmployeeSignInCodeRecord>): Promise<EmployeeSignInCodeRecord> {
    const existingRow = this.db.prepare("SELECT * FROM employee_sign_in_codes WHERE id = ?").get(id);
    if (!existingRow) throw new Error(`Unknown employee sign-in code: ${id}`);
    const updated = {
      ...employeeSignInCodeFromRow(existingRow),
      ...patch,
      assignedEmail: patch.assignedEmail ? normalizeEmail(patch.assignedEmail) : employeeSignInCodeFromRow(existingRow).assignedEmail
    };
    this.db.prepare(`
      UPDATE employee_sign_in_codes
      SET employee_id = ?, assigned_email = ?, code_hash = ?, expires_at = ?, used_at = ?, created_at = ?
      WHERE id = ?
    `).run(updated.employeeId, updated.assignedEmail, updated.codeHash, updated.expiresAt, updated.usedAt ?? null, updated.createdAt, id);
    return updated;
  }

  async createEmployeeSession(input: EmployeeSessionCreateInput): Promise<EmployeeSessionRecord> {
    const session: EmployeeSessionRecord = {
      ...input,
      id: input.id ?? crypto.randomUUID(),
      assignedEmail: normalizeEmail(input.assignedEmail),
      createdAt: new Date().toISOString()
    };
    this.db.prepare(`
      INSERT INTO employee_sessions (id, employee_id, assigned_email, token_hash, expires_at, revoked_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(session.id, session.employeeId, session.assignedEmail, session.tokenHash, session.expiresAt, session.revokedAt ?? null, session.createdAt);
    return session;
  }

  async getEmployeeSessionByTokenHash(tokenHash: string): Promise<EmployeeSessionRecord | undefined> {
    const row = this.db.prepare("SELECT * FROM employee_sessions WHERE token_hash = ?").get(tokenHash);
    return row ? employeeSessionFromRow(row) : undefined;
  }

  async updateEmployeeSession(id: string, patch: Partial<EmployeeSessionRecord>): Promise<EmployeeSessionRecord> {
    const existingRow = this.db.prepare("SELECT * FROM employee_sessions WHERE id = ?").get(id);
    if (!existingRow) throw new Error(`Unknown employee session: ${id}`);
    const existing = employeeSessionFromRow(existingRow);
    const updated = { ...existing, ...patch, assignedEmail: patch.assignedEmail ? normalizeEmail(patch.assignedEmail) : existing.assignedEmail };
    this.db.prepare(`
      UPDATE employee_sessions
      SET employee_id = ?, assigned_email = ?, token_hash = ?, expires_at = ?, revoked_at = ?, created_at = ?
      WHERE id = ?
    `).run(updated.employeeId, updated.assignedEmail, updated.tokenHash, updated.expiresAt, updated.revokedAt ?? null, updated.createdAt, id);
    return updated;
  }

  async listCredentialCatalog(query: CredentialCatalogQuery): Promise<PaginatedResult<CredentialCatalogEntry>> {
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    if (query.active !== undefined) {
      where.push("active = ?");
      params.push(query.active ? 1 : 0);
    }
    if (query.employeeId) {
      const policyClauses = ["EXISTS (SELECT 1 FROM json_each(credential_catalog.allowed_employee_ids) WHERE value = ?)"];
      params.push(query.employeeId);
      if (query.employeeTeam?.trim()) {
        policyClauses.push("EXISTS (SELECT 1 FROM json_each(credential_catalog.allowed_teams) WHERE lower(value) = lower(?))");
        params.push(query.employeeTeam.trim());
      }
      if (query.employeeRole?.trim()) {
        policyClauses.push("EXISTS (SELECT 1 FROM json_each(credential_catalog.allowed_roles) WHERE lower(value) = lower(?))");
        params.push(query.employeeRole.trim());
      }
      where.push(`(${policyClauses.join(" OR ")})`);
    }
    if (query.search?.trim()) {
      where.push("(credential_name LIKE ? OR username LIKE ? OR domain LIKE ? OR source_provider_id LIKE ? OR source_account_id LIKE ? OR tags LIKE ? OR allowed_teams LIKE ? OR allowed_roles LIKE ?)");
      const pattern = `%${query.search.trim()}%`;
      params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const page = Math.max(1, query.page);
    const pageSize = Math.min(Math.max(1, query.pageSize), 100);
    const offset = (page - 1) * pageSize;
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS count FROM credential_catalog ${whereSql}`).get(...params) as { count: number }).count);
    const rows = this.db
      .prepare(`SELECT * FROM credential_catalog ${whereSql} ORDER BY credential_name ASC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, offset)
      .map(catalogEntryFromRow);
    return { items: rows, page, pageSize, total };
  }

  async getCredentialCatalogEntry(id: string): Promise<CredentialCatalogEntry | undefined> {
    const row = this.db.prepare("SELECT * FROM credential_catalog WHERE id = ?").get(id);
    return row ? catalogEntryFromRow(row) : undefined;
  }

  async upsertCredentialCatalogEntry(input: CredentialCatalogUpsertInput): Promise<CredentialCatalogEntry> {
    const now = new Date().toISOString();
    const id = input.id ?? crypto.randomUUID();
    const active = input.active ?? true;
    const tags = uniqueStrings(input.tags ?? []);
    const allowedEmployeeIds = uniqueStrings(input.allowedEmployeeIds ?? []);
    const allowedTeams = uniqueStrings(input.allowedTeams ?? []);
    const allowedRoles = uniqueStrings(input.allowedRoles ?? []);
    const existing = this.db.prepare("SELECT * FROM credential_catalog WHERE id = ?").get(id) as CredentialCatalogRow | undefined;
    this.db.prepare(`
      INSERT INTO credential_catalog (
        id, source_provider_id, source_account_id, source_item_id, credential_name, username, domain, tags, risk_tier, allowed_employee_ids, allowed_teams, allowed_roles, auto_approval_policy, active, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_provider_id = excluded.source_provider_id,
        source_account_id = excluded.source_account_id,
        source_item_id = excluded.source_item_id,
        credential_name = excluded.credential_name,
        username = excluded.username,
        domain = excluded.domain,
        tags = excluded.tags,
        risk_tier = excluded.risk_tier,
        allowed_employee_ids = excluded.allowed_employee_ids,
        allowed_teams = excluded.allowed_teams,
        allowed_roles = excluded.allowed_roles,
        auto_approval_policy = excluded.auto_approval_policy,
        active = excluded.active,
        updated_at = excluded.updated_at
    `).run(
      id,
      input.sourceProviderId,
      input.sourceAccountId,
      input.sourceItemId,
      input.credentialName,
      input.username ?? null,
      input.domain ?? null,
      JSON.stringify(tags),
      input.riskTier,
      JSON.stringify(allowedEmployeeIds),
      JSON.stringify(allowedTeams),
      JSON.stringify(allowedRoles),
      input.autoApprovalPolicy ? JSON.stringify(input.autoApprovalPolicy) : null,
      active ? 1 : 0,
      existing?.created_at ?? now,
      now
    );
    return { ...input, id, tags, allowedEmployeeIds, allowedTeams, allowedRoles, active, createdAt: existing?.created_at ?? now, updatedAt: now };
  }

  async listCredentialAccessRequests(query: CredentialAccessRequestQuery): Promise<PaginatedResult<CredentialAccessRequestRecord>> {
    const where: string[] = [];
    const params: SQLInputValue[] = [];
    if (query.employeeId) {
      where.push("employee_id = ?");
      params.push(query.employeeId);
    }
    if (query.status) {
      where.push("status = ?");
      params.push(query.status);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const page = Math.max(1, query.page);
    const pageSize = Math.min(Math.max(1, query.pageSize), 100);
    const offset = (page - 1) * pageSize;
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS count FROM credential_access_requests ${whereSql}`).get(...params) as { count: number }).count);
    const rows = this.db
      .prepare(`SELECT * FROM credential_access_requests ${whereSql} ORDER BY requested_at DESC LIMIT ? OFFSET ?`)
      .all(...params, pageSize, offset)
      .map(accessRequestFromRow);
    return { items: rows, page, pageSize, total };
  }

  async getCredentialAccessRequest(id: string): Promise<CredentialAccessRequestRecord | undefined> {
    const row = this.db.prepare("SELECT * FROM credential_access_requests WHERE id = ?").get(id);
    return row ? accessRequestFromRow(row) : undefined;
  }

  async createCredentialAccessRequest(input: CredentialAccessRequestCreateInput): Promise<CredentialAccessRequestRecord> {
    const id = input.id ?? crypto.randomUUID();
    const requestedAt = new Date().toISOString();
    const request: CredentialAccessRequestRecord = {
      ...input,
      id,
      assignedEmail: normalizeEmail(input.assignedEmail),
      breakGlass: input.breakGlass ?? false,
      status: input.status ?? "pending",
      requestedAt,
      replacementCount: input.replacementCount ?? 0
    };
    this.db.prepare(`
      INSERT INTO credential_access_requests (
        id, employee_id, assigned_email, catalog_entry_id, source_provider_id, source_account_id, source_item_id, credential_name,
        reason, ticket_ref, expected_duration_minutes, break_glass, break_glass_justification, break_glass_confirmed_at, status, requested_at,
        decided_at, approver, decision_reason, delivery_id, delivery_provider_id, delivery_account_id, previous_delivery_id, replacement_count,
        last_replacement_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      request.id,
      request.employeeId,
      request.assignedEmail,
      request.catalogEntryId,
      request.sourceProviderId,
      request.sourceAccountId,
      request.sourceItemId,
      request.credentialName,
      request.reason,
      request.ticketRef ?? null,
      request.expectedDurationMinutes ?? null,
      request.breakGlass ? 1 : 0,
      request.breakGlassJustification ?? null,
      request.breakGlassConfirmedAt ?? null,
      request.status,
      request.requestedAt,
      request.decidedAt ?? null,
      request.approver ?? null,
      request.decisionReason ?? null,
      request.deliveryId ?? null,
      request.deliveryProviderId ?? null,
      request.deliveryAccountId ?? null,
      request.previousDeliveryId ?? null,
      request.replacementCount ?? 0,
      request.lastReplacementAt ?? null
    );
    return request;
  }

  async updateCredentialAccessRequest(id: string, patch: Partial<CredentialAccessRequestRecord>): Promise<CredentialAccessRequestRecord> {
    const existing = await this.getCredentialAccessRequest(id);
    if (!existing) throw new Error(`Unknown credential access request: ${id}`);
    const updated = { ...existing, ...patch, assignedEmail: patch.assignedEmail ? normalizeEmail(patch.assignedEmail) : existing.assignedEmail };
    this.db.prepare(`
      UPDATE credential_access_requests SET
        employee_id = ?, assigned_email = ?, catalog_entry_id = ?, source_provider_id = ?, source_account_id = ?, source_item_id = ?, credential_name = ?,
        reason = ?, ticket_ref = ?, expected_duration_minutes = ?, break_glass = ?, break_glass_justification = ?, break_glass_confirmed_at = ?,
        status = ?, requested_at = ?, decided_at = ?, approver = ?, decision_reason = ?, delivery_id = ?, delivery_provider_id = ?,
        delivery_account_id = ?, previous_delivery_id = ?, replacement_count = ?, last_replacement_at = ?
      WHERE id = ?
    `).run(
      updated.employeeId,
      updated.assignedEmail,
      updated.catalogEntryId,
      updated.sourceProviderId,
      updated.sourceAccountId,
      updated.sourceItemId,
      updated.credentialName,
      updated.reason,
      updated.ticketRef ?? null,
      updated.expectedDurationMinutes ?? null,
      updated.breakGlass ? 1 : 0,
      updated.breakGlassJustification ?? null,
      updated.breakGlassConfirmedAt ?? null,
      updated.status,
      updated.requestedAt,
      updated.decidedAt ?? null,
      updated.approver ?? null,
      updated.decisionReason ?? null,
      updated.deliveryId ?? null,
      updated.deliveryProviderId ?? null,
      updated.deliveryAccountId ?? null,
      updated.previousDeliveryId ?? null,
      updated.replacementCount ?? 0,
      updated.lastReplacementAt ?? null,
      id
    );
    return updated;
  }

  async createDelivery(record: Omit<DeliveryRecord, "id" | "createdAt"> & { id?: string }): Promise<DeliveryRecord> {
    const id = record.id ?? crypto.randomUUID();
    const createdAt = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO deliveries (
        id, operation_id, operation_fingerprint, policy_snapshot, provider_delivery_id, source_provider_id, source_account_id, source_item_id, delivery_provider_id,
        delivery_account_id, credential_name, person_id, batch_id, delivery_method, created_at, expires_at,
        view_limit, access_count, status, revoked_at, first_viewed_at, last_checked_at,
        delivery_access_code_required, delivery_access_code_issued_at, delivery_access_code_observed_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      record.operationId ?? null,
      record.operationFingerprint ?? null,
      record.policySnapshot ? JSON.stringify(record.policySnapshot) : null,
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
      record.firstViewedAt ?? null,
      record.lastCheckedAt ?? null,
      record.deliveryAccessCodeRequired ? 1 : 0,
      record.deliveryAccessCodeIssuedAt ?? null,
      record.deliveryAccessCodeObservedAt ?? null
    );
    return { ...record, id, createdAt };
  }

  async getDelivery(id: string): Promise<DeliveryRecord | undefined> {
    const row = this.db.prepare("SELECT * FROM deliveries WHERE id = ?").get(id);
    return row ? deliveryFromRow(row) : undefined;
  }

  async getDeliveryByOperationId(operationId: string): Promise<DeliveryRecord | undefined> {
    const row = this.db.prepare("SELECT * FROM deliveries WHERE operation_id = ?").get(operationId);
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
        operation_id = ?, operation_fingerprint = ?, policy_snapshot = ?, provider_delivery_id = ?, expires_at = ?, access_count = ?, status = ?, revoked_at = ?, first_viewed_at = ?, last_checked_at = ?,
        delivery_access_code_required = ?, delivery_access_code_issued_at = ?, delivery_access_code_observed_at = ?
      WHERE id = ?
    `).run(
      updated.operationId ?? null,
      updated.operationFingerprint ?? null,
      updated.policySnapshot ? JSON.stringify(updated.policySnapshot) : null,
      updated.providerDeliveryId ?? null,
      updated.expiresAt,
      updated.accessCount ?? null,
      updated.status,
      updated.revokedAt ?? null,
      updated.firstViewedAt ?? null,
      updated.lastCheckedAt ?? null,
      updated.deliveryAccessCodeRequired ? 1 : 0,
      updated.deliveryAccessCodeIssuedAt ?? null,
      updated.deliveryAccessCodeObservedAt ?? null,
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

  async pruneAuditLogBefore(cutoffIso: string): Promise<number> {
    const result = this.db.prepare("DELETE FROM audit_log WHERE created_at < ?").run(cutoffIso);
    return Number(result.changes);
  }

  async pruneExpiredEmployeeSignInCodes(cutoffIso: string): Promise<number> {
    const result = this.db.prepare("DELETE FROM employee_sign_in_codes WHERE expires_at < ?").run(cutoffIso);
    return Number(result.changes);
  }

  async pruneExpiredEmployeeSessions(cutoffIso: string): Promise<number> {
    const result = this.db
      .prepare("DELETE FROM employee_sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)")
      .run(cutoffIso, cutoffIso);
    return Number(result.changes);
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

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

interface AccountRow {
  id: string;
  provider_id: string;
  label: string;
  username: string | null;
  server_url: string | null;
  provider_principal_id: string | null;
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

interface EmployeeRow {
  id: string;
  person_id: string | null;
  name: string;
  assigned_email: string;
  team: string | null;
  role: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

interface EmployeeSignInCodeRow {
  id: string;
  employee_id: string;
  assigned_email: string;
  code_hash: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

interface EmployeeSessionRow {
  id: string;
  employee_id: string;
  assigned_email: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

interface CredentialCatalogRow {
  id: string;
  source_provider_id: string;
  source_account_id: string;
  source_item_id: string;
  credential_name: string;
  username: string | null;
  domain: string | null;
  tags: string;
  risk_tier: CredentialCatalogEntry["riskTier"];
  allowed_employee_ids: string;
  allowed_teams: string;
  allowed_roles: string;
  auto_approval_policy: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

interface AccessRequestRow {
  id: string;
  employee_id: string;
  assigned_email: string;
  catalog_entry_id: string;
  source_provider_id: string;
  source_account_id: string;
  source_item_id: string;
  credential_name: string;
  reason: string;
  ticket_ref: string | null;
  expected_duration_minutes: number | null;
  break_glass: number;
  break_glass_justification: string | null;
  break_glass_confirmed_at: string | null;
  status: CredentialAccessRequestRecord["status"];
  requested_at: string;
  decided_at: string | null;
  approver: string | null;
  decision_reason: string | null;
  delivery_id: string | null;
  delivery_provider_id: string | null;
  delivery_account_id: string | null;
  previous_delivery_id: string | null;
  replacement_count: number;
  last_replacement_at: string | null;
}

interface DeliveryRow {
  id: string;
  operation_id: string | null;
  operation_fingerprint: string | null;
  policy_snapshot: string | null;
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
  first_viewed_at: string | null;
  last_checked_at: string | null;
  delivery_access_code_required: number;
  delivery_access_code_issued_at: string | null;
  delivery_access_code_observed_at: string | null;
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
    providerPrincipalId: item.provider_principal_id ?? undefined,
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

function employeeFromRow(row: unknown): EmployeeRecord {
  const item = row as EmployeeRow;
  return {
    id: item.id,
    personId: item.person_id ?? undefined,
    name: item.name,
    assignedEmail: item.assigned_email,
    team: item.team ?? undefined,
    role: item.role ?? undefined,
    active: item.active === 1,
    createdAt: item.created_at,
    updatedAt: item.updated_at
  };
}

function employeeSignInCodeFromRow(row: unknown): EmployeeSignInCodeRecord {
  const item = row as EmployeeSignInCodeRow;
  return {
    id: item.id,
    employeeId: item.employee_id,
    assignedEmail: item.assigned_email,
    codeHash: item.code_hash,
    expiresAt: item.expires_at,
    usedAt: item.used_at ?? undefined,
    createdAt: item.created_at
  };
}

function employeeSessionFromRow(row: unknown): EmployeeSessionRecord {
  const item = row as EmployeeSessionRow;
  return {
    id: item.id,
    employeeId: item.employee_id,
    assignedEmail: item.assigned_email,
    tokenHash: item.token_hash,
    expiresAt: item.expires_at,
    revokedAt: item.revoked_at ?? undefined,
    createdAt: item.created_at
  };
}

function catalogEntryFromRow(row: unknown): CredentialCatalogEntry {
  const item = row as CredentialCatalogRow;
  return {
    id: item.id,
    sourceProviderId: item.source_provider_id,
    sourceAccountId: item.source_account_id,
    sourceItemId: item.source_item_id,
    credentialName: item.credential_name,
    username: item.username ?? undefined,
    domain: item.domain ?? undefined,
    tags: jsonStringArray(item.tags),
    riskTier: item.risk_tier,
    allowedEmployeeIds: jsonStringArray(item.allowed_employee_ids),
    allowedTeams: jsonStringArray(item.allowed_teams),
    allowedRoles: jsonStringArray(item.allowed_roles),
    autoApprovalPolicy: autoApprovalPolicyFromRow(item.auto_approval_policy),
    active: item.active === 1,
    createdAt: item.created_at,
    updatedAt: item.updated_at
  };
}

function accessRequestFromRow(row: unknown): CredentialAccessRequestRecord {
  const item = row as AccessRequestRow;
  return {
    id: item.id,
    employeeId: item.employee_id,
    assignedEmail: item.assigned_email,
    catalogEntryId: item.catalog_entry_id,
    sourceProviderId: item.source_provider_id,
    sourceAccountId: item.source_account_id,
    sourceItemId: item.source_item_id,
    credentialName: item.credential_name,
    reason: item.reason,
    ticketRef: item.ticket_ref ?? undefined,
    expectedDurationMinutes: item.expected_duration_minutes ?? undefined,
    breakGlass: item.break_glass === 1,
    breakGlassJustification: item.break_glass_justification ?? undefined,
    breakGlassConfirmedAt: item.break_glass_confirmed_at ?? undefined,
    status: item.status,
    requestedAt: item.requested_at,
    decidedAt: item.decided_at ?? undefined,
    approver: item.approver ?? undefined,
    decisionReason: item.decision_reason ?? undefined,
    deliveryId: item.delivery_id ?? undefined,
    deliveryProviderId: item.delivery_provider_id ?? undefined,
    deliveryAccountId: item.delivery_account_id ?? undefined,
    previousDeliveryId: item.previous_delivery_id ?? undefined,
    replacementCount: item.replacement_count ?? 0,
    lastReplacementAt: item.last_replacement_at ?? undefined
  };
}

function deliveryFromRow(row: unknown): DeliveryRecord {
  const item = row as DeliveryRow;
  return {
    id: item.id,
    operationId: item.operation_id ?? undefined,
    operationFingerprint: item.operation_fingerprint ?? undefined,
    policySnapshot: policySnapshotFromRow(item.policy_snapshot),
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
    firstViewedAt: item.first_viewed_at ?? undefined,
    lastCheckedAt: item.last_checked_at ?? undefined,
    deliveryAccessCodeRequired: item.delivery_access_code_required === 1,
    deliveryAccessCodeIssuedAt: item.delivery_access_code_issued_at ?? undefined,
    deliveryAccessCodeObservedAt: item.delivery_access_code_observed_at ?? undefined
  };
}

function policySnapshotFromRow(value: string | null): DeliveryPolicySnapshot | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as DeliveryPolicySnapshot;
  } catch {
    return undefined;
  }
}

function jsonStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function autoApprovalPolicyFromRow(value: string | null): CredentialCatalogEntry["autoApprovalPolicy"] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as CredentialCatalogEntry["autoApprovalPolicy"];
    if (!parsed || typeof parsed !== "object") return undefined;
    return parsed;
  } catch {
    return undefined;
  }
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
