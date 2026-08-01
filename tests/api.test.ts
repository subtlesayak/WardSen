import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountSessionManager } from "@wardsen/core";
import type {
  ConnectionResult,
  CredentialProvider,
  CredentialProviderCapabilities,
  CredentialSummary,
  DeliveryProvider,
  DeliveryProviderCapabilities,
  DeliveryResult,
  DeliveryStatus,
  PaginationInput,
  ProviderLoginInput,
  ProviderUnlockInput,
  SensitiveCredential,
  CreateDeliveryInput
} from "@wardsen/core";
import { buildApp } from "../apps/server/src/app";

describe("WardSen API", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves health only through local host requests", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/api/health", headers: { host: "127.0.0.1:4777" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().telemetry).toBe(false);
    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
    await app.close();
  });

  it("rejects non-local host headers before serving API data", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/api/health", headers: { host: "wardsen.example.test" } });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe("WardSen only accepts local requests");
    await app.close();
  });

  it("requires the desktop API token when configured", async () => {
    const app = await buildApp({ apiToken: "desktop-token" });
    const missing = await app.inject({ method: "GET", url: "/api/health", headers: { host: "127.0.0.1:4777" } });
    expect(missing.statusCode).toBe(401);
    expect(missing.json().error).toContain("desktop API token");

    const accepted = await app.inject({
      method: "GET",
      url: "/api/health",
      headers: { host: "127.0.0.1:4777", "x-wardsen-api-token": "desktop-token" }
    });
    expect(accepted.statusCode).toBe(200);
    await app.close();
  });

  it("rejects cross-origin state-changing requests", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/accounts",
      headers: { host: "127.0.0.1:4777", origin: "http://evil.example.test" },
      payload: { id: "ops", providerId: "bitwarden", label: "Operations" }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("Cross-origin request blocked");
    expect(response.json().error).toContain("Origin http://evil.example.test");
    expect(response.json().error).toContain("http://127.0.0.1:4777");
    await app.close();
  });

  it("accepts state-changing requests from the packaged Tauri origin", async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/accounts",
      headers: { host: "127.0.0.1:4777", origin: "tauri://localhost" },
      payload: { id: "ops", providerId: "bitwarden", label: "Operations" }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().id).toBe("ops");
    await app.close();
  });

  it("lists provider capabilities", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/api/providers", headers: { host: "127.0.0.1:4777" } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.credentialProviders.some((provider: { id: string }) => provider.id === "bitwarden")).toBe(true);
    expect(body.deliveryProviders.some((provider: { id: string }) => provider.id === "bitwarden-send")).toBe(true);
    await app.close();
  });

  it("creates, updates and deletes account metadata", async () => {
    const app = await buildApp();
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    const created = await app.inject({
      method: "POST",
      url: "/api/accounts",
      headers,
      payload: { id: "ops", providerId: "bitwarden", label: "Operations", username: "ops@example.com" }
    });
    expect(created.statusCode).toBe(200);

    const updated = await app.inject({
      method: "PUT",
      url: "/api/accounts/ops",
      headers,
      payload: { label: "Company Operations" }
    });
    expect(updated.json().label).toBe("Company Operations");

    const removed = await app.inject({ method: "DELETE", url: "/api/accounts/ops", headers, payload: { confirm: "DELETE ACCOUNT ops" } });
    expect(removed.statusCode).toBe(200);

    const audit = await app.inject({ method: "GET", url: "/api/audit-log", headers: { host: "127.0.0.1:4777" } });
    expect(audit.json().items.some((item: { action: string }) => item.action === "account.delete")).toBe(true);
    await app.close();
  });

  it("imports and exports people CSV", async () => {
    const app = await buildApp();
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    const imported = await app.inject({
      method: "POST",
      url: "/api/people/import",
      headers,
      payload: { csv: "name,email,group\nMira,mira@example.com,Ops" }
    });
    expect(imported.json().importedCount).toBe(1);

    const exported = await app.inject({ method: "GET", url: "/api/people/export", headers: { host: "127.0.0.1:4777" } });
    expect(exported.body).toContain("mira@example.com");
    await app.close();
  });

  it("edits, archives, restores and hard-deletes people", async () => {
    const app = await buildApp();
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    const created = await app.inject({
      method: "POST",
      url: "/api/people",
      headers,
      payload: { id: "person-1", name: "Mira", email: "mira@example.com" }
    });
    expect(created.statusCode).toBe(200);

    const updated = await app.inject({
      method: "PUT",
      url: "/api/people/person-1",
      headers,
      payload: { groupName: "Ops" }
    });
    expect(updated.json().groupName).toBe("Ops");

    expect((await app.inject({ method: "DELETE", url: "/api/people/person-1", headers })).json().archived).toBe(true);
    expect((await app.inject({ method: "POST", url: "/api/people/person-1/restore", headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: "/api/people/person-1?hard=true", headers, payload: { confirm: "DELETE PERSON person-1" } })).json().deleted).toBe(true);
    await app.close();
  });

  it("tracks cancellable delivery batches", async () => {
    const app = await buildApp();
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    const batch = await app.inject({
      method: "POST",
      url: "/api/batches/example/cancel",
      headers
    });
    expect(batch.statusCode).toBe(400);

    const repositoryBatch = await app.inject({ method: "GET", url: "/api/batches/missing", headers: { host: "127.0.0.1:4777" } });
    expect(repositoryBatch.statusCode).toBe(404);
    await app.close();
  });

  it("requires server-side confirmation for destructive actions", async () => {
    const app = await buildApp({
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [new MockDeliveryProvider()]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "delivery", providerId: "mock-source", label: "Mock delivery" } });
    await app.inject({ method: "POST", url: "/api/people", headers, payload: { id: "person-1", name: "Mira", email: "mira@example.com" } });

    const accountDelete = await app.inject({ method: "DELETE", url: "/api/accounts/source", headers });
    expect(accountDelete.statusCode).toBe(400);
    expect(accountDelete.json().error).toBe("Destructive action requires confirmation phrase: DELETE ACCOUNT source");

    const hardDelete = await app.inject({
      method: "DELETE",
      url: "/api/people/person-1?hard=true",
      headers,
      payload: { confirm: "DELETE PERSON wrong-id" }
    });
    expect(hardDelete.statusCode).toBe(400);
    expect(hardDelete.json().error).toBe("Destructive action requires confirmation phrase: DELETE PERSON person-1");

    const created = await app.inject({
      method: "POST",
      url: "/api/deliveries",
      headers,
      payload: {
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms",
        deliveryProviderId: "mock-delivery",
        deliveryAccountId: "delivery",
        expiresAt: new Date(Date.now() + 3600000).toISOString()
      }
    });
    const deliveryId = created.json().id;
    const revoke = await app.inject({ method: "DELETE", url: `/api/deliveries/${deliveryId}`, headers });
    expect(revoke.statusCode).toBe(400);
    expect(revoke.json().error).toBe(`Destructive action requires confirmation phrase: REVOKE DELIVERY ${deliveryId}`);

    const bulk = await app.inject({
      method: "POST",
      url: "/api/deliveries/bulk",
      headers,
      payload: {
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms",
        deliveryProviderId: "mock-delivery",
        deliveryAccountId: "delivery",
        recipients: [{ id: "person-1", name: "Mira", email: "mira@example.com" }],
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        confirmRiskSummary: true
      }
    });
    const batchId = bulk.json().batchId;
    const cancelWithoutConfirmation = await app.inject({ method: "POST", url: `/api/batches/${batchId}/cancel`, headers });
    expect(cancelWithoutConfirmation.statusCode).toBe(400);
    expect(cancelWithoutConfirmation.json().error).toBe(`Destructive action requires confirmation phrase: CANCEL BATCH ${batchId}`);

    const cancelWithConfirmation = await app.inject({
      method: "POST",
      url: `/api/batches/${batchId}/cancel`,
      headers,
      payload: { confirm: `CANCEL BATCH ${batchId}` }
    });
    expect(cancelWithConfirmation.statusCode).toBe(200);
    expect(cancelWithConfirmation.json().cancelled).toBe(true);
    await app.close();
  });

  it("runs a complete credential delivery workflow through injected providers", async () => {
    const deliveryProvider = new MockDeliveryProvider();
    const app = await buildApp({
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [deliveryProvider]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({
      method: "POST",
      url: "/api/accounts",
      headers,
      payload: { id: "source", providerId: "mock-source", label: "Mock source" }
    });
    await app.inject({
      method: "POST",
      url: "/api/accounts",
      headers,
      payload: { id: "delivery", providerId: "mock-source", label: "Mock delivery" }
    });
    await app.inject({
      method: "POST",
      url: "/api/people",
      headers,
      payload: { id: "person-1", name: "Mira", email: "mira@example.com" }
    });

    const search = await app.inject({
      method: "GET",
      url: "/api/credentials/search?providerId=mock-source&accountId=source&q=cms",
      headers: { host: "127.0.0.1:4777" }
    });
    expect(search.json().items[0]).toMatchObject({ title: "CMS Login" });

    const created = await app.inject({
      method: "POST",
      url: "/api/deliveries",
      headers,
      payload: {
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms",
        deliveryProviderId: "mock-delivery",
        deliveryAccountId: "delivery",
        recipient: { id: "person-1", name: "Mira", email: "mira@example.com" },
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        viewLimit: 2,
        viewOnce: true,
        deliveryMethod: "email"
      }
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().oneTimeDeliveryUrl).toMatch(/^https:\/\/mock.local\/send\//);
    expect(created.json().deliveryMethod).toBe("email");
    expect(deliveryProvider.inputs[0].viewOnce).toBe(true);
    expect(JSON.stringify(await app.inject({ method: "GET", url: "/api/deliveries", headers: { host: "127.0.0.1:4777" } }).then((response) => response.json()))).not.toContain("Password");

    const deliveryId = created.json().id;
    expect((await app.inject({ method: "GET", url: `/api/deliveries/${deliveryId}`, headers: { host: "127.0.0.1:4777" } })).json().deliveryMethod).toBe("email");
    const refreshed = (await app.inject({ method: "POST", url: `/api/deliveries/${deliveryId}/refresh`, headers })).json();
    expect(refreshed.accessCount).toBe(1);
    expect(refreshed.lastCheckedAt).toBeTruthy();
    expect((await app.inject({ method: "POST", url: `/api/deliveries/${deliveryId}/retry`, headers })).json().oneTimeDeliveryUrl).toMatch(/^https:\/\/mock.local\/send\//);
    expect((await app.inject({ method: "DELETE", url: `/api/deliveries/${deliveryId}`, headers, payload: { confirm: `REVOKE DELIVERY ${deliveryId}` } })).json().status).toBe("revoked");
    await app.close();
  });

  it("rejects delivery when the source account belongs to another provider", async () => {
    const app = await buildApp({
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [new MockDeliveryProvider()]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "onepassword", label: "Wrong source" } });
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "delivery", providerId: "mock-source", label: "Mock delivery" } });

    const response = await app.inject({
      method: "POST",
      url: "/api/deliveries",
      headers,
      payload: {
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms",
        deliveryProviderId: "mock-delivery",
        deliveryAccountId: "delivery",
        expiresAt: new Date(Date.now() + 3600000).toISOString()
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("Source account does not belong to the requested credential provider");
    await app.close();
  });

  it("returns partial credential search errors without failing the whole search", async () => {
    const app = await buildApp({ credentialProviders: [new MockCredentialProvider()] });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "ok", providerId: "mock-source", label: "OK" } });
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "bad", providerId: "onepassword", label: "Future provider" } });

    const response = await app.inject({ method: "GET", url: "/api/credentials/search?q=cms", headers: { host: "127.0.0.1:4777" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(2);
    expect(response.json().errors[0]).toMatchObject({ accountId: "bad", providerId: "onepassword" });
    await app.close();
  });

  it("paginates credential search results", async () => {
    const app = await buildApp({ credentialProviders: [new MockCredentialProvider()] });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });

    const response = await app.inject({
      method: "GET",
      url: "/api/credentials/search?providerId=mock-source&accountId=source&q=cms&page=2&pageSize=1",
      headers: { host: "127.0.0.1:4777" }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([expect.objectContaining({ id: "cms-backup", title: "CMS Backup" })]);
    await app.close();
  });

  it("creates individual bulk deliveries with persisted batch counts", async () => {
    const app = await buildApp({
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [new MockDeliveryProvider()]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "delivery", providerId: "mock-source", label: "Mock delivery" } });

    const bulk = await app.inject({
      method: "POST",
      url: "/api/deliveries/bulk",
      headers,
      payload: {
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms",
        deliveryProviderId: "mock-delivery",
        deliveryAccountId: "delivery",
        recipients: [
          { id: "person-1", name: "Mira", email: "mira@example.com" },
          { id: "person-2", name: "Jon", email: "jon@example.com" }
        ],
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        viewLimit: 1,
        concurrency: 2,
        confirmRiskSummary: true
      }
    });

    expect(bulk.statusCode).toBe(200);
    expect(bulk.json()).toMatchObject({ requestedCount: 2, completedCount: 2, failedCount: 0 });
    const batch = await app.inject({ method: "GET", url: `/api/batches/${bulk.json().batchId}`, headers: { host: "127.0.0.1:4777" } });
    expect(batch.json()).toMatchObject({ requestedCount: 2, completedCount: 2, failedCount: 0, cancelled: false });
    const batches = await app.inject({ method: "GET", url: "/api/batches?page=1&pageSize=10", headers: { host: "127.0.0.1:4777" } });
    expect(batches.json().items[0]).toMatchObject({ id: bulk.json().batchId, requestedCount: 2, completedCount: 2 });
    const batchDeliveries = await app.inject({ method: "GET", url: `/api/deliveries?batchId=${bulk.json().batchId}`, headers: { host: "127.0.0.1:4777" } });
    expect(batchDeliveries.json().items).toHaveLength(2);
    expect(batchDeliveries.json().items.every((delivery: { batchId: string }) => delivery.batchId === bulk.json().batchId)).toBe(true);
    await app.close();
  });

  it("requires explicit risk confirmation before bulk delivery", async () => {
    const app = await buildApp({
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [new MockDeliveryProvider()]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "delivery", providerId: "mock-source", label: "Mock delivery" } });

    const response = await app.inject({
      method: "POST",
      url: "/api/deliveries/bulk",
      headers,
      payload: {
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms",
        deliveryProviderId: "mock-delivery",
        deliveryAccountId: "delivery",
        recipients: [{ id: "person-1", name: "Mira", email: "mira@example.com" }],
        expiresAt: new Date(Date.now() + 3600000).toISOString()
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("Bulk delivery requires confirmation");
    await app.close();
  });

  it("requires a typed phrase for large bulk delivery", async () => {
    const app = await buildApp({
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [new MockDeliveryProvider()]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "delivery", providerId: "mock-source", label: "Mock delivery" } });

    const response = await app.inject({
      method: "POST",
      url: "/api/deliveries/bulk",
      headers,
      payload: {
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms",
        deliveryProviderId: "mock-delivery",
        deliveryAccountId: "delivery",
        recipients: Array.from({ length: 26 }, (_, index) => ({ id: `person-${index}`, name: `Person ${index}` })),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        confirmRiskSummary: true,
        largeBatchConfirmation: "SEND 25"
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("Large bulk delivery requires confirmation phrase: SEND 26");
    await app.close();
  });

  it("auto-locks inactive accounts using their configured timeout", async () => {
    const sessions = new AccountSessionManager();
    const provider = new LockTrackingCredentialProvider();
    const app = await buildApp({ sessions, credentialProviders: [provider] });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({
      method: "POST",
      url: "/api/accounts",
      headers,
      payload: { id: "source", providerId: "lock-tracking", label: "Lock tracking", autoLockMinutes: 1 }
    });
    sessions.markUnlocked("source", "lock-tracking", "token");
    ageSession(sessions, "source", new Date(Date.now() - 2 * 60 * 1000));

    const response = await app.inject({ method: "GET", url: "/api/accounts", headers: { host: "127.0.0.1:4777" } });

    expect(response.statusCode).toBe(200);
    expect(provider.locked).toEqual(["source"]);
    expect(() => sessions.getSessionToken("source", "lock-tracking")).toThrow();
    await app.close();
  });
});

class MockCredentialProvider implements CredentialProvider {
  readonly id: string = "mock-source";
  readonly displayName: string = "Mock Source";
  async getCapabilities(): Promise<CredentialProviderCapabilities> {
    return { searchItems: true, multipleAccounts: true, customServers: false, localVaults: false, synchronization: false, locking: false };
  }
  async testConnection(_accountId: string): Promise<ConnectionResult> {
    return { ok: true, status: "unlocked" };
  }
  async login(_accountId: string, _input: ProviderLoginInput): Promise<void> {}
  async unlock(_accountId: string, _input: ProviderUnlockInput): Promise<void> {}
  async lock(_accountId: string): Promise<void> {}
  async logout(_accountId: string): Promise<void> {}
  async sync(_accountId: string): Promise<void> {}
  async search(accountId: string, _query: string, pagination: PaginationInput): Promise<CredentialSummary[]> {
    const rows: CredentialSummary[] = [
      { id: "cms", accountId, providerId: this.id, title: "CMS Login", username: "mira", domain: "example.com", itemType: "login" },
      { id: "cms-backup", accountId, providerId: this.id, title: "CMS Backup", username: "ops", domain: "example.com", itemType: "login" }
    ];
    const start = (pagination.page - 1) * pagination.pageSize;
    return rows.slice(start, start + pagination.pageSize);
  }
  async getCredential(_accountId: string, _itemId: string): Promise<SensitiveCredential> {
    return { title: "CMS Login", username: "mira", password: "Password123", urls: ["https://example.com"] };
  }
}

class MockDeliveryProvider implements DeliveryProvider {
  readonly id = "mock-delivery";
  readonly displayName = "Mock Delivery";
  readonly inputs: CreateDeliveryInput[] = [];
  private counter = 0;
  async getCapabilities(): Promise<DeliveryProviderCapabilities> {
    return {
      externalLinks: true,
      recipientEmailRestriction: false,
      arbitraryViewLimit: true,
      viewOnce: true,
      customExpiry: true,
      accessPassword: false,
      hideText: false,
      revokeLink: true,
      accessCount: true
    };
  }
  async testConnection(_accountId: string): Promise<ConnectionResult> {
    return { ok: true, status: "unlocked" };
  }
  async createDelivery(input: CreateDeliveryInput): Promise<DeliveryResult> {
    this.counter += 1;
    this.inputs.push(input);
    return { deliveryId: `mock-${this.counter}`, url: `https://mock.local/send/${this.counter}`, expiresAt: input.expiresAt, viewLimit: input.viewLimit };
  }
  async revoke(_accountId: string, _deliveryId: string): Promise<void> {}
  async getStatus(_accountId: string, deliveryId: string): Promise<DeliveryStatus> {
    return { deliveryId, status: "active", accessCount: 1 };
  }
}

class LockTrackingCredentialProvider extends MockCredentialProvider {
  readonly id = "lock-tracking";
  readonly displayName = "Lock Tracking";
  readonly locked: string[] = [];
  async lock(accountId: string): Promise<void> {
    this.locked.push(accountId);
  }
}

function ageSession(sessions: AccountSessionManager, accountId: string, lastActivityAt: Date) {
  const exposed = sessions as unknown as { sessions: Map<string, { lastActivityAt?: Date }> };
  const session = exposed.sessions.get(accountId);
  if (!session) throw new Error(`Missing test session: ${accountId}`);
  session.lastActivityAt = lastActivityAt;
}
