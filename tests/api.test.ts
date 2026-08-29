import { afterEach, describe, expect, it, vi } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
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
  TerminalSessionHandoffIdentity,
  ProviderUnlockInput,
  SensitiveCredential,
  CreateDeliveryInput
} from "@wardsen/core";
import { InMemoryWardSenRepository } from "@wardsen/database";
import { buildApp } from "../apps/server/src/app";
import { EntePasteManualDeliveryProvider } from "../packages/delivery-ente-paste/src";
import { GithubReleaseUpdateService } from "../apps/server/src/releaseUpdateService";

describe("WardSen API", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("serves health only through local host requests", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/api/health", headers: { host: "127.0.0.1:4777" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().telemetry).toBe(false);
    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(response.headers["content-security-policy"]).toContain("connect-src 'self'");
    expect(response.headers["content-security-policy"]).not.toContain("127.0.0.1:*");
    await app.close();
  });

  it("checks published WardSen releases through the local API without exposing a download action", async () => {
    const releaseUpdateService = new GithubReleaseUpdateService({
      fetch: vi.fn(async () => new Response(JSON.stringify([
        { tag_name: "v0.1.0-rc.68", draft: false, prerelease: true, published_at: "2026-08-27T09:00:00Z" }
      ]), { status: 200 })) as typeof globalThis.fetch,
      now: () => Date.parse("2026-08-27T10:00:00Z")
    });
    const app = await buildApp({ releaseUpdateService });
    const response = await app.inject({ method: "GET", url: "/api/release-update?currentVersion=v0.1.0-rc.67", headers: { host: "127.0.0.1:4777" } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({
      currentVersion: "v0.1.0-rc.67",
      updateAvailable: true,
      release: expect.objectContaining({ tag: "v0.1.0-rc.68", pageUrl: "https://github.com/subtlesayak/WardSen/releases/tag/v0.1.0-rc.68" })
    }));
    await app.close();
  });

  it("rejects invalid installed versions before requesting release metadata", async () => {
    const fetch = vi.fn(async () => new Response("[]", { status: 200 }));
    const app = await buildApp({ releaseUpdateService: new GithubReleaseUpdateService({ fetch: fetch as typeof globalThis.fetch }) });
    const response = await app.inject({ method: "GET", url: "/api/release-update?currentVersion=not-a-version", headers: { host: "127.0.0.1:4777" } });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("installed version is invalid");
    expect(fetch).not.toHaveBeenCalled();
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

  it("rejects missing desktop API tokens outside test or explicit unauthenticated modes", async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousAllow = process.env.WARDSEN_ALLOW_UNAUTHENTICATED_LOCAL_API;
    process.env.NODE_ENV = "production";
    delete process.env.WARDSEN_ALLOW_UNAUTHENTICATED_LOCAL_API;
    const app = await buildApp();

    try {
      const response = await app.inject({ method: "GET", url: "/api/health", headers: { host: "127.0.0.1:4777" } });
      expect(response.statusCode).toBe(401);
      expect(response.json().error).toContain("desktop API token");
    } finally {
      await app.close();
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousAllow === undefined) delete process.env.WARDSEN_ALLOW_UNAUTHENTICATED_LOCAL_API;
      else process.env.WARDSEN_ALLOW_UNAUTHENTICATED_LOCAL_API = previousAllow;
    }
  });

  it("allows trusted desktop preflight before token-authenticated requests", async () => {
    const app = await buildApp({ apiToken: "desktop-token" });
    const preflight = await app.inject({
      method: "OPTIONS",
      url: "/api/providers",
      headers: {
        host: "127.0.0.1:4777",
        origin: "tauri://localhost",
        "access-control-request-method": "GET",
        "access-control-request-headers": "x-wardsen-api-token,x-wardsen-employee-session"
      }
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe("tauri://localhost");
    expect(preflight.headers["access-control-allow-headers"]).toContain("x-wardsen-api-token");
    expect(preflight.headers["access-control-allow-headers"]).toContain("x-wardsen-employee-session");

    const accepted = await app.inject({
      method: "GET",
      url: "/api/providers",
      headers: { host: "127.0.0.1:4777", origin: "tauri://localhost", "x-wardsen-api-token": "desktop-token" }
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.headers["access-control-allow-origin"]).toBe("tauri://localhost");
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
    expect(body.credentialProviders).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "bitwarden", maturity: "active", enabledByDefault: true }),
      expect.objectContaining({ id: "keepassxc", maturity: "active", enabledByDefault: true })
    ]));
    expect(body.credentialProviders.some((provider: { id: string }) => provider.id === "onepassword")).toBe(false);
    expect(body.plannedProviders).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "onepassword", maturity: "planned", enabledByDefault: false }),
      expect.objectContaining({ id: "proton-pass", maturity: "planned", enabledByDefault: false }),
      expect.objectContaining({ id: "keeper", maturity: "planned", enabledByDefault: false }),
      expect.objectContaining({ id: "onepassword-item-share", maturity: "planned", enabledByDefault: false })
    ]));
    expect(body.deliveryProviders).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "bitwarden-send", maturity: "active", enabledByDefault: true })
    ]));
    expect(body.deliveryProviders.some((provider: { id: string }) => provider.id === "password-pusher")).toBe(false);
    expect(body.deliveryProviders.some((provider: { id: string }) => provider.id === "onetime-secret")).toBe(false);
    expect(body.deliveryProviders.some((provider: { id: string }) => provider.id === "yopass")).toBe(false);
    expect(body.deliveryProviders.some((provider: { id: string }) => provider.id === "ente-paste")).toBe(false);
    expect(body.optionalDeliveryProviders).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "password-pusher",
        maturity: "active",
        enabledByDefault: false,
        requiresExplicitOptIn: true,
        configurationRequired: true,
        setupInstructions: expect.arrayContaining([expect.stringContaining("WARDSEN_PASSWORD_PUSHER_API_TOKEN")]),
        delivery: expect.objectContaining({ revoke: "supported", statusLookup: "supported", accessCount: "unsupported" })
      }),
      expect.objectContaining({
        id: "onetime-secret",
        maturity: "active",
        enabledByDefault: false,
        requiresExplicitOptIn: true,
        configurationRequired: true,
        setupInstructions: expect.arrayContaining([expect.stringContaining("WARDSEN_ONETIME_SECRET_USERNAME")]),
        delivery: expect.objectContaining({ revoke: "supported", statusLookup: "supported", accessCount: "unsupported" })
      }),
      expect.objectContaining({
        id: "yopass",
        maturity: "active",
        enabledByDefault: false,
        requiresExplicitOptIn: true,
        optInWarning: expect.stringContaining("cannot revoke"),
        setupInstructions: expect.arrayContaining([expect.stringContaining("WARDSEN_YOPASS_CLI_PATH")]),
        delivery: expect.objectContaining({ revoke: "unsupported", statusLookup: "unsupported", accessCount: "unsupported" })
      }),
      expect.objectContaining({
        id: "ente-paste",
        maturity: "experimental",
        enabledByDefault: false,
        requiresExplicitOptIn: true,
        optInWarning: expect.stringContaining("cannot revoke"),
        delivery: expect.objectContaining({
          integrationSurface: "web_only",
          secureLinkCreation: "manual",
          revoke: "unsupported",
          statusLookup: "unsupported"
        }),
        capabilities: expect.objectContaining({
          externalLinks: true,
          viewOnce: true,
          revokeLink: false,
          statusLookup: false
        })
      })
    ]));
    await app.close();
  });

  it("requires local API configuration before enabling API-backed delivery providers", async () => {
    const previousPasswordPusherToken = process.env.WARDSEN_PASSWORD_PUSHER_API_TOKEN;
    const previousOnetimeSecretUsername = process.env.WARDSEN_ONETIME_SECRET_USERNAME;
    const previousOnetimeSecretToken = process.env.WARDSEN_ONETIME_SECRET_API_TOKEN;
    delete process.env.WARDSEN_PASSWORD_PUSHER_API_TOKEN;
    delete process.env.WARDSEN_ONETIME_SECRET_USERNAME;
    delete process.env.WARDSEN_ONETIME_SECRET_API_TOKEN;
    const app = await buildApp();
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };

    try {
      for (const providerId of ["password-pusher", "onetime-secret"]) {
        const response = await app.inject({
          method: "POST",
          url: `/api/delivery-providers/${providerId}/opt-in`,
          headers,
          payload: { confirm: `ENABLE WEAKER PROVIDER ${providerId}` }
        });
        expect(response.statusCode).toBe(400);
        expect(response.json().error).toContain("WARDSEN_");
      }
    } finally {
      await app.close();
      if (previousPasswordPusherToken === undefined) delete process.env.WARDSEN_PASSWORD_PUSHER_API_TOKEN;
      else process.env.WARDSEN_PASSWORD_PUSHER_API_TOKEN = previousPasswordPusherToken;
      if (previousOnetimeSecretUsername === undefined) delete process.env.WARDSEN_ONETIME_SECRET_USERNAME;
      else process.env.WARDSEN_ONETIME_SECRET_USERNAME = previousOnetimeSecretUsername;
      if (previousOnetimeSecretToken === undefined) delete process.env.WARDSEN_ONETIME_SECRET_API_TOKEN;
      else process.env.WARDSEN_ONETIME_SECRET_API_TOKEN = previousOnetimeSecretToken;
    }
  });

  it("enables API-backed delivery providers only after their local configuration check passes", async () => {
    const previousPasswordPusherToken = process.env.WARDSEN_PASSWORD_PUSHER_API_TOKEN;
    const previousOnetimeSecretUsername = process.env.WARDSEN_ONETIME_SECRET_USERNAME;
    const previousOnetimeSecretToken = process.env.WARDSEN_ONETIME_SECRET_API_TOKEN;
    process.env.WARDSEN_PASSWORD_PUSHER_API_TOKEN = "test-password-pusher-token";
    process.env.WARDSEN_ONETIME_SECRET_USERNAME = "test-onetime-secret-user";
    process.env.WARDSEN_ONETIME_SECRET_API_TOKEN = "test-onetime-secret-token";
    const app = await buildApp();
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };

    try {
      for (const providerId of ["password-pusher", "onetime-secret"]) {
        const response = await app.inject({
          method: "POST",
          url: `/api/delivery-providers/${providerId}/opt-in`,
          headers,
          payload: { confirm: `ENABLE WEAKER PROVIDER ${providerId}` }
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ providerId, enabled: true });
      }
    } finally {
      await app.close();
      if (previousPasswordPusherToken === undefined) delete process.env.WARDSEN_PASSWORD_PUSHER_API_TOKEN;
      else process.env.WARDSEN_PASSWORD_PUSHER_API_TOKEN = previousPasswordPusherToken;
      if (previousOnetimeSecretUsername === undefined) delete process.env.WARDSEN_ONETIME_SECRET_USERNAME;
      else process.env.WARDSEN_ONETIME_SECRET_USERNAME = previousOnetimeSecretUsername;
      if (previousOnetimeSecretToken === undefined) delete process.env.WARDSEN_ONETIME_SECRET_API_TOKEN;
      else process.env.WARDSEN_ONETIME_SECRET_API_TOKEN = previousOnetimeSecretToken;
    }
  });

  it("requires an exact opt-in before weaker delivery providers are available", async () => {
    const app = await buildApp();
    const headers = { host: "127.0.0.1:4777" };

    const blocked = await app.inject({
      method: "POST",
      url: "/api/deliveries",
      headers,
      payload: {
        sourceProviderId: "bitwarden",
        sourceAccountId: "source-account",
        sourceItemId: "source-item",
        deliveryProviderId: "yopass",
        deliveryAccountId: "delivery-account",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        deliveryMethod: "copy"
      }
    });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error).toContain("disabled by default");

    const missingConfirmation = await app.inject({ method: "POST", url: "/api/delivery-providers/yopass/opt-in", headers, payload: {} });
    expect(missingConfirmation.statusCode).toBe(400);

    const enabled = await app.inject({
      method: "POST",
      url: "/api/delivery-providers/yopass/opt-in",
      headers,
      payload: { confirm: "ENABLE WEAKER PROVIDER yopass" }
    });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json()).toEqual({ providerId: "yopass", enabled: true });

    const afterOptIn = await app.inject({ method: "GET", url: "/api/providers", headers });
    expect(afterOptIn.json().deliveryProviders).toEqual(expect.arrayContaining([expect.objectContaining({ id: "yopass", enabled: true })]));

    const disabled = await app.inject({
      method: "DELETE",
      url: "/api/delivery-providers/yopass/opt-in",
      headers,
      payload: { confirm: "DISABLE WEAKER PROVIDER yopass" }
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json()).toEqual({ providerId: "yopass", enabled: false });
    await app.close();
  });

  it("checks non-Bitwarden delivery provider configuration without accepting provider secrets from the UI", async () => {
    const app = await buildApp();
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };

    const manual = await app.inject({ method: "POST", url: "/api/delivery-providers/ente-paste/test", headers });
    expect(manual.statusCode).toBe(200);
    expect(manual.json()).toMatchObject({ providerId: "ente-paste", ready: true, status: "unlocked" });

    const bitwarden = await app.inject({ method: "POST", url: "/api/delivery-providers/bitwarden-send/test", headers });
    expect(bitwarden.statusCode).toBe(400);
    expect(bitwarden.json().error).toContain("selected unlocked Bitwarden account");
    await app.close();
  });

  it("rejects account creation for planned providers that are not registered as functional", async () => {
    const app = await buildApp();
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };

    const response = await app.inject({
      method: "POST",
      url: "/api/accounts",
      headers,
      payload: { id: "future", providerId: "onepassword", label: "Future provider" }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe("Unknown credential provider: onepassword");
    await app.close();
  });

  it("creates, updates and deletes account metadata", async () => {
    const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "wardsen-account-metadata-"));
    const app = await buildApp({ profileRoot: path.join(workingDirectory, "profiles") });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    try {
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
    } finally {
      await app.close();
      fs.rmSync(workingDirectory, { recursive: true, force: true });
    }
  });

  it("manages provider profile directories instead of accepting caller-supplied paths", async () => {
    const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "wardsen-test-profiles-api-"));
    const profileRoot = path.join(workingDirectory, "profiles");
    const app = await buildApp({ profileRoot });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/accounts",
        headers,
        payload: { id: "ops", providerId: "bitwarden", label: "Operations", profileDirectory: "D:\\Outside\\Bitwarden" }
      });
      expect(created.statusCode).toBe(200);
      expect(created.json().profileDirectory).toBe(path.resolve(profileRoot, "ops"));

      const updated = await app.inject({
        method: "PUT",
        url: "/api/accounts/ops",
        headers,
        payload: { label: "Operations 2", profileDirectory: "D:\\StillOutside" }
      });
      expect(updated.statusCode).toBe(200);
      expect(updated.json().profileDirectory).toBe(path.resolve(profileRoot, "ops"));

      const escaped = await app.inject({
        method: "POST",
        url: "/api/accounts",
        headers,
        payload: { id: "..\\escape", providerId: "bitwarden", label: "Escape" }
      });
      expect(escaped.statusCode).toBe(400);
      expect(escaped.json().error).toContain("Account id cannot contain path separators");
    } finally {
      await app.close();
      fs.rmSync(workingDirectory, { recursive: true, force: true });
    }
  });

  it("rejects stored profile paths and linked profile directories before provider commands run", async () => {
    const workingDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "wardsen-profile-isolation-"));
    const profileRoot = path.join(workingDirectory, "profiles");
    const outsideDirectory = path.join(workingDirectory, "outside");
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    const repository = new InMemoryWardSenRepository();
    const app = await buildApp({ profileRoot, repository });

    try {
      const created = await app.inject({
        method: "POST",
        url: "/api/accounts",
        headers,
        payload: { id: "ops", providerId: "bitwarden", label: "Operations" }
      });
      expect(created.statusCode).toBe(200);

      const account = created.json();
      await repository.upsertAccount({
        ...account,
        profileDirectory: outsideDirectory
      });
      const storedPath = await app.inject({ method: "GET", url: "/api/accounts/ops/status", headers });
      expect(storedPath.statusCode).toBe(400);
      expect(storedPath.json().error).toContain("not managed by WardSen");

      await repository.upsertAccount({
        ...account,
        profileDirectory: path.join(profileRoot, "ops")
      });
      fs.mkdirSync(profileRoot, { recursive: true });
      fs.mkdirSync(outsideDirectory, { recursive: true });
      fs.symlinkSync(outsideDirectory, path.join(profileRoot, "ops"), process.platform === "win32" ? "junction" : "dir");

      const linkedPath = await app.inject({ method: "GET", url: "/api/accounts/ops/status", headers });
      expect(linkedPath.statusCode).toBe(400);
      expect(linkedPath.json().error).toContain("symlink or reparse point");
    } finally {
      await app.close();
      fs.rmSync(workingDirectory, { recursive: true, force: true });
    }
  });

  it("rejects provider changes after account creation to preserve profile isolation", async () => {
    const app = await buildApp();
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({
      method: "POST",
      url: "/api/accounts",
      headers,
      payload: { id: "ops", providerId: "bitwarden", label: "Operations" }
    });

    const changed = await app.inject({
      method: "PUT",
      url: "/api/accounts/ops",
      headers,
      payload: { providerId: "mock-source", label: "Moved" }
    });

    expect(changed.statusCode).toBe(400);
    expect(changed.json().error).toContain("Account provider cannot be changed");
    await app.close();
  });

  it("returns live in-memory session status with account metadata", async () => {
    const sessions = new AccountSessionManager();
    const app = await buildApp({ sessions, credentialProviders: [new MockCredentialProvider()] });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({
      method: "POST",
      url: "/api/accounts",
      headers,
      payload: { id: "source", providerId: "mock-source", label: "Mock source" }
    });

    sessions.markUnlocked("source", "mock-source", "token");
    const accounts = await app.inject({ method: "GET", url: "/api/accounts", headers: { host: "127.0.0.1:4777" } });

    expect(accounts.json()[0]).toMatchObject({ id: "source", status: "unlocked" });
    expect(accounts.json()[0].lastActivity).toBeTruthy();
    await app.close();
  });

  it("defaults new accounts to a ten-minute auto-lock", async () => {
    const app = await buildApp({ credentialProviders: [new MockCredentialProvider()] });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };

    const created = await app.inject({
      method: "POST",
      url: "/api/accounts",
      headers,
      payload: { id: "source", providerId: "mock-source", label: "Mock source" }
    });

    expect(created.json()).toMatchObject({ autoLockMinutes: 10 });
    await app.close();
  });

  it("uses a one-time authenticated, memory-only terminal session handoff", async () => {
    const sessions = new AccountSessionManager();
    const provider = new TerminalHandoffCredentialProvider();
    const app = await buildApp({
      apiToken: "desktop-token",
      registerBuiltInProviders: false,
      sessions,
      credentialProviders: [provider]
    });
    const desktopHeaders = {
      host: "127.0.0.1:4777",
      origin: "http://127.0.0.1:4777",
      "x-wardsen-api-token": "desktop-token"
    };
    await app.inject({
      method: "POST",
      url: "/api/accounts",
      headers: desktopHeaders,
      payload: {
        id: "bitwarden-account",
        providerId: "bitwarden",
        label: "Work",
        username: "work@example.test",
        serverUrl: "https://vault.example.test"
      }
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/accounts/bitwarden-account/terminal-handoff",
      headers: desktopHeaders,
      payload: { username: "work@example.test" }
    });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toEqual(expect.objectContaining({ command: expect.any(String), launchId: expect.any(String), expiresAt: expect.any(String) }));
    expect(provider.handoffs).toHaveLength(1);

    const launch = await app.inject({
      method: "GET",
      url: `/api/accounts/bitwarden-account/terminal-handoff/${created.json().launchId}/command`,
      headers: { host: "127.0.0.1:4777", "x-wardsen-api-token": "desktop-token" }
    });
    expect(launch.statusCode).toBe(200);
    expect(launch.body).toBe(created.json().command);

    const desktopTokenOnly = await app.inject({
      method: "POST",
      url: "/api/accounts/bitwarden-account/terminal-handoff/claim",
      headers: { ...desktopHeaders, "content-type": "text/plain; charset=utf-8" },
      payload: "terminal-session-raw"
    });
    expect(desktopTokenOnly.statusCode).toBe(401);

    const claim = await app.inject({
      method: "POST",
      url: "/api/accounts/bitwarden-account/terminal-handoff/claim",
      headers: {
        host: "127.0.0.1:4777",
        "content-type": "text/plain; charset=utf-8",
        "x-wardsen-terminal-handoff": provider.handoffs[0]!.token
      },
      payload: "terminal-session-raw"
    });
    expect(claim.statusCode).toBe(200);
    expect(provider.acceptedTokens).toEqual(["terminal-session-raw"]);
    expect(provider.acceptedIdentities).toEqual([{ username: "work@example.test", serverUrl: "https://vault.example.test", providerPrincipalId: undefined }]);
    expect(sessions.getSessionToken("bitwarden-account", "bitwarden")).toBe("terminal-session-raw");

    const unlockedAccounts = await app.inject({ method: "GET", url: "/api/accounts", headers: desktopHeaders });
    expect(unlockedAccounts.json()[0]).toMatchObject({ id: "bitwarden-account", status: "unlocked", providerPrincipalId: "user-work" });

    const replay = await app.inject({
      method: "POST",
      url: "/api/accounts/bitwarden-account/terminal-handoff/claim",
      headers: { ...desktopHeaders, "content-type": "text/plain; charset=utf-8" },
      payload: "terminal-session-raw"
    });
    expect(replay.statusCode).toBe(401);

    provider.providerPrincipalId = "user-other";
    const changedIdentityHandoff = await app.inject({
      method: "POST",
      url: "/api/accounts/bitwarden-account/terminal-handoff",
      headers: desktopHeaders,
      payload: { username: "work@example.test" }
    });
    const changedIdentityClaim = await app.inject({
      method: "POST",
      url: "/api/accounts/bitwarden-account/terminal-handoff/claim",
      headers: {
        host: "127.0.0.1:4777",
        "content-type": "text/plain; charset=utf-8",
        "x-wardsen-terminal-handoff": provider.handoffs[1]!.token
      },
      payload: "candidate-session-other-user"
    });
    expect(changedIdentityHandoff.statusCode).toBe(200);
    expect(changedIdentityClaim.statusCode).toBe(401);
    expect(changedIdentityClaim.json().error).toBe("WardSen could not verify the Bitwarden terminal session. Start Terminal login / unlock again for this account.");
    expect(() => sessions.getSessionToken("bitwarden-account", "bitwarden")).toThrow();

    const audit = await app.inject({ method: "GET", url: "/api/audit-log", headers: desktopHeaders });
    expect(JSON.stringify(audit.json())).not.toContain("terminal-session-raw");
    expect(JSON.stringify(audit.json())).not.toContain(provider.handoffs[0]!.token);
    expect(JSON.stringify(audit.json())).not.toContain(created.json().command);
    expect(JSON.stringify(audit.json())).not.toContain("candidate-session-other-user");
    expect(JSON.stringify(audit.json())).toContain("reason=user_id_mismatch");
    await app.close();
  });

  it("requires legacy Bitwarden accounts to be edited with a login email before terminal handoff", async () => {
    const app = await buildApp({ registerBuiltInProviders: false, credentialProviders: [new TerminalHandoffCredentialProvider()] });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({
      method: "POST",
      url: "/api/accounts",
      headers,
      payload: { id: "legacy-bitwarden", providerId: "bitwarden", label: "Legacy" }
    });

    const handoff = await app.inject({
      method: "POST",
      url: "/api/accounts/legacy-bitwarden/terminal-handoff",
      headers,
      payload: { username: "work@example.test" }
    });
    expect(handoff.statusCode).toBe(400);
    expect(handoff.json().error).toBe("Edit this Bitwarden account to add its login email before using Terminal login / unlock.");
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

    const archiveWithoutConfirmation = await app.inject({ method: "DELETE", url: "/api/people/person-1", headers });
    expect(archiveWithoutConfirmation.statusCode).toBe(400);
    expect(archiveWithoutConfirmation.json().error).toBe("Destructive action requires confirmation phrase: OFFBOARD PERSON person-1");
    expect((await app.inject({ method: "DELETE", url: "/api/people/person-1", headers, payload: { confirm: "OFFBOARD PERSON person-1" } })).json().archived).toBe(true);
    expect((await app.inject({ method: "POST", url: "/api/people/person-1/restore", headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: "/api/people/person-1?hard=true", headers, payload: { confirm: "DELETE PERSON person-1" } })).json().deleted).toBe(true);
    await app.close();
  });

  it("previews offboarding, batch cancellation and batch link revocation without returning delivery URLs", async () => {
    const repository = new InMemoryWardSenRepository();
    await repository.upsertPerson({ id: "person-preview", name: "Preview Person", email: "preview@example.com" });
    await repository.createBatch({ id: "batch-preview", requestedCount: 2, completedCount: 2, failedCount: 0, cancelled: false });
    await repository.createDelivery({
      id: "delivery-preview", sourceProviderId: "mock-source", sourceAccountId: "source", sourceItemId: "preview-item", deliveryProviderId: "mock-delivery", deliveryAccountId: "delivery", credentialName: "Preview credential", personId: "person-preview", batchId: "batch-preview", expiresAt: new Date(Date.now() + 3600000).toISOString(), status: "active", providerDeliveryId: "provider-preview"
    });
    const app = await buildApp({ repository, credentialProviders: [new MockCredentialProvider()], deliveryProviders: [new MockDeliveryProvider()] });
    const headers = { host: "127.0.0.1:4777" };

    const [personPreview, batchPreview, revokePreview] = await Promise.all([
      app.inject({ method: "GET", url: "/api/people/person-preview/operation-preview", headers }),
      app.inject({ method: "GET", url: "/api/batches/batch-preview/operation-preview", headers }),
      app.inject({ method: "GET", url: "/api/deliveries/delivery-preview/revoke-batch/operation-preview", headers })
    ]);

    for (const preview of [personPreview, batchPreview, revokePreview]) {
      expect(preview.statusCode).toBe(200);
      expect(preview.body).toContain("Preview credential");
      expect(preview.body).toContain("Mock Delivery");
      expect(preview.body).not.toContain("https://");
    }
    expect(personPreview.json().impact.affectedPeople).toContain("Preview Person");
    expect(batchPreview.json().impact.activeDeliveryCount).toBe(1);
    await app.close();
  });

  it("reports provider diagnostics without exposing local configuration values", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/api/provider-diagnostics/ente-paste", headers: { host: "127.0.0.1:4777" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      providerId: "ente-paste",
      runtime: { kind: "browser", version: "Not applicable" },
      authentication: { state: "not applicable" },
      linkPreviewRisk: expect.stringContaining("WardSen cannot see")
    });
    await app.close();
  });

  it("verifies an operator-selected Bitwarden CLI path before storing it locally", async () => {
    const repository = new InMemoryWardSenRepository();
    const app = await buildApp({ repository });
    const headers = { host: "127.0.0.1:4777" };

    const rejected = await app.inject({
      method: "POST",
      url: "/api/provider-tools/bitwarden/locate",
      headers,
      payload: { executablePath: "bw", trustAcknowledged: true }
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error).toContain("absolute path");

    const missingAcknowledgement = await app.inject({
      method: "POST",
      url: "/api/provider-tools/bitwarden/locate",
      headers,
      payload: { executablePath: process.execPath }
    });
    expect(missingAcknowledgement.statusCode).toBe(400);

    const configured = await app.inject({
      method: "POST",
      url: "/api/provider-tools/bitwarden/locate",
      headers,
      payload: { executablePath: process.execPath, trustAcknowledged: true }
    });
    expect(configured.statusCode).toBe(200);
    expect(configured.json()).toMatchObject({ providerId: "bitwarden", configured: true, version: expect.any(String) });
    expect(configured.body).not.toContain(process.execPath);
    expect(await repository.getLocalSetting("provider.bitwarden.cli_path")).toBe(process.execPath);

    const [diagnostics, audit] = await Promise.all([
      app.inject({ method: "GET", url: "/api/provider-diagnostics/bitwarden", headers }),
      app.inject({ method: "GET", url: "/api/audit-log", headers })
    ]);
    expect(diagnostics.statusCode).toBe(200);
    expect(diagnostics.json()).toMatchObject({ runtime: { binaryFound: true, detail: expect.stringContaining("operator-selected") } });
    expect(diagnostics.body).not.toContain(process.execPath);
    expect(audit.body).toContain("provider.cli_path_configured");
    expect(audit.body).not.toContain(process.execPath);
    await app.close();

    const restarted = await buildApp({ repository });
    const afterRestart = await restarted.inject({ method: "GET", url: "/api/provider-diagnostics/bitwarden", headers });
    expect(afterRestart.statusCode).toBe(200);
    expect(afterRestart.json()).toMatchObject({ runtime: { binaryFound: true, detail: expect.stringContaining("operator-selected") } });
    expect(afterRestart.body).not.toContain(process.execPath);
    await restarted.close();
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

  it("rate limits repeated provider login attempts", async () => {
    const provider = new MockCredentialProvider();
    const app = await buildApp({ credentialProviders: [provider] });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "login-account", providerId: "mock-source", label: "Login account" } });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await app.inject({ method: "POST", url: "/api/accounts/login-account/login", headers, payload: {} });
      expect(response.statusCode).toBe(200);
    }
    const limited = await app.inject({ method: "POST", url: "/api/accounts/login-account/login", headers, payload: {} });
    expect(limited.statusCode).toBe(429);
    expect(provider.loginCalls).toHaveLength(5);
    await app.close();
  });

  it("limits all local requests before authorization", async () => {
    const app = await buildApp({ apiToken: "desktop-token" });
    const authorizedHeaders = { host: "127.0.0.1:4777", "x-wardsen-api-token": "desktop-token" };

    for (let request = 0; request < 120; request += 1) {
      expect((await app.inject({ method: "GET", url: "/api/health", headers: authorizedHeaders })).statusCode).toBe(200);
    }

    const limited = await app.inject({ method: "GET", url: "/api/health", headers: { host: "127.0.0.1:4777" } });
    expect(limited.statusCode).toBe(429);
    await app.close();
  });

  it("enforces assigned-email credential requests and lets admins approve to delivery", async () => {
    const deliveryProvider = new MockDeliveryProvider();
    const app = await buildApp({
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [deliveryProvider]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "delivery", providerId: "mock-source", label: "Mock delivery" } });
    await app.inject({
      method: "POST",
      url: "/api/people",
      headers,
      payload: { id: "person-ravi", name: "Ravi Menon", email: "ravi@example.com", groupName: "Ops", role: "Engineer" }
    });

    const employee = await app.inject({
      method: "POST",
      url: "/api/employees",
      headers,
      payload: { id: "employee-1", personId: "person-ravi", name: "Ravi", assignedEmail: "Ravi@Example.com", team: "Ops", role: "Engineer" }
    });
    expect(employee.statusCode).toBe(200);
    expect(employee.json()).toMatchObject({ id: "employee-1", personId: "person-ravi", assignedEmail: "ravi@example.com" });

    const mismatchedPersonLink = await app.inject({
      method: "POST",
      url: "/api/employees",
      headers,
      payload: { id: "employee-wrong-link", personId: "person-ravi", name: "Wrong Link", assignedEmail: "wrong@example.com" }
    });
    expect(mismatchedPersonLink.statusCode).toBe(400);
    expect(mismatchedPersonLink.json().error).toContain("must match the linked person's email");

    const otherEmployee = await app.inject({
      method: "POST",
      url: "/api/employees",
      headers,
      payload: { id: "employee-2", name: "Nia", assignedEmail: "nia@example.com", team: "Finance" }
    });
    expect(otherEmployee.statusCode).toBe(200);

    const emailChange = await app.inject({
      method: "PUT",
      url: "/api/employees/employee-1",
      headers,
      payload: { assignedEmail: "someone-else@example.com" }
    });
    expect(emailChange.statusCode).toBe(400);
    expect(emailChange.json().error).toContain("assigned email is admin-controlled");

    const employeeUpdate = await app.inject({
      method: "PUT",
      url: "/api/employees/employee-2",
      headers,
      payload: { name: "Nia Shah", team: "Finance Operations", role: "Reviewer" }
    });
    expect(employeeUpdate.statusCode).toBe(200);
    expect(employeeUpdate.json()).toMatchObject({ id: "employee-2", name: "Nia Shah", assignedEmail: "nia@example.com", team: "Finance Operations", role: "Reviewer", active: true });

    const personUpdate = await app.inject({
      method: "PUT",
      url: "/api/people/person-ravi",
      headers,
      payload: { name: "Ravi Menon", notes: "Primary request approver." }
    });
    expect(personUpdate.statusCode).toBe(200);
    expect(personUpdate.json()).toMatchObject({ id: "person-ravi", notes: "Primary request approver." });

    await app.inject({
      method: "POST",
      url: "/api/people",
      headers,
      payload: { id: "person-asha", name: "Asha Rao", email: "asha@example.com", groupName: "Support" }
    });
    await app.inject({
      method: "POST",
      url: "/api/people",
      headers,
      payload: { id: "person-nia", name: "Nia", email: "nia@example.com", groupName: "Finance" }
    });
    await app.inject({
      method: "POST",
      url: "/api/people",
      headers,
      payload: { id: "person-no-email", name: "No Email" }
    });
    const unconfirmedBulkProvision = await app.inject({
      method: "POST",
      url: "/api/employees/bulk-from-people",
      headers,
      payload: { personIds: ["person-asha"], confirmRiskSummary: true }
    });
    expect(unconfirmedBulkProvision.statusCode).toBe(400);

    const bulkProvision = await app.inject({
      method: "POST",
      url: "/api/employees/bulk-from-people",
      headers,
      payload: {
        personIds: ["person-asha", "person-nia", "person-no-email"],
        confirm: "PROVISION EMPLOYEES FROM PEOPLE",
        confirmRiskSummary: true,
        defaultRole: "Member"
      }
    });
    expect(bulkProvision.statusCode).toBe(200);
    expect(bulkProvision.json().created).toHaveLength(1);
    expect(bulkProvision.json().created[0]).toMatchObject({ personId: "person-asha", assignedEmail: "asha@example.com", team: "Support", role: "Member" });
    expect(bulkProvision.json().skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ personId: "person-nia", reason: "Assigned email already has an employee identity." }),
      expect.objectContaining({ personId: "person-no-email", reason: "Person has no assigned email." })
    ]));

    const catalog = await app.inject({
      method: "POST",
      url: "/api/credential-catalog",
      headers,
      payload: {
        id: "catalog-1",
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms",
        credentialName: "CMS Login",
        username: "mira",
        domain: "example.com",
        tags: ["prod"],
        riskTier: "high",
        allowedEmployeeIds: ["employee-1"]
      }
    });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json()).toMatchObject({ id: "catalog-1", allowedEmployeeIds: ["employee-1"], allowedTeams: [], allowedRoles: [] });

    const emptyPolicyCatalog = await app.inject({
      method: "POST",
      url: "/api/credential-catalog",
      headers,
      payload: {
        id: "catalog-empty-policy",
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "empty",
        credentialName: "Empty Policy",
        allowedEmployeeIds: []
      }
    });
    expect(emptyPolicyCatalog.statusCode).toBe(400);
    expect(emptyPolicyCatalog.json().error).toContain("at least one allowed employee, team or role");

    const teamCatalog = await app.inject({
      method: "POST",
      url: "/api/credential-catalog",
      headers,
      payload: {
        id: "catalog-team",
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "ops-runbook",
        credentialName: "Ops Runbook",
        riskTier: "medium",
        allowedTeams: ["Ops"]
      }
    });
    expect(teamCatalog.statusCode).toBe(200);
    expect(teamCatalog.json()).toMatchObject({ id: "catalog-team", allowedEmployeeIds: [], allowedTeams: ["Ops"], allowedRoles: [] });

    const roleCatalog = await app.inject({
      method: "POST",
      url: "/api/credential-catalog",
      headers,
      payload: {
        id: "catalog-role",
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "deploy-root",
        credentialName: "Deploy Root",
        riskTier: "high",
        allowedRoles: ["Engineer"]
      }
    });
    expect(roleCatalog.statusCode).toBe(200);
    expect(roleCatalog.json()).toMatchObject({ id: "catalog-role", allowedEmployeeIds: [], allowedTeams: [], allowedRoles: ["Engineer"] });

    const autoApprovalCatalog = await app.inject({
      method: "POST",
      url: "/api/credential-catalog",
      headers,
      payload: {
        id: "catalog-auto-low",
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "vpn-low",
        credentialName: "VPN Low Risk",
        riskTier: "low",
        allowedEmployeeIds: ["employee-1"],
        autoApprovalPolicy: {
          maxRiskTier: "low",
          maxExpectedDurationMinutes: 120,
          requireTicketRef: true
        }
      }
    });
    expect(autoApprovalCatalog.statusCode).toBe(200);
    expect(autoApprovalCatalog.json()).toMatchObject({
      id: "catalog-auto-low",
      autoApprovalPolicy: {
        maxRiskTier: "low",
        maxExpectedDurationMinutes: 120,
        requireTicketRef: true
      }
    });

    const wrongCatalog = await app.inject({
      method: "GET",
      url: "/api/employee-catalog?employeeId=employee-1&assignedEmail=attacker@example.com",
      headers: { host: "127.0.0.1:4777" }
    });
    expect(wrongCatalog.statusCode).toBe(400);
    expect(wrongCatalog.json().error).toBe("Credential requests must use the employee assigned email.");

    const employeeCatalog = await app.inject({
      method: "GET",
      url: "/api/employee-catalog?employeeId=employee-1&assignedEmail=ravi@example.com",
      headers: { host: "127.0.0.1:4777" }
    });
    expect(employeeCatalog.statusCode).toBe(200);
    expect(employeeCatalog.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ credentialName: "CMS Login", username: "mira" }),
      expect.objectContaining({ credentialName: "Ops Runbook", allowedTeams: ["Ops"] }),
      expect.objectContaining({ credentialName: "Deploy Root", allowedRoles: ["Engineer"] })
    ]));
    expect(JSON.stringify(employeeCatalog.json())).not.toContain("Password123");

    const outsideCatalog = await app.inject({
      method: "GET",
      url: "/api/employee-catalog?employeeId=employee-2&assignedEmail=nia@example.com",
      headers: { host: "127.0.0.1:4777" }
    });
    expect(outsideCatalog.statusCode).toBe(200);
    expect(outsideCatalog.json().items).toEqual([]);

    const wrongRequest = await app.inject({
      method: "POST",
      url: "/api/credential-requests",
      headers,
      payload: {
        employeeId: "employee-1",
        assignedEmail: "other@example.com",
        catalogEntryId: "catalog-1",
        reason: "Emergency rollback"
      }
    });
    expect(wrongRequest.statusCode).toBe(400);

    const unauthorizedRequest = await app.inject({
      method: "POST",
      url: "/api/credential-requests",
      headers,
      payload: {
        employeeId: "employee-2",
        assignedEmail: "nia@example.com",
        catalogEntryId: "catalog-1",
        reason: "Need production access"
      }
    });
    expect(unauthorizedRequest.statusCode).toBe(400);
    expect(unauthorizedRequest.json().error).toBe("Employee is not allowed to request this credential catalog entry.");

    const breakGlassWithoutConfirmation = await app.inject({
      method: "POST",
      url: "/api/credential-requests",
      headers,
      payload: {
        employeeId: "employee-1",
        assignedEmail: "ravi@example.com",
        catalogEntryId: "catalog-1",
        reason: "Production incident response",
        breakGlass: true,
        breakGlassJustification: "Production incident needs immediate credential access"
      }
    });
    expect(breakGlassWithoutConfirmation.statusCode).toBe(400);
    expect(breakGlassWithoutConfirmation.json().error).toBe("Destructive action requires confirmation phrase: BREAK GLASS catalog-1");

    const breakGlassWithoutRiskConfirmation = await app.inject({
      method: "POST",
      url: "/api/credential-requests",
      headers,
      payload: {
        employeeId: "employee-1",
        assignedEmail: "ravi@example.com",
        catalogEntryId: "catalog-1",
        reason: "Production incident response",
        breakGlass: true,
        breakGlassJustification: "Production incident needs immediate credential access",
        confirm: "BREAK GLASS catalog-1"
      }
    });
    expect(breakGlassWithoutRiskConfirmation.statusCode).toBe(400);
    expect(breakGlassWithoutRiskConfirmation.json().error).toContain("Break-glass credential requests require confirmation");

    const breakGlassRequest = await app.inject({
      method: "POST",
      url: "/api/credential-requests",
      headers,
      payload: {
        employeeId: "employee-1",
        assignedEmail: "ravi@example.com",
        catalogEntryId: "catalog-1",
        reason: "Production incident response",
        breakGlass: true,
        breakGlassJustification: "Production incident needs immediate credential access",
        confirmRiskSummary: true,
        confirm: "BREAK GLASS catalog-1"
      }
    });
    expect(breakGlassRequest.statusCode).toBe(200);
    expect(breakGlassRequest.json()).toMatchObject({
      status: "break_glass",
      breakGlass: true,
      breakGlassJustification: "Production incident needs immediate credential access",
      assignedEmail: "ravi@example.com"
    });
    expect(breakGlassRequest.json().breakGlassConfirmedAt).toEqual(expect.any(String));

    const teamPolicyRequest = await app.inject({
      method: "POST",
      url: "/api/credential-requests",
      headers,
      payload: {
        employeeId: "employee-1",
        assignedEmail: "ravi@example.com",
        catalogEntryId: "catalog-team",
        reason: "Need team runbook access"
      }
    });
    expect(teamPolicyRequest.statusCode).toBe(200);

    const rolePolicyRequest = await app.inject({
      method: "POST",
      url: "/api/credential-requests",
      headers,
      payload: {
        employeeId: "employee-1",
        assignedEmail: "ravi@example.com",
        catalogEntryId: "catalog-role",
        reason: "Need deploy owner access"
      }
    });
    expect(rolePolicyRequest.statusCode).toBe(200);

    const missingTicketAutoRequest = await app.inject({
      method: "POST",
      url: "/api/credential-requests",
      headers,
      payload: {
        employeeId: "employee-1",
        assignedEmail: "ravi@example.com",
        catalogEntryId: "catalog-auto-low",
        reason: "Need VPN access",
        expectedDurationMinutes: 60
      }
    });
    expect(missingTicketAutoRequest.statusCode).toBe(200);
    expect(missingTicketAutoRequest.json()).toMatchObject({ status: "pending", credentialName: "VPN Low Risk" });

    const autoApprovedRequest = await app.inject({
      method: "POST",
      url: "/api/credential-requests",
      headers,
      payload: {
        employeeId: "employee-1",
        assignedEmail: "ravi@example.com",
        catalogEntryId: "catalog-auto-low",
        reason: "Need VPN access",
        ticketRef: "INC-123",
        expectedDurationMinutes: 60
      }
    });
    expect(autoApprovedRequest.statusCode).toBe(200);
    expect(autoApprovedRequest.json()).toMatchObject({
      status: "approved",
      approver: "WardSen auto-approval policy",
      decisionReason: expect.stringContaining("Admin confirmation still required before delivery")
    });

    const fulfilledAutoApprovedRequest = await app.inject({
      method: "POST",
      url: `/api/credential-requests/${autoApprovedRequest.json().id}/approve`,
      headers,
      payload: {
        approver: "admin@example.com",
        deliveryProviderId: "mock-delivery",
        deliveryAccountId: "delivery",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        viewLimit: 1,
        viewOnce: true,
        confirmRiskSummary: true
      }
    });
    expect(fulfilledAutoApprovedRequest.statusCode).toBe(200);
    expect(fulfilledAutoApprovedRequest.json().request).toMatchObject({ status: "fulfilled", deliveryProviderId: "mock-delivery" });
    expect(fulfilledAutoApprovedRequest.json().delivery.oneTimeDeliveryUrl).toMatch(/^https:\/\/mock.local\/send\//);

    const accessRequest = await app.inject({
      method: "POST",
      url: "/api/credential-requests",
      headers,
      payload: {
        employeeId: "employee-1",
        assignedEmail: "ravi@example.com",
        catalogEntryId: "catalog-1",
        reason: "Emergency rollback",
        expectedDurationMinutes: 60
      }
    });
    expect(accessRequest.statusCode).toBe(200);
    expect(accessRequest.json()).toMatchObject({
      employeeId: "employee-1",
      assignedEmail: "ravi@example.com",
      credentialName: "CMS Login",
      status: "pending"
    });

    const approvalWithoutConfirmation = await app.inject({
      method: "POST",
      url: `/api/credential-requests/${accessRequest.json().id}/approve`,
      headers,
      payload: {
        approver: "admin@example.com",
        deliveryProviderId: "mock-delivery",
        deliveryAccountId: "delivery",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        viewLimit: 1
      }
    });
    expect(approvalWithoutConfirmation.statusCode).toBe(400);
    expect(approvalWithoutConfirmation.json().error).toContain("requires confirmation");

    const approved = await app.inject({
      method: "POST",
      url: `/api/credential-requests/${accessRequest.json().id}/approve`,
      headers,
      payload: {
        approver: "admin@example.com",
        deliveryProviderId: "mock-delivery",
        deliveryAccountId: "delivery",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        viewLimit: 1,
        viewOnce: true,
        confirmRiskSummary: true
      }
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().request).toMatchObject({ status: "fulfilled", deliveryProviderId: "mock-delivery" });
    expect(approved.json().delivery.oneTimeDeliveryUrl).toMatch(/^https:\/\/mock.local\/send\//);
    expect(deliveryProvider.inputs[0].recipient).toMatchObject({ id: "employee-1", email: "ravi@example.com" });
    expect(JSON.stringify(approved.json())).not.toContain("Password123");

    const replacementWithoutConfirmation = await app.inject({
      method: "POST",
      url: `/api/credential-requests/${accessRequest.json().id}/replacement-link`,
      headers,
      payload: {
        approver: "admin@example.com",
        deliveryProviderId: "mock-delivery",
        deliveryAccountId: "delivery",
        expiresAt: new Date(Date.now() + 7200000).toISOString(),
        viewLimit: 1,
        viewOnce: true,
        replacementReason: "Unexpected access",
        confirmRiskSummary: true
      }
    });
    expect(replacementWithoutConfirmation.statusCode).toBe(400);
    expect(replacementWithoutConfirmation.json().error).toBe(`Destructive action requires confirmation phrase: REPLACE REQUEST ${accessRequest.json().id}`);

    const replacement = await app.inject({
      method: "POST",
      url: `/api/credential-requests/${accessRequest.json().id}/replacement-link`,
      headers,
      payload: {
        approver: "security@example.com",
        deliveryProviderId: "mock-delivery",
        deliveryAccountId: "delivery",
        expiresAt: new Date(Date.now() + 7200000).toISOString(),
        viewLimit: 1,
        viewOnce: true,
        replacementReason: "Unexpected access",
        confirmRiskSummary: true,
        confirm: `REPLACE REQUEST ${accessRequest.json().id}`
      }
    });
    expect(replacement.statusCode).toBe(200);
    expect(replacement.json().delivery.oneTimeDeliveryUrl).toMatch(/^https:\/\/mock.local\/send\//);
    expect(replacement.json().request).toMatchObject({
      id: accessRequest.json().id,
      status: "fulfilled",
      assignedEmail: "ravi@example.com",
      previousDeliveryId: approved.json().delivery.id,
      deliveryId: replacement.json().delivery.id,
      replacementCount: 1
    });
    expect(deliveryProvider.revoked).toContainEqual({ accountId: "delivery", deliveryId: approved.json().delivery.providerDeliveryId });
    const previousDelivery = await app.inject({
      method: "GET",
      url: `/api/deliveries/${approved.json().delivery.id}`,
      headers: { host: "127.0.0.1:4777" }
    });
    expect(previousDelivery.json()).toMatchObject({ status: "revoked", revokedAt: expect.any(String) });
    expect(JSON.stringify(replacement.json())).not.toContain("Password123");

    const requestList = await app.inject({ method: "GET", url: "/api/credential-requests?page=1&pageSize=10", headers: { host: "127.0.0.1:4777" } });
    const listedReplacementRequest = requestList.json().items.find((item: { id: string }) => item.id === accessRequest.json().id);
    expect(listedReplacementRequest).toMatchObject({ status: "fulfilled", assignedEmail: "ravi@example.com", replacementCount: 1, previousDeliveryId: approved.json().delivery.id });
    await app.close();
  });

  it("lets employees sign in with one-time codes and request only allowed catalog entries", async () => {
    const app = await buildApp({
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [new MockDeliveryProvider()]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });

    await app.inject({
      method: "POST",
      url: "/api/employees",
      headers,
      payload: { id: "employee-1", name: "Ravi", assignedEmail: "ravi@example.com", team: "Ops" }
    });
    await app.inject({
      method: "POST",
      url: "/api/employees",
      headers,
      payload: { id: "employee-2", name: "Nia", assignedEmail: "nia@example.com", team: "Finance" }
    });
    await app.inject({
      method: "POST",
      url: "/api/credential-catalog",
      headers,
      payload: {
        id: "catalog-1",
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms",
        credentialName: "CMS Login",
        username: "mira",
        domain: "example.com",
        tags: ["prod"],
        riskTier: "high",
        allowedEmployeeIds: ["employee-1"]
      }
    });
    await app.inject({
      method: "POST",
      url: "/api/credential-catalog",
      headers,
      payload: {
        id: "catalog-2",
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms-backup",
        credentialName: "Finance Backup",
        riskTier: "medium",
        allowedEmployeeIds: ["employee-2"]
      }
    });

    const noSession = await app.inject({
      method: "GET",
      url: "/api/employee-portal/catalog?page=1&pageSize=10",
      headers: { host: "127.0.0.1:4777" }
    });
    expect(noSession.statusCode).toBe(401);

    const issued = await app.inject({
      method: "POST",
      url: "/api/employees/employee-1/sign-in-code",
      headers,
      payload: { ttlMinutes: 10, senderEmail: "security@example.com" }
    });
    expect(issued.statusCode).toBe(200);
    expect(issued.json()).toMatchObject({
      employeeId: "employee-1",
      assignedEmail: "ravi@example.com",
      delivery: "email_draft",
      emailDraft: {
        senderEmail: "security@example.com",
        to: "ravi@example.com",
        subject: "WardSen employee portal sign-in code"
      }
    });
    expect(issued.json().code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{10}$/);
    expect(issued.json().emailDraft.body).toContain(issued.json().code);
    expect(issued.json().emailDraft.body).toContain("WardSen does not use a permanent employee password");
    expect(JSON.stringify(issued.json())).not.toContain("codeHash");

    const auditAfterIssue = await app.inject({ method: "GET", url: "/api/audit-log?page=1&pageSize=20", headers });
    expect(JSON.stringify(auditAfterIssue.json())).not.toContain(issued.json().code);

    const rejected = await app.inject({
      method: "POST",
      url: "/api/employee-sessions",
      headers,
      payload: { assignedEmail: "ravi@example.com", code: "WRONGCODE" }
    });
    expect(rejected.statusCode).toBe(401);

    const signedIn = await app.inject({
      method: "POST",
      url: "/api/employee-sessions",
      headers,
      payload: { assignedEmail: "ravi@example.com", code: issued.json().code }
    });
    expect(signedIn.statusCode).toBe(200);
    expect(signedIn.json()).toMatchObject({ employee: { id: "employee-1", assignedEmail: "ravi@example.com" } });
    expect(signedIn.json().sessionToken).toMatch(/^employee_/);

    const reused = await app.inject({
      method: "POST",
      url: "/api/employee-sessions",
      headers,
      payload: { assignedEmail: "ravi@example.com", code: issued.json().code }
    });
    expect(reused.statusCode).toBe(401);

    const employeeHeaders = {
      ...headers,
      "x-wardsen-employee-session": signedIn.json().sessionToken
    };
    const catalog = await app.inject({
      method: "GET",
      url: "/api/employee-portal/catalog?page=1&pageSize=10",
      headers: employeeHeaders
    });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().items).toEqual([expect.objectContaining({ id: "catalog-1", credentialName: "CMS Login" })]);
    expect(JSON.stringify(catalog.json())).not.toContain("Password123");
    expect(JSON.stringify(catalog.json())).not.toContain("Finance Backup");

    const deniedRequest = await app.inject({
      method: "POST",
      url: "/api/employee-portal/credential-requests",
      headers: employeeHeaders,
      payload: { catalogEntryId: "catalog-2", reason: "Need another team's secret" }
    });
    expect(deniedRequest.statusCode).toBe(400);

    const portalBreakGlassWithoutConfirmation = await app.inject({
      method: "POST",
      url: "/api/employee-portal/credential-requests",
      headers: employeeHeaders,
      payload: {
        catalogEntryId: "catalog-1",
        reason: "Production incident response",
        breakGlass: true,
        breakGlassJustification: "Production incident needs immediate credential access"
      }
    });
    expect(portalBreakGlassWithoutConfirmation.statusCode).toBe(400);
    expect(portalBreakGlassWithoutConfirmation.json().error).toBe("Destructive action requires confirmation phrase: BREAK GLASS catalog-1");

    const portalBreakGlassRequest = await app.inject({
      method: "POST",
      url: "/api/employee-portal/credential-requests",
      headers: employeeHeaders,
      payload: {
        catalogEntryId: "catalog-1",
        reason: "Production incident response",
        breakGlass: true,
        breakGlassJustification: "Production incident needs immediate credential access",
        confirmRiskSummary: true,
        confirm: "BREAK GLASS catalog-1"
      }
    });
    expect(portalBreakGlassRequest.statusCode).toBe(200);
    expect(portalBreakGlassRequest.json()).toMatchObject({
      employeeId: "employee-1",
      assignedEmail: "ravi@example.com",
      status: "break_glass",
      breakGlass: true
    });
    expect(portalBreakGlassRequest.json().breakGlassConfirmedAt).toEqual(expect.any(String));

    const accessRequest = await app.inject({
      method: "POST",
      url: "/api/employee-portal/credential-requests",
      headers: employeeHeaders,
      payload: {
        catalogEntryId: "catalog-1",
        reason: "Emergency deploy rollback",
        ticketRef: "INC-123",
        expectedDurationMinutes: 60
      }
    });
    expect(accessRequest.statusCode).toBe(200);
    expect(accessRequest.json()).toMatchObject({
      employeeId: "employee-1",
      assignedEmail: "ravi@example.com",
      catalogEntryId: "catalog-1",
      status: "pending"
    });

    const ownRequests = await app.inject({
      method: "GET",
      url: "/api/employee-portal/credential-requests?page=1&pageSize=10",
      headers: employeeHeaders
    });
    expect(ownRequests.statusCode).toBe(200);
    const listedAccessRequest = ownRequests.json().items.find((item: { id: string }) => item.id === accessRequest.json().id);
    expect(listedAccessRequest).toMatchObject({ id: accessRequest.json().id, assignedEmail: "ravi@example.com" });

    const logout = await app.inject({
      method: "POST",
      url: "/api/employee-sessions/current/logout",
      headers: employeeHeaders
    });
    expect(logout.statusCode).toBe(200);

    const afterLogout = await app.inject({
      method: "GET",
      url: "/api/employee-portal/me",
      headers: employeeHeaders
    });
    expect(afterLogout.statusCode).toBe(401);
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
    expect(cancelWithConfirmation.statusCode).toBe(400);
    expect(cancelWithConfirmation.json().error).toContain("Completed batches cannot be cancelled");
    await app.close();
  });

  it("creates Ente Paste manual handoffs without exposing provider lifecycle actions", async () => {
    const clipboard: string[] = [];
    const app = await buildApp({
      registerBuiltInProviders: false,
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [new EntePasteManualDeliveryProvider({ writeClipboard: async (text) => { clipboard.push(text); } })]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "delivery", providerId: "mock-source", label: "Manual delivery account" } });
    const enabled = await app.inject({
      method: "POST",
      url: "/api/delivery-providers/ente-paste/opt-in",
      headers,
      payload: { confirm: "ENABLE WEAKER PROVIDER ente-paste" }
    });
    expect(enabled.statusCode).toBe(200);

    const created = await app.inject({
      method: "POST",
      url: "/api/deliveries",
      headers,
      payload: {
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms",
        deliveryProviderId: "ente-paste",
        deliveryAccountId: "delivery",
        expiresAt: new Date(Date.now() + 72 * 3600000).toISOString(),
        viewOnce: true
      }
    });

    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({
      deliveryProviderId: "ente-paste",
      status: "handoff_pending",
      viewLimit: 1,
      oneTimeDeliveryUrl: "https://paste.ente.com/"
    });
    expect(created.json().providerDeliveryId).toMatch(/^ente-manual-/);
    expect(JSON.stringify(created.json())).not.toContain("Password123");
    expect(clipboard).toEqual([["Title: CMS Login", "Username: mira", "Password: Password123"].join("\n")]);
    expect(clipboard[0]).not.toContain("https://example.com");
    expect(clipboard[0]).not.toContain("JBSWY3DPEHPK3PXP");
    expect(clipboard[0]).not.toContain("Internal incident instructions.");

    const cleared = await app.inject({ method: "POST", url: "/api/delivery-providers/ente-paste/clear-handoff-clipboard", headers, payload: {} });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json()).toEqual({ providerId: "ente-paste", cleared: true });
    expect(clipboard.at(-1)).toBe("");

    const refresh = await app.inject({ method: "POST", url: `/api/deliveries/${created.json().id}/refresh`, headers });
    expect(refresh.statusCode).toBe(400);
    expect(refresh.json().error).toContain("cannot refresh status through WardSen");

    const revoke = await app.inject({
      method: "DELETE",
      url: `/api/deliveries/${created.json().id}`,
      headers,
      payload: { confirm: `REVOKE DELIVERY ${created.json().id}` }
    });
    expect(revoke.statusCode).toBe(400);
    expect(revoke.json().error).toContain("cannot revoke links through WardSen");

    const bulk = await app.inject({
      method: "POST",
      url: "/api/deliveries/bulk",
      headers,
      payload: {
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms",
        deliveryProviderId: "ente-paste",
        deliveryAccountId: "delivery",
        recipients: [{ id: "person-1", name: "Mira" }],
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        confirmRiskSummary: true
      }
    });
    expect(bulk.statusCode).toBe(400);
    expect(bulk.json().error).toContain("single-delivery only");
    expect(clipboard).toHaveLength(2);
    await app.close();
  });

  it("requires confirmation before pruning retained employee auth artifacts", async () => {
    const repository = new InMemoryWardSenRepository();
    const app = await buildApp({ repository });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    const employee = await repository.upsertEmployee({
      id: "employee-1",
      name: "Ravi",
      assignedEmail: "ravi@example.com"
    });
    const oldCodeHash = "c".repeat(64);
    const activeCodeHash = "d".repeat(64);
    const oldSessionHash = "s".repeat(64);
    const revokedSessionHash = "r".repeat(64);
    const activeSessionHash = "a".repeat(64);

    await repository.createEmployeeSignInCode({
      id: "old-code",
      employeeId: employee.id,
      assignedEmail: employee.assignedEmail,
      codeHash: oldCodeHash,
      expiresAt: "2020-01-02T00:00:00.000Z"
    });
    await repository.createEmployeeSignInCode({
      id: "active-code",
      employeeId: employee.id,
      assignedEmail: employee.assignedEmail,
      codeHash: activeCodeHash,
      expiresAt: "2030-01-02T00:00:00.000Z"
    });
    await repository.createEmployeeSession({
      id: "old-session",
      employeeId: employee.id,
      assignedEmail: employee.assignedEmail,
      tokenHash: oldSessionHash,
      expiresAt: "2020-01-02T00:00:00.000Z"
    });
    await repository.createEmployeeSession({
      id: "revoked-session",
      employeeId: employee.id,
      assignedEmail: employee.assignedEmail,
      tokenHash: revokedSessionHash,
      expiresAt: "2030-01-02T00:00:00.000Z",
      revokedAt: "2020-06-01T00:00:00.000Z"
    });
    await repository.createEmployeeSession({
      id: "active-session",
      employeeId: employee.id,
      assignedEmail: employee.assignedEmail,
      tokenHash: activeSessionHash,
      expiresAt: "2030-01-02T00:00:00.000Z"
    });

    const withoutConfirmation = await app.inject({
      method: "POST",
      url: "/api/retention/prune",
      headers,
      payload: { employeeAuthBefore: "2021-01-01T00:00:00.000Z" }
    });
    expect(withoutConfirmation.statusCode).toBe(400);
    expect(withoutConfirmation.json().error).toBe("Destructive action requires confirmation phrase: PRUNE RETENTION");

    const futureCutoff = await app.inject({
      method: "POST",
      url: "/api/retention/prune",
      headers,
      payload: { employeeAuthBefore: "2999-01-01T00:00:00.000Z", confirm: "PRUNE RETENTION" }
    });
    expect(futureCutoff.statusCode).toBe(400);
    expect(futureCutoff.json().error).toBe("Employee auth retention cutoff cannot be in the future.");

    const pruned = await app.inject({
      method: "POST",
      url: "/api/retention/prune",
      headers,
      payload: { employeeAuthBefore: "2021-01-01T00:00:00.000Z", confirm: "PRUNE RETENTION" }
    });
    expect(pruned.statusCode).toBe(200);
    expect(pruned.json()).toEqual({
      pruned: {
        auditLog: 0,
        employeeSignInCodes: 1,
        employeeSessions: 2,
        total: 3
      }
    });
    expect(await repository.getEmployeeSignInCodeByHash(employee.id, oldCodeHash)).toBeUndefined();
    expect(await repository.getEmployeeSignInCodeByHash(employee.id, activeCodeHash)).toMatchObject({ id: "active-code" });
    expect(await repository.getEmployeeSessionByTokenHash(oldSessionHash)).toBeUndefined();
    expect(await repository.getEmployeeSessionByTokenHash(revokedSessionHash)).toBeUndefined();
    expect(await repository.getEmployeeSessionByTokenHash(activeSessionHash)).toMatchObject({ id: "active-session" });
    const audit = await app.inject({ method: "GET", url: "/api/audit-log?page=1&pageSize=10", headers });
    expect(audit.json().items).toEqual(expect.arrayContaining([expect.objectContaining({ action: "retention.prune", outcome: "success" })]));
    expect(JSON.stringify(audit.json())).not.toContain(oldCodeHash);
    expect(JSON.stringify(audit.json())).not.toContain(oldSessionHash);
    await app.close();
  });

  it("runs a complete credential delivery workflow through injected providers", async () => {
    const deliveryProvider = new MockDeliveryProvider();
    const sessions = new AccountSessionManager();
    const app = await buildApp({
      sessions,
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
    sessions.markUnlocked("source", "mock-source", "source-token");
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
    expect(refreshed.firstViewedAt).toBeTruthy();
    const refreshedAgain = (await app.inject({ method: "POST", url: `/api/deliveries/${deliveryId}/refresh`, headers })).json();
    expect(refreshedAgain.firstViewedAt).toBe(refreshed.firstViewedAt);
    expect((await app.inject({ method: "POST", url: `/api/deliveries/${deliveryId}/retry`, headers })).json().oneTimeDeliveryUrl).toMatch(/^https:\/\/mock.local\/send\//);
    expect((await app.inject({ method: "DELETE", url: `/api/deliveries/${deliveryId}`, headers, payload: { confirm: `REVOKE DELIVERY ${deliveryId}` } })).json().status).toBe("revoked");
    await app.close();
  });

  it("creates an explicitly confirmed credential bundle without persisting credential content", async () => {
    const deliveryProvider = new MockDeliveryProvider();
    const sessions = new AccountSessionManager();
    const app = await buildApp({
      sessions,
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [deliveryProvider]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "delivery", providerId: "mock-source", label: "Mock delivery" } });
    sessions.markUnlocked("source", "mock-source", "source-token");
    const payload = {
      operationId: "bundle-operation",
      sourceCredentials: [
        { sourceProviderId: "mock-source", sourceAccountId: "source", sourceItemId: "cms" },
        { sourceProviderId: "mock-source", sourceAccountId: "source", sourceItemId: "cms-backup" }
      ],
      deliveryProviderId: "mock-delivery",
      deliveryAccountId: "delivery",
      expiresAt: new Date(Date.now() + 3600000).toISOString()
    };

    const missingConfirmation = await app.inject({ method: "POST", url: "/api/deliveries/bundle", headers, payload });
    expect(missingConfirmation.statusCode).not.toBe(200);
    const created = await app.inject({
      method: "POST",
      url: "/api/deliveries/bundle",
      headers,
      payload: { ...payload, confirmBundle: true }
    });

    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ credentialName: "Credential bundle (2)" });
    expect(deliveryProvider.inputs).toHaveLength(1);
    expect(deliveryProvider.inputs[0]).toMatchObject({
      sourceCredential: { title: "Credential bundle (2)" }
    });
    expect(deliveryProvider.inputs[0]?.deliveryText).toContain("Credential 1: CMS Login");
    expect(deliveryProvider.inputs[0]?.deliveryText).toContain("Password: Password123");
    expect(deliveryProvider.inputs[0]?.deliveryText).not.toContain("Internal incident instructions.");
    expect(deliveryProvider.inputs[0]?.deliveryText).not.toContain("JBSWY3DPEHPK3PXP");
    expect(JSON.stringify((await app.inject({ method: "GET", url: "/api/deliveries", headers })).json()).replaceAll("Credential bundle (2)", "")).not.toContain("Password123");
    await app.close();
  });

  it("creates custom secure text without persisting the text in delivery metadata or audit records", async () => {
    const deliveryProvider = new MockDeliveryProvider();
    const app = await buildApp({
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [deliveryProvider]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    const text = "Private dispatch note: north-wing-4";
    const payload = {
      operationId: "custom-text-operation",
      text,
      deliveryProviderId: "mock-delivery",
      deliveryAccountId: "delivery",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString()
    };
    await app.inject({
      method: "POST",
      url: "/api/accounts",
      headers,
      payload: { id: "delivery", providerId: "mock-source", label: "Mock delivery" }
    });

    const created = await app.inject({ method: "POST", url: "/api/deliveries/custom-text", headers, payload });
    expect(created.statusCode).toBe(200);
    expect(created.json()).toMatchObject({ credentialName: "Custom secure text" });
    expect(JSON.stringify(created.json())).not.toContain(text);
    expect(deliveryProvider.inputs).toHaveLength(1);
    expect(deliveryProvider.inputs[0]).toMatchObject({
      sourceCredential: { title: "Custom secure text" },
      deliveryText: text,
      sensitiveValues: [text]
    });

    const deliveries = await app.inject({ method: "GET", url: "/api/deliveries", headers });
    const audit = await app.inject({ method: "GET", url: "/api/audit-log", headers });
    expect(JSON.stringify(deliveries.json())).not.toContain(text);
    expect(JSON.stringify(audit.json())).not.toContain(text);

    const repeated = await app.inject({
      method: "POST",
      url: "/api/deliveries/custom-text",
      headers,
      payload: { ...payload, text: "Different custom text" }
    });
    expect(repeated.statusCode).toBe(409);
    expect(deliveryProvider.inputs).toHaveLength(1);
    await app.close();
  });

  it("marks expired delivery metadata as expired when a provider status check is unavailable", async () => {
    // Keep creation future relative to the real clock used by validation, then
    // advance only Date.now() to exercise expiry reconciliation deterministically.
    const createdAt = new Date(Date.now() + 5 * 60_000);
    const now = vi.spyOn(Date, "now").mockReturnValue(createdAt.getTime());
    const sessions = new AccountSessionManager();
    const app = await buildApp({
      sessions,
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [new MockDeliveryProvider()]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });
    sessions.markUnlocked("source", "mock-source", "source-token");
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "delivery", providerId: "mock-source", label: "Mock delivery" } });

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
        expiresAt: new Date(createdAt.getTime() + 60_000).toISOString(),
        viewLimit: 1,
        viewOnce: true,
        deliveryMethod: "copy"
      }
    });
    expect(created.statusCode).toBe(200);

    now.mockReturnValue(createdAt.getTime() + 60_001);
    const deliveries = await app.inject({ method: "GET", url: "/api/deliveries", headers });
    expect(deliveries.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.json().id, status: "expired" })
    ]));
    await app.close();
  });

  it("reuses an idempotent delivery operation without creating another provider link", async () => {
    const deliveryProvider = new MockDeliveryProvider();
    const app = await buildApp({
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [deliveryProvider]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    const expiresAt = new Date(Date.now() + 3600000).toISOString();
    const payload = {
      operationId: "delivery-op-1",
      sourceProviderId: "mock-source",
      sourceAccountId: "source",
      sourceItemId: "cms",
      deliveryProviderId: "mock-delivery",
      deliveryAccountId: "delivery",
      expiresAt,
      viewLimit: 1
    };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "delivery", providerId: "mock-source", label: "Mock delivery" } });

    const first = await app.inject({ method: "POST", url: "/api/deliveries", headers, payload });
    const second = await app.inject({ method: "POST", url: "/api/deliveries", headers, payload });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({
      id: first.json().id,
      operationId: "delivery-op-1",
      oneTimeDeliveryUrl: first.json().oneTimeDeliveryUrl
    });
    expect(deliveryProvider.inputs).toHaveLength(1);
    expect(deliveryProvider.inputs[0].operationId).toBe("delivery-op-1");
    await app.close();
  });

  it("rejects a reused delivery operation id with a different policy", async () => {
    const deliveryProvider = new MockDeliveryProvider();
    const app = await buildApp({
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [deliveryProvider]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    const expiresAt = new Date(Date.now() + 3600000).toISOString();
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "delivery", providerId: "mock-source", label: "Mock delivery" } });

    await app.inject({
      method: "POST",
      url: "/api/deliveries",
      headers,
      payload: {
        operationId: "delivery-op-2",
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms",
        deliveryProviderId: "mock-delivery",
        deliveryAccountId: "delivery",
        expiresAt,
        viewLimit: 1
      }
    });
    const mismatch = await app.inject({
      method: "POST",
      url: "/api/deliveries",
      headers,
      payload: {
        operationId: "delivery-op-2",
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms-backup",
        deliveryProviderId: "mock-delivery",
        deliveryAccountId: "delivery",
        expiresAt,
        viewLimit: 1
      }
    });

    expect(mismatch.statusCode).toBe(409);
    expect(mismatch.json().error).toBe("Delivery operation id was already used for a different request.");
    expect(deliveryProvider.inputs).toHaveLength(1);
    await app.close();
  });

  it("does not recreate a completed operation after restart when the one-time URL cache is gone", async () => {
    const repository = new InMemoryWardSenRepository();
    const firstProvider = new MockDeliveryProvider();
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    const expiresAt = new Date(Date.now() + 3600000).toISOString();
    const payload = {
      operationId: "delivery-op-3",
      sourceProviderId: "mock-source",
      sourceAccountId: "source",
      sourceItemId: "cms",
      deliveryProviderId: "mock-delivery",
      deliveryAccountId: "delivery",
      expiresAt,
      viewLimit: 1
    };
    const firstApp = await buildApp({
      repository,
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [firstProvider]
    });
    await firstApp.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });
    await firstApp.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "delivery", providerId: "mock-source", label: "Mock delivery" } });
    const created = await firstApp.inject({ method: "POST", url: "/api/deliveries", headers, payload });
    expect(created.statusCode).toBe(200);
    await firstApp.close();

    const secondProvider = new MockDeliveryProvider();
    const secondApp = await buildApp({
      repository,
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [secondProvider]
    });
    const replay = await secondApp.inject({ method: "POST", url: "/api/deliveries", headers, payload });

    expect(replay.statusCode).toBe(409);
    expect(replay.json().error).toContain("one-time URL is no longer available");
    expect(secondProvider.inputs).toHaveLength(0);
    await secondApp.close();
  });

  it("preflights Bitwarden Send account readiness before creating a secure link", async () => {
    const deliveryProvider = new NotReadyBitwardenSendProvider();
    const app = await buildApp({
      registerBuiltInProviders: false,
      credentialProviders: [new MockCredentialProvider(), new MockBitwardenCredentialProvider()],
      deliveryProviders: [deliveryProvider]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "red", providerId: "bitwarden", label: "red" } });

    const response = await app.inject({
      method: "POST",
      url: "/api/deliveries",
      headers,
      payload: {
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms",
        deliveryProviderId: "bitwarden-send",
        deliveryAccountId: "red",
        expiresAt: new Date(Date.now() + 3600000).toISOString()
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('Bitwarden Send account "red" is not ready');
    expect(response.json().error).toContain("wait for WardSen to show the account as unlocked");
    expect(response.json().error).toContain("You are not logged in");
    expect(deliveryProvider.createCalls).toBe(0);
    await app.close();
  });

  it("keeps a failed local delivery record when provider creation fails", async () => {
    const repository = new InMemoryWardSenRepository();
    const app = await buildApp({
      repository,
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [new FailingCreateDeliveryProvider()]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "delivery", providerId: "mock-source", label: "Mock delivery" } });

    const response = await app.inject({
      method: "POST",
      url: "/api/deliveries",
      headers,
      payload: {
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms",
        deliveryProviderId: "failing-delivery",
        deliveryAccountId: "delivery",
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        viewLimit: 1
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("provider create failed");
    const deliveries = await repository.listDeliveries({ page: 1, pageSize: 10 });
    expect(deliveries.items[0]).toMatchObject({
      sourceItemId: "cms",
      credentialName: "CMS Login",
      status: "failed",
      viewLimit: 1
    });
    expect(deliveries.items[0].providerDeliveryId).toBeUndefined();
    await app.close();
  });

  it("revokes a provider link when local delivery finalization fails", async () => {
    const repository = new FinalizeFailingRepository();
    const deliveryProvider = new RevocationTrackingDeliveryProvider();
    const app = await buildApp({
      repository,
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [deliveryProvider]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "delivery", providerId: "mock-source", label: "Mock delivery" } });

    const response = await app.inject({
      method: "POST",
      url: "/api/deliveries",
      headers,
      payload: {
        sourceProviderId: "mock-source",
        sourceAccountId: "source",
        sourceItemId: "cms",
        deliveryProviderId: "revocation-tracking",
        deliveryAccountId: "delivery",
        expiresAt: new Date(Date.now() + 3600000).toISOString()
      }
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("local finalize failed");
    expect(deliveryProvider.revoked).toEqual([{ accountId: "delivery", deliveryId: "provider-created" }]);
    const audit = await repository.listAuditLog({ page: 1, pageSize: 10 });
    expect(audit.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "delivery.create", outcome: "failure", deliveryAccountId: "delivery" })
    ]));
    await app.close();
  });

  it("reconciles stale creating deliveries on startup", async () => {
    const repository = new InMemoryWardSenRepository();
    const stale = await repository.createDelivery({
      sourceProviderId: "mock-source",
      sourceAccountId: "source",
      sourceItemId: "cms",
      deliveryProviderId: "mock-delivery",
      deliveryAccountId: "delivery",
      credentialName: "CMS Login",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      viewLimit: 1,
      status: "creating"
    });

    const app = await buildApp({
      repository,
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [new MockDeliveryProvider()]
    });

    expect(await repository.getDelivery(stale.id)).toMatchObject({ status: "failed" });
    const audit = await repository.listAuditLog({ page: 1, pageSize: 10 });
    expect(audit.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "delivery.reconcile",
        outcome: "failure",
        deliveryId: stale.id,
        safeDetails: "stuck_status=creating"
      })
    ]));
    await app.close();
  });

  it("recovers stale creating deliveries when the provider can find the operation", async () => {
    const repository = new InMemoryWardSenRepository();
    const stale = await repository.createDelivery({
      operationId: "delivery-op-recover",
      operationFingerprint: "fingerprint",
      sourceProviderId: "mock-source",
      sourceAccountId: "source",
      sourceItemId: "cms",
      deliveryProviderId: "recovery-delivery",
      deliveryAccountId: "delivery",
      credentialName: "CMS Login",
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      viewLimit: 1,
      status: "creating"
    });
    const provider = new OperationRecoveryDeliveryProvider();

    const app = await buildApp({
      repository,
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [provider]
    });

    expect(await repository.getDelivery(stale.id)).toMatchObject({
      status: "viewed",
      providerDeliveryId: "provider-recovered",
      accessCount: 1
    });
    expect(provider.lookupCalls).toEqual([{ accountId: "delivery", operationId: "delivery-op-recover" }]);
    const audit = await repository.listAuditLog({ page: 1, pageSize: 10 });
    expect(audit.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "delivery.reconcile",
        outcome: "success",
        deliveryId: stale.id,
        safeDetails: "recovered_operation=delivery-op-recover"
      })
    ]));
    await app.close();
  });

  it("retries expired deliveries with a fresh future expiry using the original duration", async () => {
    const deliveryProvider = new MockDeliveryProvider();
    const app = await buildApp({
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [deliveryProvider]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "delivery", providerId: "mock-source", label: "Mock delivery" } });
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
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString()
      }
    });
    const deliveryId = created.json().id;
    const retryNow = Date.now() + 24 * 60 * 60 * 1000;
    vi.spyOn(Date, "now").mockReturnValue(retryNow);

    const retried = await app.inject({ method: "POST", url: `/api/deliveries/${deliveryId}/retry`, headers });
    const retryExpiresAt = new Date(retried.json().expiresAt).getTime();
    const expectedExpiresAt = retryNow + 2 * 60 * 60 * 1000;

    expect(retried.statusCode).toBe(200);
    expect(Math.abs(retryExpiresAt - expectedExpiresAt)).toBeLessThan(1000);
    await app.close();
  });

  it("rejects delivery when the source account belongs to another provider", async () => {
    const app = await buildApp({
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [new MockDeliveryProvider()]
    });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "bitwarden", label: "Wrong source" } });
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
    const sessions = new AccountSessionManager();
    const app = await buildApp({ sessions, credentialProviders: [new MockCredentialProvider(), new FailingSearchCredentialProvider()] });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "ok", providerId: "mock-source", label: "OK" } });
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "bad", providerId: "failing-search", label: "Failing provider" } });
    sessions.markUnlocked("ok", "mock-source", "ok-token");
    sessions.markUnlocked("bad", "failing-search", "bad-token");

    const response = await app.inject({ method: "GET", url: "/api/credentials/search?q=cms", headers: { host: "127.0.0.1:4777" } });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(2);
    expect(response.json().errors[0]).toMatchObject({ accountId: "bad", providerId: "failing-search" });
    await app.close();
  });

  it("skips locked credential accounts unless the locked account is explicitly selected", async () => {
    const sessions = new AccountSessionManager();
    const app = await buildApp({ sessions, credentialProviders: [new MockCredentialProvider()] });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "unlocked", providerId: "mock-source", label: "Unlocked" } });
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "locked", providerId: "mock-source", label: "Locked" } });
    sessions.markUnlocked("unlocked", "mock-source", "unlocked-token");

    const all = await app.inject({ method: "GET", url: "/api/credentials/search?q=cms", headers: { host: "127.0.0.1:4777" } });
    expect(all.statusCode).toBe(200);
    expect(all.json().items).toHaveLength(2);
    expect(all.json().items.every((item: CredentialSummary) => item.accountId === "unlocked")).toBe(true);
    expect(all.json().errors).toEqual([]);

    const selectedLocked = await app.inject({
      method: "GET",
      url: "/api/credentials/search?providerId=mock-source&accountId=locked&q=cms",
      headers: { host: "127.0.0.1:4777" }
    });
    expect(selectedLocked.statusCode).toBe(200);
    expect(selectedLocked.json().items).toHaveLength(0);
    expect(selectedLocked.json().errors[0]).toMatchObject({
      accountId: "locked",
      providerId: "mock-source",
      safeMessage: "Vault is locked. Unlock this account before searching credentials."
    });
    await app.close();
  });

  it("paginates credential search results", async () => {
    const sessions = new AccountSessionManager();
    const app = await buildApp({ sessions, credentialProviders: [new MockCredentialProvider()] });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });
    sessions.markUnlocked("source", "mock-source", "source-token");

    const response = await app.inject({
      method: "GET",
      url: "/api/credentials/search?providerId=mock-source&accountId=source&q=cms&page=2&pageSize=1",
      headers: { host: "127.0.0.1:4777" }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([expect.objectContaining({ id: "cms-backup", title: "CMS Backup" })]);
    await app.close();
  });

  it("returns all matching credential summaries when explicitly requested", async () => {
    const sessions = new AccountSessionManager();
    const app = await buildApp({ sessions, credentialProviders: [new MockCredentialProvider()] });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "mock-source", label: "Mock source" } });
    sessions.markUnlocked("source", "mock-source", "source-token");

    const response = await app.inject({
      method: "GET",
      url: "/api/credentials/search?providerId=mock-source&accountId=source&q=cms&page=4&pageSize=all",
      headers
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ page: 1, pageSize: "all", total: 2 });
    expect(response.json().items).toHaveLength(2);
    await app.close();
  });

  it("falls back to fuzzy matching when the provider has no direct credential result", async () => {
    const sessions = new AccountSessionManager();
    const app = await buildApp({ sessions, credentialProviders: [new FuzzySearchCredentialProvider()] });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({ method: "POST", url: "/api/accounts", headers, payload: { id: "source", providerId: "fuzzy-source", label: "Fuzzy source" } });
    sessions.markUnlocked("source", "fuzzy-source", "source-token");

    const response = await app.inject({
      method: "GET",
      url: "/api/credentials/search?providerId=fuzzy-source&accountId=source&q=githb&page=1&pageSize=10",
      headers
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([expect.objectContaining({ id: "github", title: "GitHub Production" })]);
    await app.close();
  });

  it("creates individual bulk deliveries with persisted batch counts", async () => {
    const deliveryProvider = new MockDeliveryProvider();
    const app = await buildApp({
      credentialProviders: [new MockCredentialProvider()],
      deliveryProviders: [deliveryProvider]
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
    expect(bulk.json().results).toEqual(expect.arrayContaining([
      expect.objectContaining({ recipientId: "person-1", ok: true, delivery: expect.objectContaining({ oneTimeDeliveryUrl: expect.stringMatching(/^https:\/\/mock.local\/send\//) }) }),
      expect.objectContaining({ recipientId: "person-2", ok: true, delivery: expect.objectContaining({ oneTimeDeliveryUrl: expect.stringMatching(/^https:\/\/mock.local\/send\//) }) })
    ]));
    const batch = await app.inject({ method: "GET", url: `/api/batches/${bulk.json().batchId}`, headers: { host: "127.0.0.1:4777" } });
    expect(batch.json()).toMatchObject({ requestedCount: 2, completedCount: 2, failedCount: 0, cancelled: false });
    const batches = await app.inject({ method: "GET", url: "/api/batches?page=1&pageSize=10", headers: { host: "127.0.0.1:4777" } });
    expect(batches.json().items[0]).toMatchObject({ id: bulk.json().batchId, requestedCount: 2, completedCount: 2 });
    const batchDeliveries = await app.inject({ method: "GET", url: `/api/deliveries?batchId=${bulk.json().batchId}`, headers: { host: "127.0.0.1:4777" } });
    expect(batchDeliveries.json().items).toHaveLength(2);
    expect(batchDeliveries.json().items.every((delivery: { batchId: string }) => delivery.batchId === bulk.json().batchId)).toBe(true);
    const firstDeliveryId = batchDeliveries.json().items[0].id;
    const missingConfirmation = await app.inject({ method: "POST", url: `/api/deliveries/${firstDeliveryId}/revoke-batch`, headers, payload: {} });
    expect(missingConfirmation.statusCode).toBe(400);
    expect(missingConfirmation.json().error).toBe(`Destructive action requires confirmation phrase: REVOKE BATCH LINKS ${bulk.json().batchId}`);
    const containment = await app.inject({
      method: "POST",
      url: `/api/deliveries/${firstDeliveryId}/revoke-batch`,
      headers,
      payload: { confirm: `REVOKE BATCH LINKS ${bulk.json().batchId}` }
    });
    expect(containment.statusCode).toBe(200);
    expect(containment.json()).toMatchObject({ batchId: bulk.json().batchId, revokedCount: 2, inactiveCount: 0, failed: [] });
    expect(deliveryProvider.revoked).toHaveLength(2);
    expect((await app.inject({ method: "GET", url: `/api/deliveries?batchId=${bulk.json().batchId}`, headers })).json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "revoked" })
    ]));
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

  it("auto-locks inactive accounts from the background timer without another request", async () => {
    const sessions = new AccountSessionManager();
    const provider = new LockTrackingCredentialProvider();
    const app = await buildApp({ sessions, credentialProviders: [provider], autoLockIntervalMs: 1000 });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({
      method: "POST",
      url: "/api/accounts",
      headers,
      payload: { id: "source", providerId: "lock-tracking", label: "Lock tracking", autoLockMinutes: 1 }
    });
    sessions.markUnlocked("source", "lock-tracking", "token");
    ageSession(sessions, "source", new Date(Date.now() - 2 * 60 * 1000));

    await new Promise((resolve) => setTimeout(resolve, 1100));

    expect(provider.locked).toEqual(["source"]);
    expect(() => sessions.getSessionToken("source", "lock-tracking")).toThrow();
    await app.close();
  }, 10_000);

  it("audits auto-lock provider failures and still clears the local session", async () => {
    const sessions = new AccountSessionManager();
    const app = await buildApp({ sessions, credentialProviders: [new FailingLockCredentialProvider()], autoLockIntervalMs: 1000 });
    const headers = { host: "127.0.0.1:4777", origin: "http://127.0.0.1:4777" };
    await app.inject({
      method: "POST",
      url: "/api/accounts",
      headers,
      payload: { id: "source", providerId: "failing-lock", label: "Failing lock", autoLockMinutes: 1 }
    });
    sessions.markUnlocked("source", "failing-lock", "token");
    ageSession(sessions, "source", new Date(Date.now() - 2 * 60 * 1000));

    await new Promise((resolve) => setTimeout(resolve, 1100));

    expect(() => sessions.getSessionToken("source", "failing-lock")).toThrow();
    const audit = await app.inject({ method: "GET", url: "/api/audit-log", headers: { host: "127.0.0.1:4777" } });
    expect(audit.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "account.auto_lock", outcome: "failure", sourceAccountId: "source" })
    ]));
    await app.close();
  }, 10_000);
});

class MockCredentialProvider implements CredentialProvider {
  readonly id: string = "mock-source";
  readonly displayName: string = "Mock Source";
  readonly loginCalls: Array<{ accountId: string; input: ProviderLoginInput }> = [];
  async getCapabilities(): Promise<CredentialProviderCapabilities> {
    return { searchItems: true, multipleAccounts: true, customServers: false, localVaults: false, synchronization: false, locking: false };
  }
  async testConnection(_accountId: string): Promise<ConnectionResult> {
    return { ok: true, status: "unlocked" };
  }
  async login(accountId: string, input: ProviderLoginInput): Promise<void> {
    this.loginCalls.push({ accountId, input });
  }
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
    return {
      title: "CMS Login",
      username: "mira",
      password: "Password123",
      urls: ["https://example.com"],
      totp: "JBSWY3DPEHPK3PXP",
      notes: "Internal incident instructions."
    };
  }
}

class MockBitwardenCredentialProvider extends MockCredentialProvider {
  readonly id: string = "bitwarden";
  readonly displayName: string = "Bitwarden";
}

class FuzzySearchCredentialProvider extends MockCredentialProvider {
  readonly id = "fuzzy-source";
  readonly displayName = "Fuzzy Source";

  async search(accountId: string, query: string, pagination: PaginationInput): Promise<CredentialSummary[]> {
    const rows: CredentialSummary[] = [
      { id: "github", accountId, providerId: this.id, title: "GitHub Production", username: "deploy", domain: "github.com", itemType: "login" },
      { id: "proton", accountId, providerId: this.id, title: "Proton VPN", username: "ops", domain: "account.protonvpn.com", itemType: "login" }
    ];
    const normalizedQuery = query.toLocaleLowerCase();
    const matches = normalizedQuery
      ? rows.filter((item) => [item.title, item.username, item.domain].filter(Boolean).some((field) => field!.toLocaleLowerCase().includes(normalizedQuery)))
      : rows;
    const start = (pagination.page - 1) * pagination.pageSize;
    return matches.slice(start, start + pagination.pageSize);
  }
}

class TerminalHandoffCredentialProvider extends MockBitwardenCredentialProvider {
  readonly handoffs: Array<{ claimUrl: string; token: string }> = [];
  readonly acceptedTokens: string[] = [];
  readonly acceptedIdentities: TerminalSessionHandoffIdentity[] = [];
  providerPrincipalId = "user-work";

  createTerminalSessionHandoffCommand(_accountId: string, _input: ProviderLoginInput, handoff: { claimUrl: string; token: string }): string {
    this.handoffs.push(handoff);
    return `terminal-handoff ${handoff.claimUrl}`;
  }

  async acceptTerminalSessionHandoff(_accountId: string, sessionToken: string, expectedIdentity: TerminalSessionHandoffIdentity): Promise<{ providerPrincipalId: string }> {
    this.acceptedTokens.push(sessionToken);
    this.acceptedIdentities.push(expectedIdentity);
    return { providerPrincipalId: this.providerPrincipalId };
  }
}

class FailingSearchCredentialProvider extends MockCredentialProvider {
  readonly id = "failing-search";
  readonly displayName = "Failing Search";
  async search(_accountId: string, _query: string, _pagination: PaginationInput): Promise<CredentialSummary[]> {
    throw new Error("provider search failed");
  }
}

class MockDeliveryProvider implements DeliveryProvider {
  readonly id: string = "mock-delivery";
  readonly displayName: string = "Mock Delivery";
  readonly inputs: CreateDeliveryInput[] = [];
  readonly revoked: Array<{ accountId: string; deliveryId: string }> = [];
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
      accessCount: true,
      statusLookup: true
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
  async revoke(accountId: string, deliveryId: string): Promise<void> {
    this.revoked.push({ accountId, deliveryId });
  }
  async getStatus(_accountId: string, deliveryId: string): Promise<DeliveryStatus> {
    return { deliveryId, status: "active", accessCount: 1 };
  }
}

class NotReadyBitwardenSendProvider extends MockDeliveryProvider {
  readonly id = "bitwarden-send";
  readonly displayName = "Bitwarden Send";
  createCalls = 0;
  async testConnection(_accountId: string): Promise<ConnectionResult> {
    throw new Error('Provider command "bw send" failed. Detail: You are not logged in.');
  }
  async createDelivery(input: CreateDeliveryInput): Promise<DeliveryResult> {
    this.createCalls += 1;
    return super.createDelivery(input);
  }
}

class FailingCreateDeliveryProvider extends MockDeliveryProvider {
  readonly id = "failing-delivery";
  readonly displayName = "Failing Delivery";
  async createDelivery(_input: CreateDeliveryInput): Promise<DeliveryResult> {
    throw new Error("provider create failed");
  }
}

class RevocationTrackingDeliveryProvider extends MockDeliveryProvider {
  readonly id = "revocation-tracking";
  readonly displayName = "Revocation Tracking";
  readonly revoked: Array<{ accountId: string; deliveryId: string }> = [];
  async createDelivery(input: CreateDeliveryInput): Promise<DeliveryResult> {
    return { deliveryId: "provider-created", url: "https://mock.local/send/provider-created", expiresAt: input.expiresAt, viewLimit: input.viewLimit };
  }
  async revoke(accountId: string, deliveryId: string): Promise<void> {
    this.revoked.push({ accountId, deliveryId });
  }
}

class OperationRecoveryDeliveryProvider extends MockDeliveryProvider {
  readonly id = "recovery-delivery";
  readonly displayName = "Recovery Delivery";
  readonly lookupCalls: Array<{ accountId: string; operationId: string }> = [];
  async findDeliveryByOperationId(accountId: string, operationId: string): Promise<DeliveryStatus | undefined> {
    this.lookupCalls.push({ accountId, operationId });
    if (operationId !== "delivery-op-recover") return undefined;
    return {
      deliveryId: "provider-recovered",
      status: "viewed",
      accessCount: 1,
      expiresAt: new Date(Date.now() + 3600000)
    };
  }
}

class FinalizeFailingRepository extends InMemoryWardSenRepository {
  async updateDelivery(id: string, patch: Parameters<InMemoryWardSenRepository["updateDelivery"]>[1]) {
    if (patch.status === "active") {
      throw new Error("local finalize failed");
    }
    return super.updateDelivery(id, patch);
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

class FailingLockCredentialProvider extends MockCredentialProvider {
  readonly id = "failing-lock";
  readonly displayName = "Failing Lock";
  async lock(_accountId: string): Promise<void> {
    throw new Error("provider lock failed");
  }
}

function ageSession(sessions: AccountSessionManager, accountId: string, lastActivityAt: Date) {
  const exposed = sessions as unknown as { sessions: Map<string, { lastActivityAt?: Date }> };
  const session = exposed.sessions.get(accountId);
  if (!session) throw new Error(`Missing test session: ${accountId}`);
  session.lastActivityAt = lastActivityAt;
}
