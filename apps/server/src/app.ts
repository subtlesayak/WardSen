import path from "node:path";
import Fastify from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import { nanoid } from "nanoid";
import { z } from "zod";
import {
  AccountSessionManager,
  ProviderRegistry,
  assertDeliveryOptionsSupported,
  assertFutureExpiry,
  parseViewLimit
} from "@wardsen/core";
import type { AccountRecord, CredentialProvider, CredentialSummary, DeliveryProvider, DeliveryRecord } from "@wardsen/core";
import { InMemoryWardSenRepository } from "@wardsen/database";
import type { WardSenRepository } from "@wardsen/database";
import { BitwardenCredentialProvider } from "@wardsen/provider-bitwarden";
import { BitwardenSendDeliveryProvider } from "@wardsen/delivery-bitwarden-send";
import { KeePassXCCredentialProvider } from "@wardsen/provider-keepassxc";
import { keeperProvider, onePasswordProvider, protonPassProvider } from "@wardsen/provider-scaffolds";
import { assertSameOrigin, isLocalRequest, safeErrorMessage } from "@wardsen/security";
import { parsePeopleCsv, peopleToCsv } from "./csv";

export interface BuildAppOptions {
  repository?: WardSenRepository;
  profileRoot?: string;
  sessions?: AccountSessionManager;
  apiToken?: string;
  credentialProviders?: CredentialProvider[];
  deliveryProviders?: DeliveryProvider[];
}

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: {
      redact: ["req.headers.authorization", "req.body.password", "req.body.accessPassword", "req.body.masterPassword"]
    },
    bodyLimit: 128 * 1024
  });
  const repository = options.repository ?? new InMemoryWardSenRepository();
  const sessions = options.sessions ?? new AccountSessionManager();
  const apiToken = options.apiToken ?? process.env.WARDSEN_API_TOKEN;
  const registry = new ProviderRegistry();
  const profileRoot = options.profileRoot ?? path.join(process.cwd(), ".wardsen-profiles");
  const bitwarden = new BitwardenCredentialProvider({ profileRoot, sessions });
  registry.registerCredentialProvider(bitwarden);
  registry.registerCredentialProvider(new KeePassXCCredentialProvider({ sessions }));
  registry.registerCredentialProvider(onePasswordProvider);
  registry.registerCredentialProvider(protonPassProvider);
  registry.registerCredentialProvider(keeperProvider);
  registry.registerDeliveryProvider(
    new BitwardenSendDeliveryProvider({
      getSessionToken: (accountId) => sessions.getSessionToken(accountId, "bitwarden")
    })
  );
  for (const provider of options.credentialProviders ?? []) {
    registry.registerCredentialProvider(provider);
  }
  for (const provider of options.deliveryProviders ?? []) {
    registry.registerDeliveryProvider(provider);
  }

  await app.register(sensible);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'", "http://127.0.0.1:4777"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"]
      }
    }
  });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });

  app.addHook("onRequest", async (request, reply) => {
    if (!isLocalRequest(request)) {
      await reply.code(403).send({ error: "WardSen only accepts local requests" });
      return;
    }
    const origin = firstHeaderValue(request.headers.origin);
    if (origin) {
      const corsAllowed = isAllowedLocalCorsOrigin(origin, request.headers.host);
      if (corsAllowed) {
        applyCorsHeaders(reply, origin);
      } else if (request.method === "OPTIONS") {
        await reply.code(403).send({ error: "WardSen blocked a cross-origin request from an untrusted origin." });
        return;
      }
    }
    if (request.method === "OPTIONS") {
      await reply.code(204).send();
      return;
    }
    if (!isAuthorizedLocalApiRequest(request.headers["x-wardsen-api-token"], apiToken)) {
      await reply.code(401).send({ error: "WardSen local service rejected this request because the desktop API token was missing or invalid. Restart WardSen from the desktop app, then retry." });
      return;
    }
    if (["POST", "PUT", "DELETE", "PATCH"].includes(request.method)) {
      assertSameOrigin(request);
    }
    await enforceAutoLock();
  });

  app.setErrorHandler(async (error, _request, reply) => {
    const statusCode = typeof error === "object" && error && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 400;
    await reply.code(statusCode).send({ error: safeErrorMessage(error) });
  });

  app.get("/api/health", async () => ({
    ok: true,
    name: "WardSen",
    description: "WardSen is a local-first credential dispatch hub for password managers and secure-sharing providers.",
    telemetry: false
  }));

  app.get("/api/providers", async () => ({
    credentialProviders: await Promise.all(
      registry.listCredentialProviders().map(async (provider) => ({
        id: provider.id,
        displayName: provider.displayName,
        capabilities: await provider.getCapabilities()
      }))
    ),
    deliveryProviders: await Promise.all(
      registry.listDeliveryProviders().map(async (provider) => ({
        id: provider.id,
        displayName: provider.displayName,
        capabilities: await provider.getCapabilities()
      }))
    )
  }));

  app.get("/api/accounts", async () => repository.listAccounts());

  app.post("/api/accounts", async (request) => {
    const body = accountSchema.parse(request.body);
    const now = new Date().toISOString();
    const id = body.id ?? nanoid();
    const record: Omit<AccountRecord, "createdAt" | "updatedAt"> = {
      id,
      providerId: body.providerId,
      label: body.label,
      username: body.username,
      serverUrl: body.serverUrl,
      profileDirectory: body.profileDirectory ?? path.join(profileRoot, id),
      accountType: body.accountType,
      autoLockMinutes: body.autoLockMinutes ?? 15,
      status: "locked",
      lastActivity: now
    };
    sessions.ensure(record.id, record.providerId);
    const account = await repository.upsertAccount(record);
    await audit("account.create", "success", { safeDetails: account.providerId });
    return account;
  });

  app.put("/api/accounts/:id", async (request) => {
    const { id } = idParams.parse(request.params);
    const body = accountSchema.omit({ id: true }).partial().parse(request.body);
    const existing = await findAccount(repository, id);
    const account = await repository.upsertAccount({
      id,
      providerId: body.providerId ?? existing.providerId,
      label: body.label ?? existing.label,
      username: body.username ?? existing.username,
      serverUrl: body.serverUrl ?? existing.serverUrl,
      profileDirectory: body.profileDirectory ?? existing.profileDirectory,
      accountType: body.accountType ?? existing.accountType,
      autoLockMinutes: body.autoLockMinutes ?? existing.autoLockMinutes,
      status: existing.status
    });
    await audit("account.update", "success", { sourceAccountId: id });
    return account;
  });

  app.delete("/api/accounts/:id", async (request) => {
    const { id } = idParams.parse(request.params);
    assertDestructiveConfirmation(request.body, confirmationPhrase("DELETE ACCOUNT", id));
    const account = await findAccount(repository, id);
    await registry.getCredentialProvider(account.providerId).logout(id).catch(() => undefined);
    await repository.deleteAccount(id);
    await audit("account.delete", "success", { sourceAccountId: id });
    return { ok: true };
  });

  app.post("/api/accounts/:id/login", async (request) => {
    const { id } = idParams.parse(request.params);
    const body = loginSchema.parse(request.body);
    const account = await findAccount(repository, id);
    const provider = registry.getCredentialProvider(account.providerId);
    await provider.login(id, body);
    await audit("account.login", "success", { sourceAccountId: id });
    return { ok: true };
  });

  app.post("/api/accounts/:id/unlock", async (request) => {
    const { id } = idParams.parse(request.params);
    const body = unlockSchema.parse(request.body);
    const account = await findAccount(repository, id);
    const provider = registry.getCredentialProvider(account.providerId);
    await provider.unlock(id, body);
    await audit("account.unlock", "success", { sourceAccountId: id });
    return { ok: true };
  });

  app.post("/api/accounts/:id/lock", async (request) => {
    const { id } = idParams.parse(request.params);
    const account = await findAccount(repository, id);
    const provider = registry.getCredentialProvider(account.providerId);
    await provider.lock(id);
    await audit("account.lock", "success", { sourceAccountId: id });
    return { ok: true };
  });

  app.post("/api/accounts/:id/logout", async (request) => {
    const { id } = idParams.parse(request.params);
    const account = await findAccount(repository, id);
    const provider = registry.getCredentialProvider(account.providerId);
    await provider.logout(id);
    await audit("account.logout", "success", { sourceAccountId: id });
    return { ok: true };
  });

  app.post("/api/accounts/:id/sync", async (request) => {
    const { id } = idParams.parse(request.params);
    const account = await findAccount(repository, id);
    const provider = registry.getCredentialProvider(account.providerId);
    await provider.sync(id);
    await audit("account.sync", "success", { sourceAccountId: id });
    return { ok: true };
  });

  app.get("/api/accounts/:id/status", async (request) => {
    const { id } = idParams.parse(request.params);
    const account = await findAccount(repository, id);
    return registry.getCredentialProvider(account.providerId).testConnection(id);
  });

  app.get("/api/credentials/search", async (request) => {
    const query = credentialSearchSchema.parse(request.query);
    const accounts = await repository.listAccounts();
    const selectedAccounts = query.accountId ? accounts.filter((account) => account.id === query.accountId) : accounts;
    const results: CredentialSummary[] = [];
    const errors: Array<{ accountId: string; providerId: string; safeMessage: string }> = [];
    for (const account of selectedAccounts.filter((candidate) => !query.providerId || candidate.providerId === query.providerId)) {
      const provider = registry.getCredentialProvider(account.providerId);
      try {
        results.push(...(await provider.search(account.id, query.q, { page: query.page, pageSize: query.pageSize })));
      } catch (error) {
        errors.push({ accountId: account.id, providerId: account.providerId, safeMessage: safeErrorMessage(error) });
      }
    }
    return { items: results, page: query.page, pageSize: query.pageSize, total: results.length, errors };
  });

  app.get("/api/people", async (request) => {
    const query = peopleQuerySchema.parse(request.query);
    return repository.listPeople(query);
  });

  app.post("/api/people", async (request) => {
    const body = personSchema.parse(request.body);
    const duplicates = await repository.findDuplicatePeople({ email: body.email, phone: body.phone });
    const person = await repository.upsertPerson({ ...body, active: body.active ?? true });
    await audit("people.upsert", "success", { personId: person.id, safeDetails: duplicates.length ? "duplicates_detected" : undefined });
    return { person, duplicates };
  });

  app.put("/api/people/:id", async (request) => {
    const { id } = idParams.parse(request.params);
    const existing = await repository.getPerson(id);
    if (!existing) throw app.httpErrors.notFound("Person not found");
    const body = personSchema.partial().parse(request.body);
    const person = await repository.upsertPerson({
      id,
      name: body.name ?? existing.name,
      phone: body.phone ?? existing.phone,
      email: body.email ?? existing.email,
      groupName: body.groupName ?? existing.groupName,
      role: body.role ?? existing.role,
      notes: body.notes ?? existing.notes,
      active: body.active ?? existing.active
    });
    await audit("people.update", "success", { personId: id });
    return person;
  });

  app.post("/api/people/import", async (request) => {
    const body = csvImportSchema.parse(request.body);
    const people = parsePeopleCsv(body.csv);
    const imported = [];
    const duplicates = [];
    for (const person of people) {
      duplicates.push(...(await repository.findDuplicatePeople({ email: person.email, phone: person.phone })));
      imported.push(await repository.upsertPerson(person));
    }
    await audit("people.import", "success", { safeDetails: `imported=${imported.length};duplicates=${duplicates.length}` });
    return { importedCount: imported.length, duplicateCount: duplicates.length, people: imported, duplicates };
  });

  app.get("/api/people/export", async (_request, reply) => {
    const allPeople = [];
    let page = 1;
    while (true) {
      const result = await repository.listPeople({ page, pageSize: 100, sortBy: "name" });
      allPeople.push(...result.items);
      if (allPeople.length >= result.total) break;
      page += 1;
    }
    await reply.header("content-type", "text/csv; charset=utf-8").send(peopleToCsv(allPeople));
  });

  app.delete("/api/people/:id", async (request) => {
    const { id } = idParams.parse(request.params);
    const query = hardDeleteSchema.parse(request.query);
    if (query.hard) {
      assertDestructiveConfirmation(request.body, confirmationPhrase("DELETE PERSON", id));
      await repository.deletePerson(id);
      await audit("people.delete", "success", { personId: id });
      return { ok: true, deleted: true };
    }
    await repository.archivePerson(id);
    await audit("people.archive", "success", { personId: id });
    return { ok: true, archived: true };
  });

  app.post("/api/people/:id/restore", async (request) => {
    const { id } = idParams.parse(request.params);
    await repository.restorePerson(id);
    await audit("people.restore", "success", { personId: id });
    return { ok: true };
  });

  app.post("/api/deliveries", async (request) => {
    const body = deliverySchema.parse(request.body);
    return createOneDelivery(body);
  });

  app.post("/api/deliveries/bulk", async (request) => {
    const body = bulkDeliverySchema.parse(request.body);
    if (body.confirmRiskSummary !== true) {
      throw new Error("Bulk delivery requires confirmation of credential, vault, provider, recipient count, expiry and view limit");
    }
    if (body.recipients.length > LARGE_BATCH_RECIPIENT_THRESHOLD && body.largeBatchConfirmation !== largeBatchConfirmation(body.recipients.length)) {
      throw new Error(`Large bulk delivery requires confirmation phrase: ${largeBatchConfirmation(body.recipients.length)}`);
    }
    const batchId = nanoid();
    await repository.createBatch({
      id: batchId,
      requestedCount: body.recipients.length,
      completedCount: 0,
      failedCount: 0,
      cancelled: false
    });
    const results: Array<{ recipientId?: string; ok: boolean; delivery?: unknown; error?: string }> = [];
    const concurrency = Math.min(Math.max(1, body.concurrency ?? 2), 5);
    let index = 0;
    async function worker() {
      while (index < body.recipients.length) {
        const current = body.recipients[index];
        index += 1;
        try {
          const delivery = await createOneDelivery({ ...body, recipient: current, batchId });
          results.push({ recipientId: current.id, ok: true, delivery });
        } catch (error) {
          await audit("delivery.create", "failure", {
            sourceAccountId: body.sourceAccountId,
            deliveryAccountId: body.deliveryAccountId,
            personId: current.id,
            safeDetails: safeErrorMessage(error)
          });
          results.push({ recipientId: current.id, ok: false, error: safeErrorMessage(error) });
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    const completedCount = results.filter((result) => result.ok).length;
    const failedCount = results.filter((result) => !result.ok).length;
    await repository.updateBatch(batchId, {
      completedCount,
      failedCount,
      completedAt: new Date().toISOString()
    });
    return {
      batchId,
      requestedCount: body.recipients.length,
      completedCount,
      failedCount,
      results
    };
  });

  app.get("/api/batches/:id", async (request) => {
    const { id } = idParams.parse(request.params);
    const batch = await repository.getBatch(id);
    if (!batch) throw app.httpErrors.notFound("Batch not found");
    return batch;
  });

  app.get("/api/batches", async (request) => {
    const query = paginationSchema.parse(request.query);
    return repository.listBatches(query);
  });

  app.post("/api/batches/:id/cancel", async (request) => {
    const { id } = idParams.parse(request.params);
    assertDestructiveConfirmation(request.body, confirmationPhrase("CANCEL BATCH", id));
    const batch = await repository.updateBatch(id, { cancelled: true, completedAt: new Date().toISOString() });
    await audit("batch.cancel", "cancelled", { safeDetails: id });
    return batch;
  });

  app.get("/api/audit-log", async (request) => {
    const query = paginationSchema.parse(request.query);
    return repository.listAuditLog(query);
  });

  async function createOneDelivery(body: z.infer<typeof deliverySchema> & { batchId?: string }) {
    const sourceAccount = await findAccount(repository, body.sourceAccountId);
    if (sourceAccount.providerId !== body.sourceProviderId) {
      throw new Error("Source account does not belong to the requested credential provider");
    }
    const deliveryAccount = await findAccount(repository, body.deliveryAccountId);
    assertDeliveryAccountMatchesProvider(body.deliveryProviderId, deliveryAccount);
    const sourceProvider = registry.getCredentialProvider(body.sourceProviderId);
    const deliveryProvider = registry.getDeliveryProvider(body.deliveryProviderId);
    const capabilities = await deliveryProvider.getCapabilities();
    const viewLimit = parseViewLimit(body.viewLimit);
    const expiresAt = new Date(body.expiresAt);
    assertFutureExpiry(expiresAt);
    assertDeliveryOptionsSupported(capabilities, {
      viewLimit,
      viewOnce: body.viewOnce,
      accessPassword: body.accessPassword,
      hideText: body.hideText
    });
    const sensitiveCredential = await sourceProvider.getCredential(body.sourceAccountId, body.sourceItemId);
    const result = await deliveryProvider.createDelivery({
      sourceCredential: sensitiveCredential,
      recipient: body.recipient,
      expiresAt,
      viewLimit,
      viewOnce: body.viewOnce,
      accessPassword: body.accessPassword,
      hideText: body.hideText,
      deliveryAccountId: body.deliveryAccountId
    });
    const record = await repository.createDelivery({
      providerDeliveryId: result.deliveryId,
      sourceProviderId: body.sourceProviderId,
      sourceAccountId: body.sourceAccountId,
      sourceItemId: body.sourceItemId,
      deliveryProviderId: body.deliveryProviderId,
      deliveryAccountId: body.deliveryAccountId,
      credentialName: sensitiveCredential.title,
      personId: body.recipient?.id,
      batchId: body.batchId,
      deliveryMethod: body.deliveryMethod,
      expiresAt: result.expiresAt.toISOString(),
      viewLimit: result.viewLimit,
      status: "active"
    });
    await audit("delivery.create", "success", {
      sourceAccountId: body.sourceAccountId,
      deliveryAccountId: body.deliveryAccountId,
      personId: body.recipient?.id,
      deliveryId: record.id,
      safeDetails: `provider=${body.deliveryProviderId}`
    });
    return sanitizeDelivery(record, result.url);
  }

  app.get("/api/deliveries", async (request) => {
    const query = deliveryQuerySchema.parse(request.query);
    return repository.listDeliveries(query);
  });

  app.get("/api/deliveries/:id", async (request) => {
    const { id } = idParams.parse(request.params);
    const delivery = await repository.getDelivery(id);
    if (!delivery) throw app.httpErrors.notFound("Delivery not found");
    return delivery;
  });

  app.post("/api/deliveries/:id/refresh", async (request) => {
    const { id } = idParams.parse(request.params);
    const delivery = await repository.getDelivery(id);
    if (!delivery) throw app.httpErrors.notFound("Delivery not found");
    const provider = registry.getDeliveryProvider(delivery.deliveryProviderId);
    const status = await provider.getStatus(delivery.deliveryAccountId, delivery.providerDeliveryId ?? delivery.id);
    const updated = await repository.updateDelivery(id, {
      status: status.status,
      accessCount: status.accessCount,
      expiresAt: status.expiresAt?.toISOString() ?? delivery.expiresAt,
      revokedAt: status.revokedAt?.toISOString() ?? delivery.revokedAt,
      lastCheckedAt: new Date().toISOString()
    });
    await audit("delivery.refresh", "success", { deliveryAccountId: delivery.deliveryAccountId, deliveryId: id });
    return updated;
  });

  app.post("/api/deliveries/:id/retry", async (request) => {
    const { id } = idParams.parse(request.params);
    const delivery = await repository.getDelivery(id);
    if (!delivery) throw app.httpErrors.notFound("Delivery not found");
    const person = delivery.personId ? await repository.getPerson(delivery.personId) : undefined;
    const retried = await createOneDelivery({
      sourceProviderId: delivery.sourceProviderId,
      sourceAccountId: delivery.sourceAccountId,
      sourceItemId: delivery.sourceItemId,
      deliveryProviderId: delivery.deliveryProviderId,
      deliveryAccountId: delivery.deliveryAccountId,
      recipient: person ? { id: person.id, name: person.name, email: person.email, phone: person.phone } : undefined,
      expiresAt: delivery.expiresAt,
      viewLimit: delivery.viewLimit,
      deliveryMethod: delivery.deliveryMethod,
      batchId: delivery.batchId
    });
    await audit("delivery.retry", "success", { deliveryAccountId: delivery.deliveryAccountId, deliveryId: id });
    return retried;
  });

  app.delete("/api/deliveries/:id", async (request) => {
    const { id } = idParams.parse(request.params);
    assertDestructiveConfirmation(request.body, confirmationPhrase("REVOKE DELIVERY", id));
    const delivery = await repository.getDelivery(id);
    if (!delivery) throw app.httpErrors.notFound("Delivery not found");
    const provider = registry.getDeliveryProvider(delivery.deliveryProviderId);
    await provider.revoke(delivery.deliveryAccountId, delivery.providerDeliveryId ?? delivery.id);
    const updated = await repository.updateDelivery(id, { status: "revoked", revokedAt: new Date().toISOString() });
    await audit("delivery.revoke", "success", { deliveryAccountId: delivery.deliveryAccountId, deliveryId: id });
    return updated;
  });

  app.addHook("onClose", async () => {
    for (const account of await repository.listAccounts()) {
      await registry.getCredentialProvider(account.providerId).lock(account.id).catch(() => undefined);
    }
    sessions.lockAll();
  });

  return app;

  async function audit(
    action: string,
    outcome: "success" | "failure" | "cancelled",
    fields: { sourceAccountId?: string; deliveryAccountId?: string; personId?: string; deliveryId?: string; safeDetails?: string } = {}
  ) {
    await repository.appendAuditLog({ action, outcome, ...fields });
  }

  async function enforceAutoLock() {
    const accounts = await repository.listAccounts();
    const accountsById = new Map(accounts.map((account) => [account.id, account]));
    const lockedIds = sessions.lockInactive(new Date(), (accountId) => accountsById.get(accountId)?.autoLockMinutes ?? 15);
    for (const id of lockedIds) {
      const account = accountsById.get(id);
      if (!account) continue;
      await registry.getCredentialProvider(account.providerId).lock(id).catch(() => undefined);
      await audit("account.auto_lock", "success", { sourceAccountId: id });
    }
  }
}

function isAuthorizedLocalApiRequest(header: string | string[] | undefined, apiToken?: string): boolean {
  if (!apiToken) return true;
  const value = Array.isArray(header) ? header[0] : header;
  return value === apiToken;
}

function firstHeaderValue(header: string | string[] | undefined): string | undefined {
  return Array.isArray(header) ? header[0] : header;
}

function applyCorsHeaders(reply: { header: (name: string, value: string) => unknown }, origin: string): void {
  reply.header("access-control-allow-origin", origin);
  reply.header("vary", "Origin");
  reply.header("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  reply.header("access-control-allow-headers", "content-type,x-wardsen-api-token");
  reply.header("access-control-max-age", "600");
}

function isAllowedLocalCorsOrigin(origin: string, host?: string): boolean {
  try {
    const parsed = new URL(origin);
    if ((parsed.protocol === "tauri:" && parsed.hostname === "localhost") || parsed.hostname === "tauri.localhost") {
      return true;
    }
    return Boolean(host && ["http:", "https:"].includes(parsed.protocol) && parsed.host === host);
  } catch {
    return false;
  }
}

const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25)
});

const idParams = z.object({ id: z.string().min(1) });
const accountSchema = z.object({
  id: z.string().optional(),
  providerId: z.string().min(1),
  label: z.string().min(1),
  username: z.string().optional(),
  serverUrl: z.string().url().optional(),
  profileDirectory: z.string().optional(),
  accountType: z.string().optional(),
  autoLockMinutes: z.number().int().positive().optional()
});
const unlockSchema = z.object({
  password: z.string().optional(),
  keyFilePath: z.string().optional(),
  databasePath: z.string().optional()
});
const loginSchema = z.object({
  username: z.string().optional(),
  password: z.string().optional(),
  verificationCode: z.string().optional(),
  verificationMethod: z.enum(["email", "authenticator", "yubikey"]).optional(),
  serverUrl: z.string().url().optional(),
  sso: z.boolean().optional()
});
const credentialSearchSchema = paginationSchema.extend({
  q: z.string().default(""),
  providerId: z.string().optional(),
  accountId: z.string().optional()
});
const peopleQuerySchema = paginationSchema.extend({
  search: z.string().optional(),
  groupName: z.string().optional(),
  active: z.coerce.boolean().optional(),
  sortBy: z.enum(["name", "groupName", "createdAt"]).optional(),
  sortDirection: z.enum(["asc", "desc"]).optional()
});
const deliveryQuerySchema = paginationSchema.extend({
  batchId: z.string().optional()
});
const hardDeleteSchema = z.object({
  hard: z.coerce.boolean().optional()
});
const destructiveConfirmationSchema = z.object({
  confirm: z.string()
});
const personSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  groupName: z.string().optional(),
  role: z.string().optional(),
  notes: z.string().optional(),
  active: z.boolean().optional()
});
const csvImportSchema = z.object({
  csv: z.string().max(1024 * 1024)
});
const deliverySchema = z.object({
  sourceProviderId: z.string(),
  sourceAccountId: z.string(),
  sourceItemId: z.string(),
  deliveryProviderId: z.string(),
  deliveryAccountId: z.string(),
  recipient: z.object({ id: z.string(), name: z.string(), email: z.string().optional(), phone: z.string().optional() }).optional(),
  expiresAt: z.string(),
  viewLimit: z.union([z.string(), z.number()]).optional(),
  viewOnce: z.boolean().optional(),
  accessPassword: z.string().optional(),
  hideText: z.boolean().optional(),
  deliveryMethod: z.enum(["copy", "whatsapp", "email"]).optional()
});
const bulkDeliverySchema = deliverySchema.omit({ recipient: true }).extend({
  recipients: z.array(z.object({ id: z.string(), name: z.string(), email: z.string().optional(), phone: z.string().optional() })).min(1).max(500),
  concurrency: z.number().int().positive().max(5).optional(),
  confirmRiskSummary: z.boolean().optional(),
  largeBatchConfirmation: z.string().optional()
});
const LARGE_BATCH_RECIPIENT_THRESHOLD = 25;

async function findAccount(repository: WardSenRepository, id: string): Promise<AccountRecord> {
  const account = (await repository.listAccounts()).find((candidate) => candidate.id === id);
  if (!account) throw new Error(`Account not found: ${id}`);
  return account;
}

function sanitizeDelivery(record: DeliveryRecord, url: string) {
  return {
    ...record,
    oneTimeDeliveryUrl: url
  };
}

function assertDeliveryAccountMatchesProvider(deliveryProviderId: string, deliveryAccount: AccountRecord): void {
  if (deliveryProviderId === "bitwarden-send" && deliveryAccount.providerId !== "bitwarden") {
    throw new Error("Bitwarden Send delivery requires an unlocked Bitwarden account");
  }
}

function largeBatchConfirmation(recipientCount: number): string {
  return `SEND ${recipientCount}`;
}

function confirmationPhrase(action: "DELETE ACCOUNT" | "DELETE PERSON" | "REVOKE DELIVERY" | "CANCEL BATCH", id: string): string {
  return `${action} ${id}`;
}

function assertDestructiveConfirmation(body: unknown, expected: string): void {
  const parsed = destructiveConfirmationSchema.safeParse(body);
  if (!parsed.success || parsed.data.confirm !== expected) {
    throw new Error(`Destructive action requires confirmation phrase: ${expected}`);
  }
}
