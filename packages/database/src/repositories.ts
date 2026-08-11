import { nanoid } from "nanoid";
import type { AccountRecord, AuditLogRecord, DeliveryBatchRecord, DeliveryRecord, PaginatedResult, PaginationInput, PersonRecord } from "@wardsen/core";

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

export type PersonUpsertInput = Omit<PersonRecord, "id" | "createdAt" | "updatedAt" | "active"> & {
  id?: string;
  active?: boolean;
};

export interface WardSenRepository {
  listAccounts(): Promise<AccountRecord[]>;
  upsertAccount(input: Omit<AccountRecord, "createdAt" | "updatedAt" | "status"> & { status?: AccountRecord["status"] }): Promise<AccountRecord>;
  deleteAccount(id: string): Promise<void>;
  listPeople(query: PeopleQuery): Promise<PaginatedResult<PersonRecord>>;
  getPerson(id: string): Promise<PersonRecord | undefined>;
  upsertPerson(input: PersonUpsertInput): Promise<PersonRecord>;
  archivePerson(id: string): Promise<void>;
  restorePerson(id: string): Promise<void>;
  deletePerson(id: string): Promise<void>;
  findDuplicatePeople(input: { email?: string; phone?: string }): Promise<PersonRecord[]>;
  createDelivery(record: Omit<DeliveryRecord, "id" | "createdAt"> & { id?: string }): Promise<DeliveryRecord>;
  getDelivery(id: string): Promise<DeliveryRecord | undefined>;
  listDeliveries(query: DeliveryQuery): Promise<PaginatedResult<DeliveryRecord>>;
  updateDelivery(id: string, patch: Partial<DeliveryRecord>): Promise<DeliveryRecord>;
  createBatch(record: Omit<DeliveryBatchRecord, "createdAt" | "completedAt"> & { completedAt?: string }): Promise<DeliveryBatchRecord>;
  getBatch(id: string): Promise<DeliveryBatchRecord | undefined>;
  listBatches(query: PaginationInput): Promise<PaginatedResult<DeliveryBatchRecord>>;
  updateBatch(id: string, patch: Partial<DeliveryBatchRecord>): Promise<DeliveryBatchRecord>;
  appendAuditLog(record: Omit<AuditLogRecord, "id" | "createdAt"> & { id?: string }): Promise<AuditLogRecord>;
  listAuditLog(query: PaginationInput): Promise<PaginatedResult<AuditLogRecord>>;
  pruneAuditLogBefore(cutoffIso: string): Promise<number>;
}

export class InMemoryWardSenRepository implements WardSenRepository {
  private readonly accounts = new Map<string, AccountRecord>();
  private readonly people = new Map<string, PersonRecord>();
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

  async createDelivery(record: Omit<DeliveryRecord, "id" | "createdAt"> & { id?: string }): Promise<DeliveryRecord> {
    const delivery: DeliveryRecord = {
      ...record,
      id: record.id ?? nanoid(),
      createdAt: new Date().toISOString()
    };
    this.deliveries.set(delivery.id, delivery);
    return delivery;
  }

  async getDelivery(id: string): Promise<DeliveryRecord | undefined> {
    return this.deliveries.get(id);
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
}
