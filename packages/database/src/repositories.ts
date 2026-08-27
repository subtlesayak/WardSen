import { nanoid } from "nanoid";
import type {
  AccountRecord,
  AuditLogRecord,
  CredentialAccessRequestRecord,
  CredentialCatalogEntry,
  DeliveryBatchRecord,
  DeliveryRecord,
  EmployeeRecord,
  EmployeeSessionRecord,
  EmployeeSignInCodeRecord,
  PaginatedResult,
  PaginationInput,
  PersonRecord
} from "@wardsen/core";

export interface PeopleQuery extends PaginationInput {
  search?: string;
  groupName?: string;
  active?: boolean;
  sortBy?: "name" | "groupName" | "createdAt";
  sortDirection?: "asc" | "desc";
}

export interface DeliveryQuery extends PaginationInput {
  batchId?: string;
}

export interface EmployeeQuery extends PaginationInput {
  active?: boolean;
  search?: string;
}

export interface CredentialCatalogQuery extends PaginationInput {
  active?: boolean;
  employeeId?: string;
  employeeTeam?: string;
  employeeRole?: string;
  search?: string;
}

export interface CredentialAccessRequestQuery extends PaginationInput {
  employeeId?: string;
  status?: CredentialAccessRequestRecord["status"];
}

export type PersonUpsertInput = Omit<PersonRecord, "id" | "createdAt" | "updatedAt" | "active"> & {
  id?: string;
  active?: boolean;
};

export type EmployeeUpsertInput = Omit<EmployeeRecord, "id" | "createdAt" | "updatedAt" | "active"> & {
  id?: string;
  active?: boolean;
};

export type EmployeeSignInCodeCreateInput = Omit<EmployeeSignInCodeRecord, "id" | "createdAt" | "usedAt"> & {
  id?: string;
  usedAt?: string;
};

export type EmployeeSessionCreateInput = Omit<EmployeeSessionRecord, "id" | "createdAt" | "revokedAt"> & {
  id?: string;
  revokedAt?: string;
};

export type CredentialCatalogUpsertInput = Omit<CredentialCatalogEntry, "id" | "createdAt" | "updatedAt" | "active" | "tags" | "allowedEmployeeIds" | "allowedTeams" | "allowedRoles" | "autoApprovalPolicy"> & {
  id?: string;
  tags?: string[];
  allowedEmployeeIds?: string[];
  allowedTeams?: string[];
  allowedRoles?: string[];
  autoApprovalPolicy?: CredentialCatalogEntry["autoApprovalPolicy"];
  active?: boolean;
};

export type CredentialAccessRequestCreateInput = Omit<CredentialAccessRequestRecord, "id" | "requestedAt" | "status" | "decidedAt" | "approver" | "decisionReason" | "deliveryId" | "deliveryProviderId" | "deliveryAccountId" | "breakGlass" | "breakGlassJustification" | "breakGlassConfirmedAt"> & {
  id?: string;
  status?: CredentialAccessRequestRecord["status"];
  breakGlass?: boolean;
  breakGlassJustification?: string;
  breakGlassConfirmedAt?: string;
};

export interface WardSenRepository {
  listAccounts(): Promise<AccountRecord[]>;
  upsertAccount(input: Omit<AccountRecord, "createdAt" | "updatedAt" | "status"> & { status?: AccountRecord["status"] }): Promise<AccountRecord>;
  deleteAccount(id: string): Promise<void>;
  getLocalSetting(key: string): Promise<string | undefined>;
  setLocalSetting(key: string, value: string): Promise<void>;
  listPeople(query: PeopleQuery): Promise<PaginatedResult<PersonRecord>>;
  getPerson(id: string): Promise<PersonRecord | undefined>;
  upsertPerson(input: PersonUpsertInput): Promise<PersonRecord>;
  archivePerson(id: string): Promise<void>;
  restorePerson(id: string): Promise<void>;
  deletePerson(id: string): Promise<void>;
  findDuplicatePeople(input: { email?: string; phone?: string }): Promise<PersonRecord[]>;
  listEmployees(query: EmployeeQuery): Promise<PaginatedResult<EmployeeRecord>>;
  getEmployee(id: string): Promise<EmployeeRecord | undefined>;
  getEmployeeByAssignedEmail(assignedEmail: string): Promise<EmployeeRecord | undefined>;
  upsertEmployee(input: EmployeeUpsertInput): Promise<EmployeeRecord>;
  createEmployeeSignInCode(input: EmployeeSignInCodeCreateInput): Promise<EmployeeSignInCodeRecord>;
  getEmployeeSignInCodeByHash(employeeId: string, codeHash: string): Promise<EmployeeSignInCodeRecord | undefined>;
  updateEmployeeSignInCode(id: string, patch: Partial<EmployeeSignInCodeRecord>): Promise<EmployeeSignInCodeRecord>;
  createEmployeeSession(input: EmployeeSessionCreateInput): Promise<EmployeeSessionRecord>;
  getEmployeeSessionByTokenHash(tokenHash: string): Promise<EmployeeSessionRecord | undefined>;
  updateEmployeeSession(id: string, patch: Partial<EmployeeSessionRecord>): Promise<EmployeeSessionRecord>;
  listCredentialCatalog(query: CredentialCatalogQuery): Promise<PaginatedResult<CredentialCatalogEntry>>;
  getCredentialCatalogEntry(id: string): Promise<CredentialCatalogEntry | undefined>;
  upsertCredentialCatalogEntry(input: CredentialCatalogUpsertInput): Promise<CredentialCatalogEntry>;
  listCredentialAccessRequests(query: CredentialAccessRequestQuery): Promise<PaginatedResult<CredentialAccessRequestRecord>>;
  getCredentialAccessRequest(id: string): Promise<CredentialAccessRequestRecord | undefined>;
  createCredentialAccessRequest(input: CredentialAccessRequestCreateInput): Promise<CredentialAccessRequestRecord>;
  updateCredentialAccessRequest(id: string, patch: Partial<CredentialAccessRequestRecord>): Promise<CredentialAccessRequestRecord>;
  createDelivery(record: Omit<DeliveryRecord, "id" | "createdAt"> & { id?: string }): Promise<DeliveryRecord>;
  getDelivery(id: string): Promise<DeliveryRecord | undefined>;
  getDeliveryByOperationId(operationId: string): Promise<DeliveryRecord | undefined>;
  listDeliveries(query: DeliveryQuery): Promise<PaginatedResult<DeliveryRecord>>;
  updateDelivery(id: string, patch: Partial<DeliveryRecord>): Promise<DeliveryRecord>;
  createBatch(record: Omit<DeliveryBatchRecord, "createdAt" | "completedAt"> & { completedAt?: string }): Promise<DeliveryBatchRecord>;
  getBatch(id: string): Promise<DeliveryBatchRecord | undefined>;
  listBatches(query: PaginationInput): Promise<PaginatedResult<DeliveryBatchRecord>>;
  updateBatch(id: string, patch: Partial<DeliveryBatchRecord>): Promise<DeliveryBatchRecord>;
  appendAuditLog(record: Omit<AuditLogRecord, "id" | "createdAt"> & { id?: string }): Promise<AuditLogRecord>;
  listAuditLog(query: PaginationInput): Promise<PaginatedResult<AuditLogRecord>>;
  pruneAuditLogBefore(cutoffIso: string): Promise<number>;
  pruneExpiredEmployeeSignInCodes(cutoffIso: string): Promise<number>;
  pruneExpiredEmployeeSessions(cutoffIso: string): Promise<number>;
}

export class InMemoryWardSenRepository implements WardSenRepository {
  private readonly accounts = new Map<string, AccountRecord>();
  private readonly localSettings = new Map<string, string>();
  private readonly people = new Map<string, PersonRecord>();
  private readonly employees = new Map<string, EmployeeRecord>();
  private readonly employeeSignInCodes = new Map<string, EmployeeSignInCodeRecord>();
  private readonly employeeSessions = new Map<string, EmployeeSessionRecord>();
  private readonly catalog = new Map<string, CredentialCatalogEntry>();
  private readonly accessRequests = new Map<string, CredentialAccessRequestRecord>();
  private readonly deliveries = new Map<string, DeliveryRecord>();
  private readonly batches = new Map<string, DeliveryBatchRecord>();
  private readonly auditLog = new Map<string, AuditLogRecord>();

  async listAccounts(): Promise<AccountRecord[]> {
    return [...this.accounts.values()];
  }

  async upsertAccount(input: Omit<AccountRecord, "createdAt" | "updatedAt" | "status"> & { status?: AccountRecord["status"] }): Promise<AccountRecord> {
    const now = new Date().toISOString();
    const existing = this.accounts.get(input.id);
    const account: AccountRecord = {
      ...input,
      providerPrincipalId: input.providerPrincipalId ?? existing?.providerPrincipalId,
      status: input.status ?? existing?.status ?? "locked",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    this.accounts.set(account.id, account);
    return account;
  }

  async deleteAccount(id: string): Promise<void> {
    this.accounts.delete(id);
  }

  async getLocalSetting(key: string): Promise<string | undefined> {
    return this.localSettings.get(key);
  }

  async setLocalSetting(key: string, value: string): Promise<void> {
    this.localSettings.set(key, value);
  }

  async listPeople(query: PeopleQuery): Promise<PaginatedResult<PersonRecord>> {
    const normalizedSearch = query.search?.trim().toLowerCase();
    let rows = [...this.people.values()].filter((person) => {
      if (query.active !== undefined && person.active !== query.active) return false;
      if (query.groupName && person.groupName !== query.groupName) return false;
      if (!normalizedSearch) return true;
      return [person.name, person.email, person.phone, person.groupName, person.role]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalizedSearch));
    });
    const sortBy = query.sortBy ?? "name";
    const direction = query.sortDirection === "desc" ? -1 : 1;
    rows = rows.sort((a, b) => String(a[sortBy] ?? "").localeCompare(String(b[sortBy] ?? "")) * direction);
    const page = Math.max(1, query.page);
    const pageSize = Math.min(Math.max(1, query.pageSize), 100);
    const start = (page - 1) * pageSize;
    return { items: rows.slice(start, start + pageSize), page, pageSize, total: rows.length };
  }

  async getPerson(id: string): Promise<PersonRecord | undefined> {
    return this.people.get(id);
  }

  async upsertPerson(input: PersonUpsertInput): Promise<PersonRecord> {
    const now = new Date().toISOString();
    const id = input.id ?? nanoid();
    const existing = this.people.get(id);
    const person: PersonRecord = {
      ...input,
      id,
      active: input.active ?? true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    this.people.set(id, person);
    return person;
  }

  async archivePerson(id: string): Promise<void> {
    const person = this.people.get(id);
    if (!person) return;
    this.people.set(id, { ...person, active: false, updatedAt: new Date().toISOString() });
  }

  async restorePerson(id: string): Promise<void> {
    const person = this.people.get(id);
    if (!person) return;
    this.people.set(id, { ...person, active: true, updatedAt: new Date().toISOString() });
  }

  async deletePerson(id: string): Promise<void> {
    this.people.delete(id);
  }

  async findDuplicatePeople(input: { email?: string; phone?: string }): Promise<PersonRecord[]> {
    return [...this.people.values()].filter((person) => {
      return Boolean((input.email && person.email === input.email) || (input.phone && person.phone === input.phone));
    });
  }

  async listEmployees(query: EmployeeQuery): Promise<PaginatedResult<EmployeeRecord>> {
    const normalizedSearch = query.search?.trim().toLowerCase();
    const rows = [...this.employees.values()]
      .filter((employee) => query.active === undefined || employee.active === query.active)
      .filter((employee) => {
        if (!normalizedSearch) return true;
        return [employee.name, employee.assignedEmail, employee.team, employee.role, employee.personId]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(normalizedSearch));
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    return paginate(rows, query);
  }

  async getEmployee(id: string): Promise<EmployeeRecord | undefined> {
    return this.employees.get(id);
  }

  async getEmployeeByAssignedEmail(assignedEmail: string): Promise<EmployeeRecord | undefined> {
    const normalizedEmail = normalizeEmail(assignedEmail);
    return [...this.employees.values()].find((employee) => employee.assignedEmail === normalizedEmail);
  }

  async upsertEmployee(input: EmployeeUpsertInput): Promise<EmployeeRecord> {
    const now = new Date().toISOString();
    const id = input.id ?? nanoid();
    const existing = this.employees.get(id);
    const employee: EmployeeRecord = {
      ...input,
      id,
      personId: input.personId,
      assignedEmail: normalizeEmail(input.assignedEmail),
      active: input.active ?? true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    const duplicateEmail = [...this.employees.values()].find((item) => item.id !== id && item.assignedEmail === employee.assignedEmail);
    if (duplicateEmail) throw new Error(`Duplicate employee assigned email: ${employee.assignedEmail}`);
    const duplicatePerson = employee.personId
      ? [...this.employees.values()].find((item) => item.id !== id && item.personId === employee.personId)
      : undefined;
    if (duplicatePerson) throw new Error(`Duplicate employee person link: ${employee.personId}`);
    this.employees.set(employee.id, employee);
    return employee;
  }

  async createEmployeeSignInCode(input: EmployeeSignInCodeCreateInput): Promise<EmployeeSignInCodeRecord> {
    const code: EmployeeSignInCodeRecord = {
      ...input,
      id: input.id ?? nanoid(),
      assignedEmail: normalizeEmail(input.assignedEmail),
      createdAt: new Date().toISOString()
    };
    this.employeeSignInCodes.set(code.id, code);
    return code;
  }

  async getEmployeeSignInCodeByHash(employeeId: string, codeHash: string): Promise<EmployeeSignInCodeRecord | undefined> {
    return [...this.employeeSignInCodes.values()].find((code) => code.employeeId === employeeId && code.codeHash === codeHash);
  }

  async updateEmployeeSignInCode(id: string, patch: Partial<EmployeeSignInCodeRecord>): Promise<EmployeeSignInCodeRecord> {
    const existing = this.employeeSignInCodes.get(id);
    if (!existing) throw new Error(`Unknown employee sign-in code: ${id}`);
    const updated = { ...existing, ...patch, assignedEmail: patch.assignedEmail ? normalizeEmail(patch.assignedEmail) : existing.assignedEmail };
    this.employeeSignInCodes.set(id, updated);
    return updated;
  }

  async createEmployeeSession(input: EmployeeSessionCreateInput): Promise<EmployeeSessionRecord> {
    const session: EmployeeSessionRecord = {
      ...input,
      id: input.id ?? nanoid(),
      assignedEmail: normalizeEmail(input.assignedEmail),
      createdAt: new Date().toISOString()
    };
    this.employeeSessions.set(session.id, session);
    return session;
  }

  async getEmployeeSessionByTokenHash(tokenHash: string): Promise<EmployeeSessionRecord | undefined> {
    return [...this.employeeSessions.values()].find((session) => session.tokenHash === tokenHash);
  }

  async updateEmployeeSession(id: string, patch: Partial<EmployeeSessionRecord>): Promise<EmployeeSessionRecord> {
    const existing = this.employeeSessions.get(id);
    if (!existing) throw new Error(`Unknown employee session: ${id}`);
    const updated = { ...existing, ...patch, assignedEmail: patch.assignedEmail ? normalizeEmail(patch.assignedEmail) : existing.assignedEmail };
    this.employeeSessions.set(id, updated);
    return updated;
  }

  async listCredentialCatalog(query: CredentialCatalogQuery): Promise<PaginatedResult<CredentialCatalogEntry>> {
    const normalizedSearch = query.search?.trim().toLowerCase();
    const rows = [...this.catalog.values()]
      .filter((entry) => query.active === undefined || entry.active === query.active)
      .filter((entry) => !query.employeeId || catalogEntryAllowsEmployee(entry, {
        id: query.employeeId,
        team: query.employeeTeam,
        role: query.employeeRole
      }))
      .filter((entry) => {
        if (!normalizedSearch) return true;
        return [entry.credentialName, entry.username, entry.domain, entry.sourceProviderId, entry.sourceAccountId, ...entry.tags, ...entry.allowedTeams, ...entry.allowedRoles]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(normalizedSearch));
      })
      .sort((a, b) => a.credentialName.localeCompare(b.credentialName));
    return paginate(rows, query);
  }

  async getCredentialCatalogEntry(id: string): Promise<CredentialCatalogEntry | undefined> {
    return this.catalog.get(id);
  }

  async upsertCredentialCatalogEntry(input: CredentialCatalogUpsertInput): Promise<CredentialCatalogEntry> {
    const now = new Date().toISOString();
    const id = input.id ?? nanoid();
    const existing = this.catalog.get(id);
    const entry: CredentialCatalogEntry = {
      ...input,
      id,
      tags: uniqueStrings(input.tags ?? []),
      allowedEmployeeIds: uniqueStrings(input.allowedEmployeeIds ?? []),
      allowedTeams: uniqueStrings(input.allowedTeams ?? []),
      allowedRoles: uniqueStrings(input.allowedRoles ?? []),
      autoApprovalPolicy: input.autoApprovalPolicy,
      active: input.active ?? true,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    this.catalog.set(entry.id, entry);
    return entry;
  }

  async listCredentialAccessRequests(query: CredentialAccessRequestQuery): Promise<PaginatedResult<CredentialAccessRequestRecord>> {
    const rows = [...this.accessRequests.values()]
      .filter((request) => !query.employeeId || request.employeeId === query.employeeId)
      .filter((request) => !query.status || request.status === query.status)
      .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
    return paginate(rows, query);
  }

  async getCredentialAccessRequest(id: string): Promise<CredentialAccessRequestRecord | undefined> {
    return this.accessRequests.get(id);
  }

  async createCredentialAccessRequest(input: CredentialAccessRequestCreateInput): Promise<CredentialAccessRequestRecord> {
    const request: CredentialAccessRequestRecord = {
      ...input,
      id: input.id ?? nanoid(),
      assignedEmail: normalizeEmail(input.assignedEmail),
      breakGlass: input.breakGlass ?? false,
      status: input.status ?? "pending",
      requestedAt: new Date().toISOString(),
      replacementCount: input.replacementCount ?? 0
    };
    this.accessRequests.set(request.id, request);
    return request;
  }

  async updateCredentialAccessRequest(id: string, patch: Partial<CredentialAccessRequestRecord>): Promise<CredentialAccessRequestRecord> {
    const existing = this.accessRequests.get(id);
    if (!existing) throw new Error(`Unknown credential access request: ${id}`);
    const updated = { ...existing, ...patch, assignedEmail: patch.assignedEmail ? normalizeEmail(patch.assignedEmail) : existing.assignedEmail };
    this.accessRequests.set(id, updated);
    return updated;
  }

  async createDelivery(record: Omit<DeliveryRecord, "id" | "createdAt"> & { id?: string }): Promise<DeliveryRecord> {
    const delivery: DeliveryRecord = {
      ...record,
      id: record.id ?? nanoid(),
      createdAt: new Date().toISOString()
    };
    if (this.deliveries.has(delivery.id)) {
      throw new Error(`Duplicate delivery id: ${delivery.id}`);
    }
    if (delivery.operationId && [...this.deliveries.values()].some((item) => item.operationId === delivery.operationId)) {
      throw new Error(`Duplicate delivery operation id: ${delivery.operationId}`);
    }
    this.deliveries.set(delivery.id, delivery);
    return delivery;
  }

  async getDelivery(id: string): Promise<DeliveryRecord | undefined> {
    return this.deliveries.get(id);
  }

  async getDeliveryByOperationId(operationId: string): Promise<DeliveryRecord | undefined> {
    return [...this.deliveries.values()].find((delivery) => delivery.operationId === operationId);
  }

  async listDeliveries(query: DeliveryQuery): Promise<PaginatedResult<DeliveryRecord>> {
    const rows = [...this.deliveries.values()]
      .filter((delivery) => !query.batchId || delivery.batchId === query.batchId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const page = Math.max(1, query.page);
    const pageSize = Math.min(Math.max(1, query.pageSize), 100);
    const start = (page - 1) * pageSize;
    return { items: rows.slice(start, start + pageSize), page, pageSize, total: rows.length };
  }

  async updateDelivery(id: string, patch: Partial<DeliveryRecord>): Promise<DeliveryRecord> {
    const existing = this.deliveries.get(id);
    if (!existing) throw new Error(`Unknown delivery: ${id}`);
    const updated = { ...existing, ...patch };
    this.deliveries.set(id, updated);
    return updated;
  }

  async createBatch(record: Omit<DeliveryBatchRecord, "createdAt" | "completedAt"> & { completedAt?: string }): Promise<DeliveryBatchRecord> {
    const batch: DeliveryBatchRecord = { ...record, createdAt: new Date().toISOString() };
    this.batches.set(batch.id, batch);
    return batch;
  }

  async getBatch(id: string): Promise<DeliveryBatchRecord | undefined> {
    return this.batches.get(id);
  }

  async listBatches(query: PaginationInput): Promise<PaginatedResult<DeliveryBatchRecord>> {
    const rows = [...this.batches.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    const page = Math.max(1, query.page);
    const pageSize = Math.min(Math.max(1, query.pageSize), 100);
    const start = (page - 1) * pageSize;
    return { items: rows.slice(start, start + pageSize), page, pageSize, total: rows.length };
  }

  async updateBatch(id: string, patch: Partial<DeliveryBatchRecord>): Promise<DeliveryBatchRecord> {
    const existing = this.batches.get(id);
    if (!existing) throw new Error(`Unknown batch: ${id}`);
    const updated = { ...existing, ...patch };
    this.batches.set(id, updated);
    return updated;
  }

  async appendAuditLog(record: Omit<AuditLogRecord, "id" | "createdAt"> & { id?: string }): Promise<AuditLogRecord> {
    const audit: AuditLogRecord = { ...record, id: record.id ?? nanoid(), createdAt: new Date().toISOString() };
    this.auditLog.set(audit.id, audit);
    return audit;
  }

  async listAuditLog(query: PaginationInput): Promise<PaginatedResult<AuditLogRecord>> {
    const rows = [...this.auditLog.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const page = Math.max(1, query.page);
    const pageSize = Math.min(Math.max(1, query.pageSize), 100);
    const start = (page - 1) * pageSize;
    return { items: rows.slice(start, start + pageSize), page, pageSize, total: rows.length };
  }

  async pruneAuditLogBefore(cutoffIso: string): Promise<number> {
    const before = this.auditLog.size;
    for (const [id, item] of this.auditLog) {
      if (item.createdAt < cutoffIso) this.auditLog.delete(id);
    }
    return before - this.auditLog.size;
  }

  async pruneExpiredEmployeeSignInCodes(cutoffIso: string): Promise<number> {
    const before = this.employeeSignInCodes.size;
    for (const [id, item] of this.employeeSignInCodes) {
      if (item.expiresAt < cutoffIso) this.employeeSignInCodes.delete(id);
    }
    return before - this.employeeSignInCodes.size;
  }

  async pruneExpiredEmployeeSessions(cutoffIso: string): Promise<number> {
    const before = this.employeeSessions.size;
    for (const [id, item] of this.employeeSessions) {
      if (item.expiresAt < cutoffIso || (item.revokedAt !== undefined && item.revokedAt < cutoffIso)) {
        this.employeeSessions.delete(id);
      }
    }
    return before - this.employeeSessions.size;
  }
}

function paginate<T>(rows: T[], query: PaginationInput): PaginatedResult<T> {
  const page = Math.max(1, query.page);
  const pageSize = Math.min(Math.max(1, query.pageSize), 100);
  const start = (page - 1) * pageSize;
  return { items: rows.slice(start, start + pageSize), page, pageSize, total: rows.length };
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function catalogEntryAllowsEmployee(entry: CredentialCatalogEntry, employee: { id: string; team?: string; role?: string }): boolean {
  const team = employee.team?.trim().toLowerCase();
  const role = employee.role?.trim().toLowerCase();
  return entry.allowedEmployeeIds.includes(employee.id)
    || Boolean(team && entry.allowedTeams.some((candidate) => candidate.trim().toLowerCase() === team))
    || Boolean(role && entry.allowedRoles.some((candidate) => candidate.trim().toLowerCase() === role));
}
