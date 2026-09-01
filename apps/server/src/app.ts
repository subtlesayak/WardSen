import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import Fastify, { type FastifyRequest } from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import { customAlphabet, nanoid } from "nanoid";
import { RateLimiterMemory } from "rate-limiter-flexible";
import { z } from "zod";
import {
  AccountSessionManager,
  ProviderRegistry,
  TerminalSessionHandoffIdentityError,
  assertDeliveryOptionsSupported,
  assertFutureExpiry,
  builtInProviderManifests,
  formatDeliveryCredentialBundleText,
  providerManifestFor,
  parseViewLimit
} from "@wardsen/core";
import type {
  AccountRecord,
  CredentialAccessRequestRecord,
  CredentialCatalogEntry,
  CredentialProvider,
  CredentialSummary,
  DeliveryPolicySnapshot,
  DeliveryProvider,
  DeliveryRecord,
  EmployeeRecord,
  EmployeeSessionRecord,
  SensitiveCredential,
  TerminalSessionHandoffIdentity
} from "@wardsen/core";
import { InMemoryWardSenRepository } from "@wardsen/database";
import type { WardSenRepository } from "@wardsen/database";
import { BitwardenCredentialProvider } from "@wardsen/provider-bitwarden";
import { BitwardenSendDeliveryProvider } from "@wardsen/delivery-bitwarden-send";
import { OnetimeSecretDeliveryProvider, PasswordPusherDeliveryProvider, YopassDeliveryProvider } from "@wardsen/delivery-external";
import { KeePassXCCredentialProvider } from "@wardsen/provider-keepassxc";
import { assertSameOrigin, isLocalRequest, resolveProviderExecutable, runCliCommand, safeErrorMessage } from "@wardsen/security";
import { parsePeopleCsv, peopleToCsv } from "./csv";
import { fuzzyFilterCredentials } from "./credentialSearch";
import { EntePasteManualDeliveryProvider } from "../../../packages/delivery-ente-paste/src";
import { AccountDeletionError, AccountDeletionService } from "./accountDeletionService";
import { assertManagedProfileDirectoryTarget, managedProfileDirectory, pathsEqual } from "./managedProfileDirectory";
import { GithubReleaseUpdateService, type ReleaseUpdateService } from "./releaseUpdateService";
import { NpmBitwardenCliUpdateService, type BitwardenCliUpdateService } from "./bitwardenCliUpdateService";

export interface BuildAppOptions {
  repository?: WardSenRepository;
  profileRoot?: string;
  sessions?: AccountSessionManager;
  autoLockIntervalMs?: number;
  apiToken?: string;
  allowUnauthenticatedLocalApi?: boolean;
  registerBuiltInProviders?: boolean;
  credentialProviders?: CredentialProvider[];
  deliveryProviders?: DeliveryProvider[];
  releaseUpdateService?: ReleaseUpdateService;
  bitwardenCliUpdateService?: BitwardenCliUpdateService;
}

interface TerminalSessionHandoffRecord {
  accountId: string;
  providerId: string;
  expectedIdentity: TerminalSessionHandoffIdentity;
  expiresAt: number;
  launchId: string;
  command?: string;
}

const TERMINAL_SESSION_HANDOFF_TTL_MS = 5 * 60 * 1000;
const RATE_LIMIT_WINDOW = "1 minute";
const BITWARDEN_CLI_PATH_SETTING = "provider.bitwarden.cli_path";

export async function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: {
      redact: [
        "req.headers.authorization",
        "req.headers['x-wardsen-api-token']",
        "req.headers['x-wardsen-terminal-handoff']",
        "req.headers['x-wardsen-employee-session']",
        "req.body",
        "req.body.password",
        "req.body.accessPassword",
        "req.body.masterPassword"
      ]
    },
    bodyLimit: 128 * 1024
  });
  const repository = options.repository ?? new InMemoryWardSenRepository();
  const sessions = options.sessions ?? new AccountSessionManager();
  const configuredBitwardenCli = {
    executablePath: configuredExecutablePath(await repository.getLocalSetting(BITWARDEN_CLI_PATH_SETTING))
  };
  const apiToken = options.apiToken ?? process.env.WARDSEN_API_TOKEN;
  const registry = new ProviderRegistry();
  const releaseUpdateService = options.releaseUpdateService ?? new GithubReleaseUpdateService();
  const bitwardenCliUpdateService = options.bitwardenCliUpdateService ?? new NpmBitwardenCliUpdateService();
  const profileRoot = path.resolve(options.profileRoot ?? path.join(process.cwd(), ".wardsen-profiles"));
  const accountProfileDirectories = new Map<string, string>();
  const deliveryOperationTails = new Map<string, Promise<void>>();
  const deliveryUrlCache = new Map<string, string>();
  const terminalSessionHandoffs = new Map<string, TerminalSessionHandoffRecord>();
  const requestRateLimiter = new RateLimiterMemory({ points: 120, duration: 60 });
  const autoLockIntervalMs = Math.max(1_000, options.autoLockIntervalMs ?? 5_000);
  const autoLockTimer = setInterval(() => {
    void enforceAutoLock();
  }, autoLockIntervalMs);
  autoLockTimer.unref?.();
  if (options.registerBuiltInProviders !== false) {
    const bitwarden = new BitwardenCredentialProvider({
      profileRoot,
      sessions,
      getExecutable: () => configuredBitwardenCli.executablePath,
      profileDirectoryFor: managedProfileDirectoryForAccount
    });
    registry.registerCredentialProvider(bitwarden);
    registry.registerCredentialProvider(new KeePassXCCredentialProvider({ sessions }));
    registry.registerDeliveryProvider(
      new BitwardenSendDeliveryProvider({
        getExecutable: () => configuredBitwardenCli.executablePath,
        getSessionToken: (accountId) => sessions.getSessionToken(accountId, "bitwarden"),
        withSessionOperation: (accountId, operation) => sessions.withOperation(accountId, "bitwarden", operation),
        profileDirectoryFor: managedProfileDirectoryForAccount
      })
    );
    registry.registerDeliveryProvider(new EntePasteManualDeliveryProvider());
    registry.registerDeliveryProvider(new PasswordPusherDeliveryProvider());
    registry.registerDeliveryProvider(new OnetimeSecretDeliveryProvider());
    registry.registerDeliveryProvider(new YopassDeliveryProvider());
  }
  for (const provider of options.credentialProviders ?? []) {
    registry.registerCredentialProvider(provider);
  }
  for (const provider of options.deliveryProviders ?? []) {
    registry.registerDeliveryProvider(provider);
  }
  const accountDeletionService = new AccountDeletionService({
    profileRoot,
    sessions,
    repository,
    providerFor: (providerId) => registry.getCredentialProvider(providerId),
    clearSensitiveResultCache: clearAccountSensitiveResultCache
  });

  await app.register(sensible);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        imgSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"]
      }
    }
  });
  // Fastify owns the route-specific limits below; the memory limiter guards every request first.
  await app.register(rateLimit, {
    global: false
  });

  function pruneTerminalSessionHandoffs(now = Date.now()): void {
    for (const [token, handoff] of terminalSessionHandoffs) {
      if (handoff.expiresAt <= now) terminalSessionHandoffs.delete(token);
    }
  }

  function terminalHandoffForClaimRequest(request: FastifyRequest): { token: string; record: TerminalSessionHandoffRecord } | undefined {
    if (request.method !== "POST") return undefined;
    const path = request.url.split("?", 1)[0];
    const match = /^\/api\/accounts\/([^/]+)\/terminal-handoff\/claim$/.exec(path);
    if (!match) return undefined;
    const token = firstHeaderValue(request.headers["x-wardsen-terminal-handoff"]);
    if (!token) return undefined;
    pruneTerminalSessionHandoffs();
    const record = terminalSessionHandoffs.get(token);
    if (!record) return undefined;
    try {
      return record.accountId === decodeURIComponent(match[1]) ? { token, record } : undefined;
    } catch {
      return undefined;
    }
  }

  app.addHook("onRequest", async (request, reply) => {
    try {
      await requestRateLimiter.consume(request.ip);
    } catch {
      return reply.code(429).send({ error: "Rate limit exceeded. Try again in one minute." });
    }
  });

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
    const terminalHandoff = terminalHandoffForClaimRequest(request);
    if (!terminalHandoff && !isAuthorizedLocalApiRequest(request.headers["x-wardsen-api-token"], apiToken, options.allowUnauthenticatedLocalApi)) {
      await reply.code(401).send({ error: "WardSen local service rejected this request because the desktop API token was missing or invalid. Restart WardSen from the desktop app, then retry." });
      return;
    }
    if (["POST", "PUT", "DELETE", "PATCH"].includes(request.method) && !terminalHandoff) {
      assertSameOrigin(request);
    }
    const accountId = accountIdFromAccountRequest(request);
    if (accountId && sessions.isDeletionInProgress(accountId)) {
      await reply.code(409).send({ error: "WardSen is deleting this account. Wait for the current operation to finish." });
      return;
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

  app.get("/api/release-update", { config: { rateLimit: { max: 10, timeWindow: RATE_LIMIT_WINDOW } } }, async (request) => {
    const { currentVersion } = z.object({ currentVersion: z.string().trim().min(1).max(100) }).parse(request.query);
    return releaseUpdateService.check(currentVersion);
  });

  app.get("/api/providers", async () => {
    const deliveryProviderEntries = await Promise.all(registry.listDeliveryProviders().map(async (provider) => {
      const manifest = providerManifestFor(provider.id);
      return {
        id: provider.id,
        displayName: provider.displayName,
        kind: manifest?.kind ?? "delivery",
        maturity: manifest?.maturity ?? "active",
        enabled: await isDeliveryProviderEnabled(provider.id),
        enabledByDefault: manifest?.enabledByDefault ?? true,
        requiresExplicitOptIn: manifest?.requiresExplicitOptIn ?? false,
        configurationRequired: manifest?.configurationRequired ?? false,
        optInWarning: manifest?.optInWarning,
        documentationUrl: manifest?.documentationUrl,
        notes: manifest?.notes,
        setupInstructions: manifest?.setupInstructions,
        delivery: manifest?.delivery,
        capabilities: await provider.getCapabilities()
      };
    }));

    return {
      credentialProviders: await Promise.all(
      registry.listCredentialProviders().map(async (provider) => ({
        id: provider.id,
        displayName: provider.displayName,
        maturity: "active",
        enabledByDefault: true,
        capabilities: await provider.getCapabilities()
      }))
      ),
      deliveryProviders: deliveryProviderEntries.filter((provider) => provider.enabled),
      optionalDeliveryProviders: deliveryProviderEntries.filter((provider) => !provider.enabled && provider.requiresExplicitOptIn),
      plannedProviders: builtInProviderManifests
      .filter((manifest) => manifest.maturity === "planned")
      .map(({ id, displayName, kind, maturity, enabledByDefault, documentationUrl, notes, setupInstructions, delivery }) => ({
        id,
        displayName,
        kind,
        maturity,
        enabledByDefault,
        documentationUrl,
        notes,
        setupInstructions,
        delivery
      }))
    };
  });

  app.post("/api/delivery-providers/:id/opt-in", async (request) => {
    const { id } = idParams.parse(request.params);
    const manifest = explicitOptInManifest(id);
    assertDestructiveConfirmation(request.body, `ENABLE WEAKER PROVIDER ${id}`);
    if (manifest.configurationRequired) {
      const provider = registry.getDeliveryProvider(id);
      const connection = await provider.testConnection(`provider-configuration-${id}`);
      if (!connection.ok || connection.status !== "unlocked") {
        throw app.httpErrors.badRequest(`${manifest.displayName} is not configured yet. Complete its local setup in Settings and run Check configuration before enabling it.`);
      }
    }
    await repository.setLocalSetting(providerOptInSettingKey(id), "enabled");
    await audit("delivery.provider_opt_in", "success", { safeDetails: `provider=${manifest.id}` });
    return { providerId: manifest.id, enabled: true };
  });

  app.delete("/api/delivery-providers/:id/opt-in", async (request) => {
    const { id } = idParams.parse(request.params);
    const manifest = explicitOptInManifest(id);
    assertDestructiveConfirmation(request.body, `DISABLE WEAKER PROVIDER ${id}`);
    await repository.setLocalSetting(providerOptInSettingKey(id), "disabled");
    await audit("delivery.provider_opt_out", "success", { safeDetails: `provider=${manifest.id}` });
    return { providerId: manifest.id, enabled: false };
  });

  app.get("/api/provider-diagnostics/:id", async (request) => {
    const { id } = idParams.parse(request.params);
    const credentialProvider = registry.listCredentialProviders().find((provider) => provider.id === id);
    const deliveryProvider = registry.listDeliveryProviders().find((provider) => provider.id === id);
    const provider = credentialProvider ?? deliveryProvider;
    if (!provider) throw app.httpErrors.notFound("Provider not found");

    const manifest = builtInProviderManifests.find((item) => item.id === id);
    const accounts = (await accountsWithLiveStatus()).filter((account) => account.providerId === id || (id === "bitwarden-send" && account.providerId === "bitwarden"));
    return {
      providerId: id,
      displayName: provider.displayName,
      kind: manifest?.kind ?? (credentialProvider ? "credential" : "delivery"),
      runtime: await providerRuntimeDiagnostic(id, id === "bitwarden" || id === "bitwarden-send" ? configuredBitwardenCli.executablePath : undefined),
      authentication: providerAuthenticationDiagnostic(id, accounts),
      accounts: accounts.map((account) => ({ id: account.id, label: account.label, status: account.status })),
      capabilities: await provider.getCapabilities(),
      linkPreviewRisk: providerLinkPreviewRisk(id)
    };
  });

  app.post("/api/provider-tools/bitwarden/locate", { config: { rateLimit: { max: 10, timeWindow: RATE_LIMIT_WINDOW } } }, async (request) => {
    const body = providerExecutablePathSchema.parse(request.body);
    try {
      const executablePath = verifiedExecutablePath(body.executablePath);
      const result = await runCliCommand({ executable: executablePath, args: ["--version"], timeoutMs: 5_000, maxOutputBytes: 512 });
      configuredBitwardenCli.executablePath = executablePath;
      await repository.setLocalSetting(BITWARDEN_CLI_PATH_SETTING, executablePath);
      await audit("provider.cli_path_configured", "success", { safeDetails: "provider=bitwarden;verified_version=true" });
      return {
        providerId: "bitwarden",
        configured: true,
        version: cliVersion(result.stdout)
      };
    } catch (error) {
      throw app.httpErrors.badRequest(`WardSen could not verify the chosen Bitwarden CLI. ${safeErrorMessage(error, [body.executablePath])}`);
    }
  });

  app.get("/api/provider-tools/bitwarden/update", { config: { rateLimit: { max: 5, timeWindow: RATE_LIMIT_WINDOW } } }, async () => {
    try {
      const operatorSelectedExecutable = Boolean(configuredBitwardenCli.executablePath);
      const executable = configuredBitwardenCli.executablePath ?? resolveProviderExecutable({
        toolName: "bw",
        envPathKey: "WARDSEN_BITWARDEN_CLI_PATH",
        trustedCandidates: bitwardenDiagnosticCandidates()
      });
      const result = await runCliCommand({ executable, args: ["--version"], timeoutMs: 5_000, maxOutputBytes: 512 });
      const update = await bitwardenCliUpdateService.check(cliVersion(result.stdout));
      await audit("provider.cli_update_check", "success", { safeDetails: `provider=bitwarden;update_available=${update.updateAvailable}` });
      return { ...update, operatorSelectedExecutable };
    } catch (error) {
      await audit("provider.cli_update_check", "failure", { safeDetails: "provider=bitwarden" });
      const message = safeErrorMessage(error);
      throw app.httpErrors.badRequest(message.startsWith("WardSen could not") ? message : `WardSen could not check Bitwarden CLI updates. ${message}`);
    }
  });

  app.post("/api/delivery-providers/:id/clear-handoff-clipboard", async (request) => {
    const { id } = idParams.parse(request.params);
    const provider = registry.getDeliveryProvider(id);
    if (!provider.clearHandoffClipboard) {
      throw new Error(`${provider.displayName} does not manage a manual handoff clipboard through WardSen.`);
    }
    await provider.clearHandoffClipboard();
    await audit("delivery.manual_handoff.clipboard_clear", "success", { safeDetails: `provider=${provider.id}` });
    return { providerId: provider.id, cleared: true };
  });

  app.post("/api/delivery-providers/:id/test", { config: { rateLimit: { max: 10, timeWindow: RATE_LIMIT_WINDOW } } }, async (request) => {
    const { id } = idParams.parse(request.params);
    const provider = registry.getDeliveryProvider(id);
    if (provider.id === "bitwarden-send") {
      throw app.httpErrors.badRequest("Bitwarden Send readiness is checked against the selected unlocked Bitwarden account when a delivery is created.");
    }
    const result = await provider.testConnection(`provider-configuration-${provider.id}`);
    await audit("delivery.provider_configuration_check", result.ok ? "success" : "failure", {
      safeDetails: `provider=${provider.id};status=${result.status}`
    });
    return {
      providerId: provider.id,
      ready: result.ok && result.status === "unlocked",
      status: result.status,
      safeMessage: result.safeMessage
    };
  });

  app.get("/api/accounts", async () => accountsWithLiveStatus());

  app.post("/api/accounts", async (request) => {
    const body = accountSchema.parse(request.body);
    const now = new Date().toISOString();
    const id = body.id ?? nanoid();
    registry.getCredentialProvider(body.providerId);
    const record: Omit<AccountRecord, "createdAt" | "updatedAt"> = {
      id,
      providerId: body.providerId,
      label: body.label,
      username: body.username,
      serverUrl: body.serverUrl,
      profileDirectory: managedProfileDirectory(profileRoot, id),
      accountType: body.accountType,
      autoLockMinutes: body.autoLockMinutes ?? 10,
      status: "locked",
      lastActivity: now
    };
    rememberAccountProfile(record);
    sessions.ensure(record.id, record.providerId);
    const account = await repository.upsertAccount(record);
    await audit("account.create", "success", { safeDetails: account.providerId });
    return account;
  });

  app.put("/api/accounts/:id", async (request) => {
    const { id } = idParams.parse(request.params);
    const body = accountSchema.omit({ id: true }).partial().parse(request.body);
    const existing = await findAccount(repository, id);
    if (body.providerId && body.providerId !== existing.providerId) {
      throw new Error("Account provider cannot be changed after creation. Create a new account to use a different provider profile.");
    }
    const account = await repository.upsertAccount({
      id,
      providerId: existing.providerId,
      label: body.label ?? existing.label,
      username: body.username ?? existing.username,
      serverUrl: body.serverUrl ?? existing.serverUrl,
      providerPrincipalId: existing.providerPrincipalId,
      profileDirectory: existing.profileDirectory,
      accountType: body.accountType ?? existing.accountType,
      autoLockMinutes: body.autoLockMinutes ?? existing.autoLockMinutes,
      status: existing.status
    });
    rememberAccountProfile(account);
    await audit("account.update", "success", { sourceAccountId: id });
    return account;
  });

  app.get("/api/accounts/:id/operation-preview", async (request) => {
    const { id } = idParams.parse(request.params);
    const account = await findAccount(repository, id);
    const deliveries = await listAllDeliveriesForAccount(id);
    const deliveryImpact = await operationImpactPreview({ deliveries });
    return {
      action: "delete vault account",
      impact: {
        ...deliveryImpact,
        resources: [`Vault account: ${account.label}`, ...deliveryImpact.resources],
        providers: [...new Set([registry.getCredentialProvider(account.providerId).displayName, ...deliveryImpact.providers])]
      }
    };
  });

  app.delete("/api/accounts/:id", async (request) => {
    const { id } = idParams.parse(request.params);
    assertDestructiveConfirmation(request.body, confirmationPhrase("DELETE ACCOUNT", id));
    const account = await findAccount(repository, id);
    try {
      const result = await accountDeletionService.deleteAccount(account);
      await audit("account.delete", "success", {
        sourceAccountId: id,
        safeDetails: `reason=${result.profileCleanup};logout=${result.logout}`
      });
      return { ok: true };
    } catch (error) {
      await audit("account.delete", "failure", {
        sourceAccountId: id,
        safeDetails: `reason=${error instanceof AccountDeletionError ? error.reason : "delete_failed"}`
      });
      throw error;
    }
  });

  app.post("/api/accounts/:id/login", { config: { rateLimit: { max: 5, timeWindow: RATE_LIMIT_WINDOW } } }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = loginSchema.parse(request.body);
    const account = await findAccount(repository, id);
    rememberAccountProfile(account);
    const provider = registry.getCredentialProvider(account.providerId);
    await provider.login(id, body);
    await audit("account.login", "success", { sourceAccountId: id });
    return { ok: true };
  });

  app.post("/api/accounts/:id/terminal-handoff", { config: { rateLimit: { max: 5, timeWindow: RATE_LIMIT_WINDOW } } }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = loginSchema.parse(request.body);
    const account = await findAccount(repository, id);
    rememberAccountProfile(account);
    const provider = registry.getCredentialProvider(account.providerId);
    if (!provider.createTerminalSessionHandoffCommand || !provider.acceptTerminalSessionHandoff) {
      throw app.httpErrors.badRequest(`${provider.displayName} does not support a terminal session handoff.`);
    }
    const expectedIdentity = terminalHandoffIdentityForAccount(account);
    if (provider.id === "bitwarden" && !expectedIdentity.username) {
      sessions.markLocked(id);
      await audit("account.terminal_handoff.create", "failure", { sourceAccountId: id, safeDetails: "reason=account_identity_missing" });
      throw app.httpErrors.badRequest("Edit this Bitwarden account to add its login email before using Terminal login / unlock.");
    }
    const host = request.headers.host;
    if (!host) throw app.httpErrors.badRequest("WardSen could not determine the local service address for terminal login.");
    pruneTerminalSessionHandoffs();
    const token = nanoid(48);
    const launchId = nanoid(32);
    const expiresAt = new Date(Date.now() + TERMINAL_SESSION_HANDOFF_TTL_MS);
    const handoff = { accountId: id, providerId: provider.id, expectedIdentity, expiresAt: expiresAt.getTime(), launchId };
    terminalSessionHandoffs.set(token, handoff);
    try {
      const command = provider.createTerminalSessionHandoffCommand(id, body, {
        claimUrl: `http://${host}/api/accounts/${encodeURIComponent(id)}/terminal-handoff/claim`,
        token
      });
      terminalSessionHandoffs.set(token, { ...handoff, command });
      await audit("account.terminal_handoff.create", "success", { sourceAccountId: id, safeDetails: `expires=${expiresAt.toISOString()}` });
      return { command, launchId, expiresAt: expiresAt.toISOString() };
    } catch (error) {
      terminalSessionHandoffs.delete(token);
      await audit("account.terminal_handoff.create", "failure", { sourceAccountId: id, safeDetails: safeErrorMessage(error) });
      throw error;
    }
  });

  app.get("/api/accounts/:id/terminal-handoff/:launchId/command", async (request, reply) => {
    const { id, launchId } = terminalHandoffLaunchParams.parse(request.params);
    pruneTerminalSessionHandoffs();
    const handoff = [...terminalSessionHandoffs.values()].find((record) => record.accountId === id && record.launchId === launchId);
    if (!handoff?.command) {
      throw app.httpErrors.unauthorized("WardSen terminal launch is missing, expired or invalid. Start Terminal login / unlock again from WardSen.");
    }
    return reply.type("text/plain; charset=utf-8").send(handoff.command);
  });

  app.post("/api/accounts/:id/terminal-handoff/claim", { config: { rateLimit: { max: 8, timeWindow: RATE_LIMIT_WINDOW } } }, async (request) => {
    const { id } = idParams.parse(request.params);
    const handoff = terminalHandoffForClaimRequest(request);
    if (!handoff) {
      throw app.httpErrors.unauthorized("WardSen terminal session handoff is missing, expired or invalid. Start Terminal login / unlock again from WardSen.");
    }
    terminalSessionHandoffs.delete(handoff.token);
    const sessionToken = typeof request.body === "string" ? request.body.trim() : "";
    if (!sessionToken) {
      throw app.httpErrors.badRequest("WardSen terminal session handoff did not receive a session token.");
    }
    const account = await findAccount(repository, id);
    if (account.providerId !== handoff.record.providerId) {
      throw app.httpErrors.unauthorized("WardSen terminal session handoff no longer matches this account.");
    }
    rememberAccountProfile(account);
    const provider = registry.getCredentialProvider(account.providerId);
    if (!provider.acceptTerminalSessionHandoff) {
      throw app.httpErrors.badRequest(`${provider.displayName} does not support a terminal session handoff.`);
    }
    try {
      const accepted = await provider.acceptTerminalSessionHandoff(id, sessionToken, handoff.record.expectedIdentity);
      if (!accepted.providerPrincipalId || (handoff.record.expectedIdentity.providerPrincipalId && accepted.providerPrincipalId !== handoff.record.expectedIdentity.providerPrincipalId)) {
        throw new TerminalSessionHandoffIdentityError("user_id_mismatch");
      }
      const persistedAccount = await repository.upsertAccount({
        id: account.id,
        providerId: account.providerId,
        label: account.label,
        username: account.username,
        serverUrl: account.serverUrl,
        providerPrincipalId: accepted.providerPrincipalId,
        profileDirectory: account.profileDirectory,
        accountType: account.accountType,
        autoLockMinutes: account.autoLockMinutes,
        status: "locked"
      });
      rememberAccountProfile(persistedAccount);
      sessions.markUnlocked(id, provider.id, sessionToken);
      await audit("account.terminal_handoff.claim", "success", { sourceAccountId: id, safeDetails: "identity_verified" });
      return { ok: true };
    } catch (error) {
      sessions.markLocked(id);
      if (error instanceof TerminalSessionHandoffIdentityError) {
        await audit("account.terminal_handoff.claim", "failure", { sourceAccountId: id, safeDetails: `reason=${error.reason}` });
        throw app.httpErrors.unauthorized("WardSen could not verify the Bitwarden terminal session. Start Terminal login / unlock again for this account.");
      }
      throw error;
    }
  });

  app.post("/api/accounts/:id/unlock", { config: { rateLimit: { max: 5, timeWindow: RATE_LIMIT_WINDOW } } }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = unlockSchema.parse(request.body);
    const account = await findAccount(repository, id);
    rememberAccountProfile(account);
    const provider = registry.getCredentialProvider(account.providerId);
    await provider.unlock(id, body);
    await audit("account.unlock", "success", { sourceAccountId: id });
    return { ok: true };
  });

  app.post("/api/accounts/:id/lock", async (request) => {
    const { id } = idParams.parse(request.params);
    const account = await findAccount(repository, id);
    rememberAccountProfile(account);
    const provider = registry.getCredentialProvider(account.providerId);
    await provider.lock(id);
    await audit("account.lock", "success", { sourceAccountId: id });
    return { ok: true };
  });

  app.post("/api/accounts/:id/logout", async (request) => {
    const { id } = idParams.parse(request.params);
    const account = await findAccount(repository, id);
    rememberAccountProfile(account);
    const provider = registry.getCredentialProvider(account.providerId);
    await provider.logout(id);
    await audit("account.logout", "success", { sourceAccountId: id });
    return { ok: true };
  });

  app.post("/api/accounts/:id/sync", async (request) => {
    const { id } = idParams.parse(request.params);
    const account = await findAccount(repository, id);
    rememberAccountProfile(account);
    const provider = registry.getCredentialProvider(account.providerId);
    await provider.sync(id);
    await audit("account.sync", "success", { sourceAccountId: id });
    return { ok: true };
  });

  app.get("/api/accounts/:id/status", async (request) => {
    const { id } = idParams.parse(request.params);
    const account = await findAccount(repository, id);
    rememberAccountProfile(account);
    return registry.getCredentialProvider(account.providerId).testConnection(id);
  });

  app.get("/api/credentials/search", async (request) => {
    const query = credentialSearchSchema.parse(request.query);
    const searchPagination = query.pageSize === "all"
      ? { page: 1, pageSize: Number.MAX_SAFE_INTEGER }
      : { page: query.page, pageSize: query.pageSize };
    const accounts = await accountsWithLiveStatus();
    const selectedAccounts = query.accountId ? accounts.filter((account) => account.id === query.accountId) : accounts;
    const results: CredentialSummary[] = [];
    const errors: Array<{ accountId: string; providerId: string; safeMessage: string }> = [];
    for (const account of selectedAccounts.filter((candidate) => !query.providerId || candidate.providerId === query.providerId)) {
      rememberAccountProfile(account);
      if (account.status !== "unlocked") {
        if (query.accountId) {
          errors.push({
            accountId: account.id,
            providerId: account.providerId,
            safeMessage: `Vault is ${account.status.replace("_", " ")}. Unlock this account before searching credentials.`
          });
        }
        continue;
      }
      const provider = registry.getCredentialProvider(account.providerId);
      try {
        const providerResults = await provider.search(account.id, query.q, searchPagination);
        if (providerResults.length > 0 || !query.q.trim()) {
          results.push(...providerResults);
        } else {
          const fuzzyCandidates = await provider.search(account.id, "", { page: 1, pageSize: Number.MAX_SAFE_INTEGER });
          results.push(...fuzzyFilterCredentials(fuzzyCandidates, query.q, searchPagination));
        }
      } catch (error) {
        errors.push({ accountId: account.id, providerId: account.providerId, safeMessage: safeErrorMessage(error) });
      }
    }
    return { items: results, page: searchPagination.page, pageSize: query.pageSize, total: results.length, errors };
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

  app.get("/api/people/:id/operation-preview", async (request) => {
    const { id } = idParams.parse(request.params);
    const person = await repository.getPerson(id);
    if (!person) throw app.httpErrors.notFound("Person not found");
    return {
      action: "offboard person",
      impact: await operationImpactPreview({ people: [person], deliveries: await listAllDeliveriesForPerson(id) })
    };
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
    assertDestructiveConfirmation(request.body, confirmationPhrase("OFFBOARD PERSON", id));
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

  app.get("/api/employees", async (request) => {
    const query = employeeQuerySchema.parse(request.query);
    return repository.listEmployees(query);
  });

  app.post("/api/employees", async (request) => {
    const body = employeeSchema.parse(request.body);
    await assertEmployeePersonLink(body.personId, body.assignedEmail);
    const employee = await repository.upsertEmployee({ ...body, active: body.active ?? true });
    await audit("employee.upsert", "success", { safeDetails: `employee=${employee.id}` });
    return employee;
  });

  app.post("/api/employees/bulk-from-people", async (request) => {
    const body = bulkEmployeeProvisionSchema.parse(request.body);
    const uniquePersonIds = [...new Set(body.personIds)];
    const created: EmployeeRecord[] = [];
    const skipped: Array<{ personId: string; reason: string; assignedEmail?: string; employeeId?: string }> = [];
    for (const personId of uniquePersonIds) {
      const person = await repository.getPerson(personId);
      if (!person || !person.active) {
        skipped.push({ personId, reason: "Person is missing or inactive." });
        continue;
      }
      if (!person.email) {
        skipped.push({ personId, reason: "Person has no assigned email." });
        continue;
      }
      const assignedEmail = normalizeEmail(person.email);
      const existingEmployee = await repository.getEmployeeByAssignedEmail(assignedEmail);
      if (existingEmployee) {
        skipped.push({ personId, assignedEmail, employeeId: existingEmployee.id, reason: "Assigned email already has an employee identity." });
        continue;
      }
      try {
        const employee = await repository.upsertEmployee({
          personId: person.id,
          name: person.name,
          assignedEmail,
          team: person.groupName ?? body.defaultTeam,
          role: person.role ?? body.defaultRole,
          active: body.active ?? true
        });
        created.push(employee);
      } catch (error) {
        skipped.push({ personId, assignedEmail, reason: safeErrorMessage(error) });
      }
    }
    await audit("employee.bulk_from_people", "success", { safeDetails: `created=${created.length};skipped=${skipped.length}` });
    return { created, skipped };
  });

  app.put("/api/employees/:id", async (request) => {
    const { id } = idParams.parse(request.params);
    const existing = await repository.getEmployee(id);
    if (!existing) throw app.httpErrors.notFound("Employee not found");
    const body = employeeSchema.partial().parse(request.body);
    if (body.assignedEmail && normalizeEmail(body.assignedEmail) !== existing.assignedEmail) {
      throw new Error("Employee assigned email is admin-controlled. Create a new employee record to change identity.");
    }
    const personId = body.personId ?? existing.personId;
    await assertEmployeePersonLink(personId, existing.assignedEmail);
    const employee = await repository.upsertEmployee({
      id,
      personId,
      name: body.name ?? existing.name,
      assignedEmail: existing.assignedEmail,
      team: body.team ?? existing.team,
      role: body.role ?? existing.role,
      active: body.active ?? existing.active
    });
    await audit("employee.update", "success", { safeDetails: `employee=${employee.id}` });
    return employee;
  });

  app.post("/api/employees/:id/sign-in-code", { config: { rateLimit: { max: 10, timeWindow: RATE_LIMIT_WINDOW } } }, async (request) => {
    const { id } = idParams.parse(request.params);
    const body = issueEmployeeSignInCodeSchema.parse(request.body ?? {});
    const employee = await repository.getEmployee(id);
    if (!employee || !employee.active) {
      throw app.httpErrors.notFound("Employee not found");
    }
    const code = employeeCode();
    const expiresAt = new Date(Date.now() + (body.ttlMinutes ?? EMPLOYEE_SIGN_IN_CODE_TTL_MS / 60000) * 60000).toISOString();
    await repository.createEmployeeSignInCode({
      employeeId: employee.id,
      assignedEmail: employee.assignedEmail,
      codeHash: employeeSecretHash("code", employee.id, normalizeEmployeeCode(code)),
      expiresAt
    });
    const emailDraft = body.senderEmail ? buildEmployeeSignInEmailDraft({
      senderEmail: body.senderEmail,
      employeeName: employee.name,
      assignedEmail: employee.assignedEmail,
      code,
      expiresAt
    }) : undefined;
    const delivery = emailDraft ? "email_draft" : "manual";
    await audit("employee.sign_in_code.issue", "success", { safeDetails: `employee=${employee.id};delivery=${delivery};expires=${expiresAt}` });
    return {
      employeeId: employee.id,
      assignedEmail: employee.assignedEmail,
      code,
      expiresAt,
      delivery,
      emailDraft
    };
  });

  app.post("/api/employee-sessions", { config: { rateLimit: { max: 5, timeWindow: RATE_LIMIT_WINDOW } } }, async (request) => {
    const body = employeeSessionSchema.parse(request.body);
    const employee = await repository.getEmployeeByAssignedEmail(body.assignedEmail);
    const invalidMessage = "Invalid or expired employee sign-in code.";
    if (!employee || !employee.active) {
      throw app.httpErrors.unauthorized(invalidMessage);
    }
    const codeHash = employeeSecretHash("code", employee.id, normalizeEmployeeCode(body.code));
    const signInCode = await repository.getEmployeeSignInCodeByHash(employee.id, codeHash);
    if (!signInCode || signInCode.usedAt || new Date(signInCode.expiresAt).getTime() <= Date.now()) {
      throw app.httpErrors.unauthorized(invalidMessage);
    }
    await repository.updateEmployeeSignInCode(signInCode.id, { usedAt: new Date().toISOString() });
    const sessionToken = `employee_${nanoid(40)}`;
    const expiresAt = new Date(Date.now() + EMPLOYEE_SESSION_TTL_MS).toISOString();
    const session = await repository.createEmployeeSession({
      employeeId: employee.id,
      assignedEmail: employee.assignedEmail,
      tokenHash: employeeSecretHash("session", "employee-session", sessionToken),
      expiresAt
    });
    await audit("employee.session.create", "success", { safeDetails: `employee=${employee.id};session=${session.id}` });
    return { sessionToken, expiresAt, employee };
  });

  app.get("/api/employee-portal/me", async (request) => {
    const { employee, session } = await requireEmployeeSession(request);
    return { employee, expiresAt: session.expiresAt };
  });

  app.get("/api/employee-portal/catalog", async (request) => {
    const { employee } = await requireEmployeeSession(request);
    const query = employeePortalCatalogQuerySchema.parse(request.query);
    return repository.listCredentialCatalog({
      page: query.page,
      pageSize: query.pageSize,
      active: true,
      employeeId: employee.id,
      employeeTeam: employee.team,
      employeeRole: employee.role,
      search: query.search
    });
  });

  app.get("/api/employee-portal/credential-requests", async (request) => {
    const { employee } = await requireEmployeeSession(request);
    const query = credentialAccessRequestQuerySchema.parse(request.query);
    return repository.listCredentialAccessRequests({
      page: query.page,
      pageSize: query.pageSize,
      employeeId: employee.id,
      status: query.status
    });
  });

  app.post("/api/employee-portal/credential-requests", async (request) => {
    const { employee } = await requireEmployeeSession(request);
    const body = employeePortalRequestSchema.parse(request.body);
    const entry = await assertEmployeeCanRequestCatalogEntry(employee, body.catalogEntryId);
    const breakGlass = breakGlassRequestFields(body, entry.id);
    const accessRequest = await repository.createCredentialAccessRequest({
      employeeId: employee.id,
      assignedEmail: employee.assignedEmail,
      catalogEntryId: entry.id,
      sourceProviderId: entry.sourceProviderId,
      sourceAccountId: entry.sourceAccountId,
      sourceItemId: entry.sourceItemId,
      credentialName: entry.credentialName,
      reason: body.reason,
      ticketRef: body.ticketRef,
      expectedDurationMinutes: body.expectedDurationMinutes,
      ...breakGlass
    });
    await audit("credential_request.employee_portal_create", "success", { sourceAccountId: entry.sourceAccountId, safeDetails: `request=${accessRequest.id};employee=${employee.id}` });
    if (accessRequest.breakGlass) {
      await audit("credential_request.break_glass", "success", { sourceAccountId: entry.sourceAccountId, safeDetails: `request=${accessRequest.id};employee=${employee.id}` });
      return accessRequest;
    }
    return applyCatalogAutoApproval(accessRequest, entry);
  });

  app.post("/api/employee-sessions/current/logout", async (request) => {
    const { session } = await requireEmployeeSession(request);
    await repository.updateEmployeeSession(session.id, { revokedAt: new Date().toISOString() });
    await audit("employee.session.revoke", "success", { safeDetails: `employee=${session.employeeId};session=${session.id}` });
    return { ok: true };
  });

  app.get("/api/credential-catalog", async (request) => {
    const query = credentialCatalogQuerySchema.parse(request.query);
    const employee = query.employeeId ? await repository.getEmployee(query.employeeId) : undefined;
    return repository.listCredentialCatalog({
      ...query,
      employeeTeam: employee?.team,
      employeeRole: employee?.role
    });
  });

  app.get("/api/employee-catalog", async (request) => {
    const query = employeeCatalogQuerySchema.parse(request.query);
    const employee = await assertEmployeeAssignedEmail(query.employeeId, query.assignedEmail);
    return repository.listCredentialCatalog({
      page: query.page,
      pageSize: query.pageSize,
      active: true,
      employeeId: employee.id,
      employeeTeam: employee.team,
      employeeRole: employee.role,
      search: query.search
    });
  });

  app.post("/api/credential-catalog", async (request) => {
    const body = credentialCatalogEntrySchema.parse(request.body);
    await assertCatalogPolicy(body);
    const sourceAccount = await findAccount(repository, body.sourceAccountId);
    if (sourceAccount.providerId !== body.sourceProviderId) {
      throw new Error("Catalog source account does not belong to the requested credential provider");
    }
    const entry = await repository.upsertCredentialCatalogEntry({ ...body, active: body.active ?? true });
    await audit("credential_catalog.upsert", "success", { sourceAccountId: body.sourceAccountId, safeDetails: `entry=${entry.id}` });
    return entry;
  });

  app.put("/api/credential-catalog/:id", async (request) => {
    const { id } = idParams.parse(request.params);
    const existing = await repository.getCredentialCatalogEntry(id);
    if (!existing) throw app.httpErrors.notFound("Credential catalog entry not found");
    const body = credentialCatalogEntryPatchSchema.parse(request.body);
    const updated = {
      id,
      sourceProviderId: body.sourceProviderId ?? existing.sourceProviderId,
      sourceAccountId: body.sourceAccountId ?? existing.sourceAccountId,
      sourceItemId: body.sourceItemId ?? existing.sourceItemId,
      credentialName: body.credentialName ?? existing.credentialName,
      username: body.username ?? existing.username,
      domain: body.domain ?? existing.domain,
      tags: body.tags ?? existing.tags,
      riskTier: body.riskTier ?? existing.riskTier,
      allowedEmployeeIds: body.allowedEmployeeIds ?? existing.allowedEmployeeIds,
      allowedTeams: body.allowedTeams ?? existing.allowedTeams,
      allowedRoles: body.allowedRoles ?? existing.allowedRoles,
      autoApprovalPolicy: body.autoApprovalPolicy ?? existing.autoApprovalPolicy,
      active: body.active ?? existing.active
    };
    await assertCatalogPolicy(updated);
    const sourceAccount = await findAccount(repository, updated.sourceAccountId);
    if (sourceAccount.providerId !== updated.sourceProviderId) {
      throw new Error("Catalog source account does not belong to the requested credential provider");
    }
    const entry = await repository.upsertCredentialCatalogEntry(updated);
    await audit("credential_catalog.update", "success", { sourceAccountId: entry.sourceAccountId, safeDetails: `entry=${entry.id}` });
    return entry;
  });

  app.get("/api/credential-requests", async (request) => {
    const query = credentialAccessRequestQuerySchema.parse(request.query);
    return repository.listCredentialAccessRequests(query);
  });

  app.post("/api/credential-requests", async (request) => {
    const body = credentialAccessRequestSchema.parse(request.body);
    const employee = await assertEmployeeAssignedEmail(body.employeeId, body.assignedEmail);
    const entry = await assertEmployeeCanRequestCatalogEntry(employee, body.catalogEntryId);
    const breakGlass = breakGlassRequestFields(body, entry.id);
    const accessRequest = await repository.createCredentialAccessRequest({
      employeeId: employee.id,
      assignedEmail: employee.assignedEmail,
      catalogEntryId: entry.id,
      sourceProviderId: entry.sourceProviderId,
      sourceAccountId: entry.sourceAccountId,
      sourceItemId: entry.sourceItemId,
      credentialName: entry.credentialName,
      reason: body.reason,
      ticketRef: body.ticketRef,
      expectedDurationMinutes: body.expectedDurationMinutes,
      ...breakGlass
    });
    await audit("credential_request.create", "success", { sourceAccountId: entry.sourceAccountId, safeDetails: `request=${accessRequest.id};employee=${employee.id}` });
    if (accessRequest.breakGlass) {
      await audit("credential_request.break_glass", "success", { sourceAccountId: entry.sourceAccountId, safeDetails: `request=${accessRequest.id};employee=${employee.id}` });
      return accessRequest;
    }
    return applyCatalogAutoApproval(accessRequest, entry);
  });

  app.post("/api/credential-requests/:id/deny", async (request) => {
    const { id } = idParams.parse(request.params);
    const body = credentialAccessDecisionSchema.parse(request.body);
    const accessRequest = await findCredentialAccessRequest(repository, id);
    if (accessRequest.status !== "pending" && accessRequest.status !== "approved" && accessRequest.status !== "break_glass") {
      throw app.httpErrors.conflict("Only pending, policy-approved or break-glass credential requests can be denied.");
    }
    const updated = await repository.updateCredentialAccessRequest(id, {
      status: "denied",
      decidedAt: new Date().toISOString(),
      approver: body.approver,
      decisionReason: body.decisionReason
    });
    await audit("credential_request.deny", "success", { sourceAccountId: updated.sourceAccountId, safeDetails: `request=${id}` });
    return updated;
  });

  app.post("/api/credential-requests/:id/approve", async (request) => {
    const { id } = idParams.parse(request.params);
    const body = credentialAccessApprovalSchema.parse(request.body);
    if (body.confirmRiskSummary !== true) {
      throw new Error("Approving a credential request requires confirmation of requester, assigned email, credential, expiry and view limit");
    }
    const accessRequest = await findCredentialAccessRequest(repository, id);
    if (accessRequest.status !== "pending" && accessRequest.status !== "approved" && accessRequest.status !== "break_glass") {
      throw app.httpErrors.conflict("Only pending, policy-approved or break-glass credential requests can be fulfilled.");
    }
    const employee = await repository.getEmployee(accessRequest.employeeId);
    if (!employee || !employee.active || employee.assignedEmail !== accessRequest.assignedEmail) {
      throw new Error("Credential request employee identity is no longer active or no longer matches the assigned email.");
    }
    const deliveryResult = await createEmployeeRequestDelivery({
      operationId: operationIdFromRequest(request.headers["x-wardsen-idempotency-key"], body.operationId) ?? `request-${id}`,
      accessRequest,
      employee,
      approval: body
    });
    const { delivery } = deliveryResult;
    const updated = await repository.updateCredentialAccessRequest(id, {
      status: "fulfilled",
      decidedAt: new Date().toISOString(),
      approver: body.approver,
      decisionReason: body.decisionReason,
      deliveryId: delivery.id,
      deliveryProviderId: body.deliveryProviderId,
      deliveryAccountId: body.deliveryAccountId
    });
    await audit("credential_request.approve", "success", {
      sourceAccountId: accessRequest.sourceAccountId,
      deliveryAccountId: body.deliveryAccountId,
      deliveryId: delivery.id,
      safeDetails: `request=${id};employee=${employee.id}`
    });
    return { request: updated, delivery, deliveryAccessCode: deliveryResult.deliveryAccessCode };
  });

  app.post("/api/credential-requests/:id/replacement-link", async (request) => {
    const { id } = idParams.parse(request.params);
    const body = credentialAccessReplacementSchema.parse(request.body);
    assertDestructiveConfirmation(request.body, confirmationPhrase("REPLACE REQUEST", id));
    if (body.confirmRiskSummary !== true) {
      throw new Error("Replacing a credential request link requires confirmation of requester, assigned email, credential, expiry, view limit and previous link revoke.");
    }
    const accessRequest = await findCredentialAccessRequest(repository, id);
    if (accessRequest.status !== "fulfilled" || !accessRequest.deliveryId) {
      throw app.httpErrors.conflict("Only fulfilled credential requests with an existing delivery link can be replaced.");
    }
    const employee = await repository.getEmployee(accessRequest.employeeId);
    if (!employee || !employee.active || employee.assignedEmail !== accessRequest.assignedEmail) {
      throw new Error("Credential request employee identity is no longer active or no longer matches the assigned email.");
    }
    const previousDelivery = await repository.getDelivery(accessRequest.deliveryId);
    if (!previousDelivery) {
      throw new Error("Credential request delivery could not be found for replacement.");
    }
    await revokeDeliveryBeforeReplacement(previousDelivery);
    const deliveryResult = await createEmployeeRequestDelivery({
      operationId: operationIdFromRequest(request.headers["x-wardsen-idempotency-key"], body.operationId) ?? `request-replacement-${id}-${nanoid()}`,
      accessRequest,
      employee,
      approval: body
    });
    const { delivery } = deliveryResult;
    const replacedAt = new Date().toISOString();
    const updated = await repository.updateCredentialAccessRequest(id, {
      status: "fulfilled",
      decidedAt: replacedAt,
      approver: body.approver,
      decisionReason: body.decisionReason ?? `Replacement link issued: ${body.replacementReason}`,
      deliveryId: delivery.id,
      deliveryProviderId: body.deliveryProviderId,
      deliveryAccountId: body.deliveryAccountId,
      previousDeliveryId: previousDelivery.id,
      replacementCount: (accessRequest.replacementCount ?? 0) + 1,
      lastReplacementAt: replacedAt
    });
    await audit("credential_request.replace_link", "success", {
      sourceAccountId: accessRequest.sourceAccountId,
      deliveryAccountId: body.deliveryAccountId,
      deliveryId: delivery.id,
      safeDetails: `request=${id};employee=${employee.id};previous=${previousDelivery.id}`
    });
    return {
      request: updated,
      previousDelivery: await repository.getDelivery(previousDelivery.id),
      delivery,
      deliveryAccessCode: deliveryResult.deliveryAccessCode
    };
  });

  app.post("/api/deliveries", async (request) => {
    const body = deliverySchema.parse(request.body);
    return createOneDelivery({
      ...body,
      operationId: operationIdFromRequest(request.headers["x-wardsen-idempotency-key"], body.operationId)
    });
  });

  app.post("/api/deliveries/custom-text", async (request) => {
    const body = customTextDeliverySchema.parse(request.body);
    const { text, ...delivery } = body;
    const deliveryAccount = await findAccount(repository, body.deliveryAccountId);
    return createOneDelivery({
      ...delivery,
      operationId: operationIdFromRequest(request.headers["x-wardsen-idempotency-key"], body.operationId),
      sourceProviderId: deliveryAccount.providerId,
      sourceAccountId: deliveryAccount.id,
      sourceItemId: "custom-text"
    }, {
      sourceCredential: { title: "Custom secure text", urls: [] },
      credentialName: "Custom secure text",
      deliveryText: text,
      sensitiveValues: [text],
      rejectExistingOperation: true
    });
  });

  app.post("/api/deliveries/bundle", async (request) => {
    const body = deliveryBundleSchema.parse(request.body);
    if (body.confirmBundle !== true) {
      throw new Error("Credential bundle requires explicit confirmation.");
    }
    if (isManualHandoffProvider(body.deliveryProviderId)) {
      throw new Error("Manual Ente Paste handoff does not support grouped credentials. Use separate links or an audited provider.");
    }
    const uniqueSourceCredentials = new Map<string, z.infer<typeof deliveryCredentialReferenceSchema>>();
    for (const source of body.sourceCredentials) {
      const key = `${source.sourceProviderId}:${source.sourceAccountId}:${source.sourceItemId}`;
      if (uniqueSourceCredentials.has(key)) {
        throw new Error("Credential bundle cannot include the same credential more than once.");
      }
      uniqueSourceCredentials.set(key, source);
    }

    await assertDeliveryProviderEnabled(body.deliveryProviderId);
    const deliveryAccount = await findAccount(repository, body.deliveryAccountId);
    rememberAccountProfile(deliveryAccount);
    assertDeliveryAccountMatchesProvider(body.deliveryProviderId, deliveryAccount);
    const deliveryProvider = registry.getDeliveryProvider(body.deliveryProviderId);
    await assertDeliveryProviderReady(deliveryProvider, body.deliveryAccountId, deliveryAccount);

    const bundledCredentials = await Promise.all(body.sourceCredentials.map(async (source) => {
      const sourceAccount = await findAccount(repository, source.sourceAccountId);
      rememberAccountProfile(sourceAccount);
      if (sourceAccount.providerId !== source.sourceProviderId) {
        throw new Error("A selected source account does not belong to its requested credential provider.");
      }
      const sourceProvider = registry.getCredentialProvider(source.sourceProviderId);
      return {
        source,
        credential: await sourceProvider.getCredential(source.sourceAccountId, source.sourceItemId)
      };
    }));
    const primary = bundledCredentials[0]!;
    const credentialName = `Credential bundle (${bundledCredentials.length})`;
    const bundleText = formatDeliveryCredentialBundleText(bundledCredentials.map((item) => item.credential));
    return createOneDelivery({
      operationId: operationIdFromRequest(request.headers["x-wardsen-idempotency-key"], body.operationId),
      sourceProviderId: primary.source.sourceProviderId,
      sourceAccountId: primary.source.sourceAccountId,
      sourceItemId: primary.source.sourceItemId,
      deliveryProviderId: body.deliveryProviderId,
      deliveryAccountId: body.deliveryAccountId,
      recipient: body.recipient,
      expiresAt: body.expiresAt,
      viewLimit: body.viewLimit,
      viewOnce: body.viewOnce,
      accessPassword: body.accessPassword,
      hideText: body.hideText,
      deliveryMethod: body.deliveryMethod,
      bundleSourceCredentials: body.sourceCredentials
    }, {
      sourceCredential: { title: credentialName, urls: [] },
      credentialName,
      deliveryText: bundleText,
      sensitiveValues: bundledCredentials.flatMap((item) => sensitiveCredentialValues(item.credential))
    });
  });

  app.post("/api/deliveries/bulk", async (request) => {
    const body = bulkDeliverySchema.parse(request.body);
    const bulkOperationId = operationIdFromRequest(request.headers["x-wardsen-idempotency-key"], body.operationId);
    if (isManualHandoffProvider(body.deliveryProviderId)) {
      throw new Error("Manual Ente Paste handoff is single-delivery only because each handoff uses the local clipboard. Use Bitwarden Send for bulk per-recipient links.");
    }
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
        if ((await repository.getBatch(batchId))?.cancelled) break;
        try {
          const delivery = await createOneDelivery({
            ...body,
            operationId: bulkOperationId ? childOperationId(bulkOperationId, current.id) : undefined,
            recipient: current,
            batchId
          });
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
    const latestBatch = await repository.getBatch(batchId);
    await repository.updateBatch(batchId, {
      completedCount,
      failedCount,
      cancelled: latestBatch?.cancelled ?? false,
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

  app.get("/api/batches/:id/operation-preview", async (request) => {
    const { id } = idParams.parse(request.params);
    const batch = await repository.getBatch(id);
    if (!batch) throw app.httpErrors.notFound("Batch not found");
    return {
      action: "cancel batch",
      impact: await operationImpactPreview({ deliveries: await listAllBatchDeliveries(id), batch })
    };
  });

  app.get("/api/batches", async (request) => {
    const query = paginationSchema.parse(request.query);
    return repository.listBatches(query);
  });

  app.post("/api/batches/:id/cancel", async (request) => {
    const { id } = idParams.parse(request.params);
    assertDestructiveConfirmation(request.body, confirmationPhrase("CANCEL BATCH", id));
    const existing = await repository.getBatch(id);
    if (!existing) throw app.httpErrors.notFound("Batch not found");
    if (existing.completedAt) {
      throw new Error("Completed batches cannot be cancelled. Cancel only stops queued or in-progress bulk work.");
    }
    const batch = await repository.updateBatch(id, { cancelled: true, completedAt: new Date().toISOString() });
    await audit("batch.cancel", "cancelled", { safeDetails: id });
    return batch;
  });

  app.get("/api/audit-log", async (request) => {
    const query = paginationSchema.parse(request.query);
    return repository.listAuditLog(query);
  });

  app.post("/api/retention/prune", async (request) => {
    assertDestructiveConfirmation(request.body, RETENTION_PRUNE_CONFIRMATION);
    const body = retentionPruneSchema.parse(request.body);
    if (!body.auditLogBefore && !body.employeeAuthBefore) {
      throw new Error("Retention pruning requires auditLogBefore or employeeAuthBefore.");
    }
    const pruned = {
      auditLog: 0,
      employeeSignInCodes: 0,
      employeeSessions: 0
    };
    if (body.auditLogBefore) {
      assertRetentionCutoff("Audit log", body.auditLogBefore);
      pruned.auditLog = await repository.pruneAuditLogBefore(body.auditLogBefore);
    }
    if (body.employeeAuthBefore) {
      assertRetentionCutoff("Employee auth", body.employeeAuthBefore);
      pruned.employeeSignInCodes = await repository.pruneExpiredEmployeeSignInCodes(body.employeeAuthBefore);
      pruned.employeeSessions = await repository.pruneExpiredEmployeeSessions(body.employeeAuthBefore);
    }
    const total = pruned.auditLog + pruned.employeeSignInCodes + pruned.employeeSessions;
    await audit("retention.prune", "success", {
      safeDetails: JSON.stringify({
        auditLogBefore: body.auditLogBefore ?? null,
        employeeAuthBefore: body.employeeAuthBefore ?? null,
        pruned
      })
    });
    return { pruned: { ...pruned, total } };
  });

  async function createEmployeeRequestDelivery(input: {
    operationId: string;
    accessRequest: CredentialAccessRequestRecord;
    employee: EmployeeRecord;
    approval: z.infer<typeof credentialAccessApprovalSchema>;
  }) {
    const { operationId, accessRequest, employee, approval } = input;
    let deliveryAccessCode: string | undefined;
    let deliveryAccessCodeIssuedAt: string | undefined;
    if (approval.issueDeliveryAccessCode) {
      if (approval.accessPassword) {
        throw new Error("Choose either a generated employee delivery code or a manual provider access password, not both.");
      }
      const provider = registry.getDeliveryProvider(approval.deliveryProviderId);
      const capabilities = await provider.getCapabilities();
      if (!capabilities.accessPassword) {
        throw new Error(`${provider.displayName} cannot enforce a WardSen delivery access code. Choose Bitwarden Send or Onetime Secret, or create the delivery without this code.`);
      }
      deliveryAccessCode = employeeDeliveryCode();
      deliveryAccessCodeIssuedAt = new Date().toISOString();
    }

    const delivery = await createOneDelivery({
      operationId,
      sourceProviderId: accessRequest.sourceProviderId,
      sourceAccountId: accessRequest.sourceAccountId,
      sourceItemId: accessRequest.sourceItemId,
      deliveryProviderId: approval.deliveryProviderId,
      deliveryAccountId: approval.deliveryAccountId,
      recipient: { id: employee.id, name: employee.name, email: accessRequest.assignedEmail },
      expiresAt: approval.expiresAt,
      viewLimit: approval.viewLimit,
      viewOnce: approval.viewOnce,
      accessPassword: deliveryAccessCode ?? approval.accessPassword,
      hideText: approval.hideText,
      deliveryMethod: "email",
      deliveryAccessCodeIssuedAt
    });
    const issued = Boolean(deliveryAccessCode && deliveryAccessCodeIssuedAt === delivery.deliveryAccessCodeIssuedAt);
    if (issued) {
      await audit("delivery.access_code.issue", "success", {
        sourceAccountId: accessRequest.sourceAccountId,
        deliveryAccountId: approval.deliveryAccountId,
        deliveryId: delivery.id,
        safeDetails: `request=${accessRequest.id};employee=${employee.id};expires=${delivery.expiresAt}`
      });
    }
    return { delivery, deliveryAccessCode: issued ? deliveryAccessCode : undefined };
  }

  async function createOneDelivery(body: DeliveryCreateBody, contentOverride?: DeliveryContentOverride) {
    const operationId = body.operationId ?? nanoid();
    return withDeliveryOperation(operationId, () => createOneDeliveryLocked(body, operationId, contentOverride));
  }

  async function createOneDeliveryLocked(body: DeliveryCreateBody, operationId: string, contentOverride?: DeliveryContentOverride) {
    const viewLimit = parseViewLimit(body.viewLimit);
    const expiresAt = new Date(body.expiresAt);
    const policySnapshot = deliveryPolicySnapshot(body, expiresAt, viewLimit);
    const operationFingerprint = deliveryOperationFingerprint(policySnapshot);
    const existing = await repository.getDeliveryByOperationId(operationId);
    if (existing) {
      if (contentOverride?.rejectExistingOperation) {
        throw app.httpErrors.conflict("Custom text delivery cannot reuse an operation id. Create a new link instead.");
      }
      return existingOperationResponse(existing, operationFingerprint);
    }

    assertFutureExpiry(expiresAt);
    await assertDeliveryProviderEnabled(body.deliveryProviderId);
    const sourceAccount = await findAccount(repository, body.sourceAccountId);
    rememberAccountProfile(sourceAccount);
    if (sourceAccount.providerId !== body.sourceProviderId) {
      throw new Error("Source account does not belong to the requested credential provider");
    }
    const deliveryAccount = await findAccount(repository, body.deliveryAccountId);
    rememberAccountProfile(deliveryAccount);
    assertDeliveryAccountMatchesProvider(body.deliveryProviderId, deliveryAccount);
    const sourceProvider = registry.getCredentialProvider(body.sourceProviderId);
    const deliveryProvider = registry.getDeliveryProvider(body.deliveryProviderId);
    const capabilities = await deliveryProvider.getCapabilities();
    await assertDeliveryProviderReady(deliveryProvider, body.deliveryAccountId, deliveryAccount);
    assertDeliveryOptionsSupported(capabilities, {
      viewLimit,
      viewOnce: body.viewOnce,
      accessPassword: body.accessPassword,
      hideText: body.hideText
    });
    const sensitiveCredential = contentOverride?.sourceCredential ?? await sourceProvider.getCredential(body.sourceAccountId, body.sourceItemId);
    const credentialName = contentOverride?.credentialName ?? sensitiveCredential.title;
    const sensitiveValues = contentOverride?.sensitiveValues ?? sensitiveCredentialValues(sensitiveCredential);
    const pending = await repository.createDelivery({
      operationId,
      operationFingerprint,
      policySnapshot,
      sourceProviderId: body.sourceProviderId,
      sourceAccountId: body.sourceAccountId,
      sourceItemId: body.sourceItemId,
      deliveryProviderId: body.deliveryProviderId,
      deliveryAccountId: body.deliveryAccountId,
      credentialName,
      personId: body.recipient?.id,
      batchId: body.batchId,
      deliveryMethod: body.deliveryMethod,
      expiresAt: expiresAt.toISOString(),
      viewLimit,
      status: "creating",
      deliveryAccessCodeRequired: Boolean(body.deliveryAccessCodeIssuedAt),
      deliveryAccessCodeIssuedAt: body.deliveryAccessCodeIssuedAt
    });
    let result: Awaited<ReturnType<DeliveryProvider["createDelivery"]>> | undefined;
    try {
      result = await deliveryProvider.createDelivery({
        operationId: pending.operationId ?? pending.id,
        sourceCredential: sensitiveCredential,
        deliveryText: contentOverride?.deliveryText,
        sensitiveValues: contentOverride?.sensitiveValues,
        recipient: body.recipient,
        expiresAt,
        viewLimit,
        viewOnce: body.viewOnce,
        accessPassword: body.accessPassword,
        hideText: body.hideText,
        deliveryAccountId: body.deliveryAccountId
      });
      const record = await repository.updateDelivery(pending.id, {
        providerDeliveryId: result.deliveryId,
        expiresAt: result.expiresAt.toISOString(),
        viewLimit: result.viewLimit,
        status: result.status ?? "active",
        ...(deliveryAccessObserved(result.status) ? { firstViewedAt: new Date().toISOString() } : {})
      });
      deliveryUrlCache.set(record.id, result.url);
      await audit("delivery.create", "success", {
        sourceAccountId: body.sourceAccountId,
        deliveryAccountId: body.deliveryAccountId,
        personId: body.recipient?.id,
        deliveryId: record.id,
        safeDetails: `provider=${body.deliveryProviderId}`
      });
      return sanitizeDelivery(record, result.url);
    } catch (error) {
      if (result?.deliveryId) {
        await deliveryProvider.revoke(body.deliveryAccountId, result.deliveryId).catch(() => undefined);
      }
      deliveryUrlCache.delete(pending.id);
      await repository.updateDelivery(pending.id, { status: "failed", providerDeliveryId: result?.deliveryId }).catch(() => undefined);
      const safeMessage = safeErrorMessage(error, [...sensitiveValues, body.accessPassword].filter((value): value is string => Boolean(value)));
      await audit("delivery.create", "failure", {
        sourceAccountId: body.sourceAccountId,
        deliveryAccountId: body.deliveryAccountId,
        personId: body.recipient?.id,
        deliveryId: pending.id,
        safeDetails: safeMessage
      });
      throw new Error(safeMessage);
    }
  }

  async function withDeliveryOperation<T>(operationId: string, operation: () => Promise<T>): Promise<T> {
    const previous = deliveryOperationTails.get(operationId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    deliveryOperationTails.set(operationId, tail);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (deliveryOperationTails.get(operationId) === tail) {
        deliveryOperationTails.delete(operationId);
      }
    }
  }

  function existingOperationResponse(existing: DeliveryRecord, expectedFingerprint: string) {
    if (existing.operationFingerprint !== expectedFingerprint) {
      throw app.httpErrors.conflict("Delivery operation id was already used for a different request.");
    }
    const cachedUrl = deliveryUrlCache.get(existing.id);
    if (cachedUrl && isReturnableDelivery(existing)) {
      return sanitizeDelivery(existing, cachedUrl);
    }
    if (existing.status === "creating" || existing.status === "queued") {
      throw app.httpErrors.conflict("Delivery operation is already in progress.");
    }
    if (existing.status === "failed") {
      throw app.httpErrors.conflict("Delivery operation failed previously. Review the audit log and retry with a new operation id if a replacement link is required.");
    }
    throw app.httpErrors.conflict("Delivery operation already exists, but its one-time URL is no longer available in this app session. Review or revoke the existing delivery before creating a replacement link.");
  }

  async function listAllBatchDeliveries(batchId: string): Promise<DeliveryRecord[]> {
    const deliveries: DeliveryRecord[] = [];
    let page = 1;
    while (true) {
      const result = await repository.listDeliveries({ batchId, page, pageSize: 100 });
      deliveries.push(...result.items);
      if (deliveries.length >= result.total || result.items.length === 0) return deliveries;
      page += 1;
    }
  }

  async function listAllDeliveriesForPerson(personId: string): Promise<DeliveryRecord[]> {
    const deliveries: DeliveryRecord[] = [];
    let page = 1;
    while (true) {
      const result = await repository.listDeliveries({ page, pageSize: 100 });
      deliveries.push(...result.items.filter((delivery) => delivery.personId === personId));
      if (page * result.pageSize >= result.total || result.items.length === 0) return deliveries;
      page += 1;
    }
  }

  async function listAllDeliveriesForAccount(accountId: string): Promise<DeliveryRecord[]> {
    const deliveries: DeliveryRecord[] = [];
    let page = 1;
    while (true) {
      const result = await repository.listDeliveries({ page, pageSize: 100 });
      deliveries.push(...result.items.filter((delivery) => delivery.sourceAccountId === accountId || delivery.deliveryAccountId === accountId));
      if (page * result.pageSize >= result.total || result.items.length === 0) return deliveries;
      page += 1;
    }
  }

  async function clearAccountSensitiveResultCache(accountId: string): Promise<void> {
    accountProfileDirectories.delete(accountId);
    for (const [token, handoff] of terminalSessionHandoffs) {
      if (handoff.accountId === accountId) terminalSessionHandoffs.delete(token);
    }
    for (const delivery of await listAllDeliveriesForAccount(accountId)) {
      deliveryUrlCache.delete(delivery.id);
    }
  }

  async function operationImpactPreview(input: { deliveries: DeliveryRecord[]; people?: Array<{ id: string; name: string }>; batch?: { id: string; requestedCount: number; completedCount: number; failedCount: number; cancelled: boolean } }) {
    const peopleById = new Map((input.people ?? []).map((person) => [person.id, person.name]));
    for (const personId of new Set(input.deliveries.map((delivery) => delivery.personId).filter((personId): personId is string => Boolean(personId)))) {
      if (peopleById.has(personId)) continue;
      const person = await repository.getPerson(personId);
      if (person) peopleById.set(person.id, person.name);
    }
    const providerNames = [...new Set(input.deliveries.map((delivery) => {
      const provider = registry.listDeliveryProviders().find((candidate) => candidate.id === delivery.deliveryProviderId);
      return provider?.displayName ?? delivery.deliveryProviderId;
    }))].sort();
    const resources = [...new Set(input.deliveries.map((delivery) => delivery.credentialName))].sort();
    const activeDeliveryCount = input.deliveries.filter((delivery) => ["active", "viewed", "limit_reached", "creating", "queued"].includes(delivery.status)).length;
    return {
      affectedPeople: [...peopleById.values()].sort(),
      resources,
      providers: providerNames,
      deliveryCount: input.deliveries.length,
      activeDeliveryCount,
      batch: input.batch ? {
        id: input.batch.id,
        requestedCount: input.batch.requestedCount,
        completedCount: input.batch.completedCount,
        failedCount: input.batch.failedCount,
        cancelled: input.batch.cancelled
      } : undefined
    };
  }

  async function reconcileExpiredDelivery(delivery: DeliveryRecord): Promise<DeliveryRecord> {
    if (delivery.status !== "active" && delivery.status !== "viewed") return delivery;
    const expiresAt = Date.parse(delivery.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt > Date.now()) return delivery;
    const updated = await repository.updateDelivery(delivery.id, { status: "expired" });
    await audit("delivery.expire.local", "success", {
      deliveryAccountId: delivery.deliveryAccountId,
      deliveryId: delivery.id,
      safeDetails: `expires=${delivery.expiresAt}`
    });
    return updated;
  }

  app.get("/api/deliveries", async (request) => {
    const query = deliveryQuerySchema.parse(request.query);
    const result = await repository.listDeliveries(query);
    return {
      ...result,
      items: await Promise.all(result.items.map((delivery) => reconcileExpiredDelivery(delivery)))
    };
  });

  app.get("/api/deliveries/:id", async (request) => {
    const { id } = idParams.parse(request.params);
    const delivery = await repository.getDelivery(id);
    if (!delivery) throw app.httpErrors.notFound("Delivery not found");
    return reconcileExpiredDelivery(delivery);
  });

  app.post("/api/deliveries/:id/refresh", async (request) => {
    const { id } = idParams.parse(request.params);
    const storedDelivery = await repository.getDelivery(id);
    if (!storedDelivery) throw app.httpErrors.notFound("Delivery not found");
    const delivery = await reconcileExpiredDelivery(storedDelivery);
    if (delivery.status === "expired") return delivery;
    const provider = registry.getDeliveryProvider(delivery.deliveryProviderId);
    await assertDeliveryProviderSupports(provider, "statusLookup", "refresh status");
    const status = await provider.getStatus(delivery.deliveryAccountId, delivery.providerDeliveryId ?? delivery.id);
    const checkedAt = new Date().toISOString();
    const firstViewedAt = delivery.firstViewedAt ?? (deliveryAccessObserved(status.status, status.accessCount) ? checkedAt : undefined);
    const deliveryAccessCodeObservedAt = delivery.deliveryAccessCodeObservedAt
      ?? (delivery.deliveryAccessCodeRequired && deliveryAccessObserved(status.status, status.accessCount) ? checkedAt : undefined);
    const updated = await repository.updateDelivery(id, {
      status: status.status,
      accessCount: status.accessCount,
      expiresAt: status.expiresAt?.toISOString() ?? delivery.expiresAt,
      revokedAt: status.revokedAt?.toISOString() ?? delivery.revokedAt,
      ...(firstViewedAt ? { firstViewedAt } : {}),
      ...(deliveryAccessCodeObservedAt ? { deliveryAccessCodeObservedAt } : {}),
      lastCheckedAt: checkedAt
    });
    await audit("delivery.refresh", "success", { deliveryAccountId: delivery.deliveryAccountId, deliveryId: id });
    if (!delivery.deliveryAccessCodeObservedAt && deliveryAccessCodeObservedAt) {
      await audit("delivery.access_code.observed", "success", {
        deliveryAccountId: delivery.deliveryAccountId,
        deliveryId: id,
        safeDetails: `observed=${deliveryAccessCodeObservedAt}`
      });
    }
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
      expiresAt: retryExpiry(delivery).toISOString(),
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
    await assertDeliveryProviderSupports(provider, "revokeLink", "revoke links");
    await provider.revoke(delivery.deliveryAccountId, delivery.providerDeliveryId ?? delivery.id);
    const updated = await repository.updateDelivery(id, { status: "revoked", revokedAt: new Date().toISOString() });
    deliveryUrlCache.delete(id);
    await audit("delivery.revoke", "success", { deliveryAccountId: delivery.deliveryAccountId, deliveryId: id });
    return updated;
  });

  app.get("/api/deliveries/:id/operation-preview", async (request) => {
    const { id } = idParams.parse(request.params);
    const delivery = await repository.getDelivery(id);
    if (!delivery) throw app.httpErrors.notFound("Delivery not found");
    return {
      action: "revoke delivery",
      impact: await operationImpactPreview({ deliveries: [delivery] })
    };
  });

  app.get("/api/deliveries/:id/revoke-batch/operation-preview", async (request) => {
    const { id } = idParams.parse(request.params);
    const delivery = await repository.getDelivery(id);
    if (!delivery) throw app.httpErrors.notFound("Delivery not found");
    if (!delivery.batchId) throw app.httpErrors.badRequest("This delivery was not created in a bulk batch, so it has no related batch links to revoke.");
    return {
      action: "revoke batch links",
      impact: await operationImpactPreview({ deliveries: await listAllBatchDeliveries(delivery.batchId) })
    };
  });

  app.post("/api/deliveries/:id/revoke-batch", async (request) => {
    const { id } = idParams.parse(request.params);
    const delivery = await repository.getDelivery(id);
    if (!delivery) throw app.httpErrors.notFound("Delivery not found");
    if (!delivery.batchId) throw app.httpErrors.badRequest("This delivery was not created in a bulk batch, so it has no related batch links to revoke.");
    assertDestructiveConfirmation(request.body, confirmationPhrase("REVOKE BATCH LINKS", delivery.batchId));

    const batchDeliveries = await listAllBatchDeliveries(delivery.batchId);
    const targets = batchDeliveries.filter((candidate) => ["active", "viewed", "limit_reached"].includes(candidate.status));
    const providers = new Map<string, DeliveryProvider>();
    for (const target of targets) {
      const provider = registry.getDeliveryProvider(target.deliveryProviderId);
      await assertDeliveryProviderSupports(provider, "revokeLink", "contain batch links");
      providers.set(target.id, provider);
    }

    const revokedAt = new Date().toISOString();
    const failed: Array<{ deliveryId: string; error: string }> = [];
    let revokedCount = 0;
    for (const target of targets) {
      try {
        await providers.get(target.id)!.revoke(target.deliveryAccountId, target.providerDeliveryId ?? target.id);
        await repository.updateDelivery(target.id, { status: "revoked", revokedAt });
        deliveryUrlCache.delete(target.id);
        revokedCount += 1;
        await audit("delivery.batch_containment_revoke", "success", {
          sourceAccountId: target.sourceAccountId,
          deliveryAccountId: target.deliveryAccountId,
          deliveryId: target.id,
          safeDetails: `batch=${delivery.batchId}`
        });
      } catch (error) {
        const safeMessage = safeErrorMessage(error);
        failed.push({ deliveryId: target.id, error: safeMessage });
        await audit("delivery.batch_containment_revoke", "failure", {
          sourceAccountId: target.sourceAccountId,
          deliveryAccountId: target.deliveryAccountId,
          deliveryId: target.id,
          safeDetails: `batch=${delivery.batchId};${safeMessage}`
        });
      }
    }
    await audit("delivery.batch_containment", failed.length ? "failure" : "success", {
      sourceAccountId: delivery.sourceAccountId,
      deliveryAccountId: delivery.deliveryAccountId,
      deliveryId: id,
      safeDetails: `batch=${delivery.batchId};revoked=${revokedCount};failed=${failed.length}`
    });
    return {
      batchId: delivery.batchId,
      revokedCount,
      inactiveCount: batchDeliveries.length - targets.length,
      failed
    };
  });

  app.addHook("onClose", async () => {
    clearInterval(autoLockTimer);
    terminalSessionHandoffs.clear();
    for (const account of await repository.listAccounts()) {
      try {
        rememberAccountProfile(account);
        await registry.getCredentialProvider(account.providerId).lock(account.id);
      } catch {
        // A rejected profile must never be passed to a provider during shutdown.
      }
    }
    sessions.lockAll();
  });

  for (const retry of await accountDeletionService.retryPendingProfileCleanup()) {
    await audit("account.profile_cleanup.retry", retry.outcome === "pending" ? "failure" : "success", {
      sourceAccountId: retry.accountId,
      safeDetails: `reason=${retry.reason ?? retry.outcome}`
    });
  }
  await reconcileStuckDeliveries();

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
    const inactiveIds = sessions.inactiveAccountIds(new Date(), (accountId) => accountsById.get(accountId)?.autoLockMinutes ?? 10);
    for (const id of inactiveIds) {
      const account = accountsById.get(id);
      if (!account) continue;
      rememberAccountProfile(account);
      try {
        await registry.getCredentialProvider(account.providerId).lock(id);
        sessions.markLocked(id);
        await audit("account.auto_lock", "success", { sourceAccountId: id });
      } catch (error) {
        sessions.markLocked(id);
        await audit("account.auto_lock", "failure", { sourceAccountId: id, safeDetails: safeErrorMessage(error) });
      }
    }
  }

  async function accountsWithLiveStatus(): Promise<AccountRecord[]> {
    const accounts = await repository.listAccounts();
    for (const account of accounts) rememberAccountProfile(account);
    const sessionsByAccount = new Map(sessions.snapshot().map((session) => [session.accountId, session]));
    return accounts.map((account) => {
      const session = sessionsByAccount.get(account.id);
      return session && session.providerId === account.providerId
        ? { ...account, status: session.status, lastActivity: session.lastActivityAt?.toISOString() ?? account.lastActivity }
        : account;
    });
  }

  async function assertEmployeeAssignedEmail(employeeId: string, assignedEmail: string): Promise<EmployeeRecord> {
    const employee = await repository.getEmployee(employeeId);
    if (!employee || !employee.active) {
      throw new Error("Employee is not active or does not exist.");
    }
    if (employee.assignedEmail !== normalizeEmail(assignedEmail)) {
      throw new Error("Credential requests must use the employee assigned email.");
    }
    return employee;
  }

  async function assertEmployeePersonLink(personId: string | undefined, assignedEmail: string): Promise<void> {
    if (!personId) return;
    const person = await repository.getPerson(personId);
    if (!person || !person.active) {
      throw app.httpErrors.badRequest("Linked person must be an active WardSen person.");
    }
    if (!person.email) {
      throw app.httpErrors.badRequest("Linked person must have an email before employee request access can be granted.");
    }
    if (normalizeEmail(person.email) !== normalizeEmail(assignedEmail)) {
      throw app.httpErrors.badRequest("Employee assigned email must match the linked person's email.");
    }
  }

  async function assertEmployeeCanRequestCatalogEntry(employee: EmployeeRecord, catalogEntryId: string): Promise<CredentialCatalogEntry> {
    const entry = await repository.getCredentialCatalogEntry(catalogEntryId);
    if (!entry || !entry.active) {
      throw new Error("Credential catalog entry is not available.");
    }
    if (!catalogEntryAllowsEmployee(entry, employee)) {
      throw new Error("Employee is not allowed to request this credential catalog entry.");
    }
    return entry;
  }

  async function requireEmployeeSession(request: { headers: Record<string, string | string[] | undefined> }): Promise<{ employee: EmployeeRecord; session: EmployeeSessionRecord }> {
    const token = employeeSessionTokenFromHeaders(request.headers);
    if (!token) {
      throw app.httpErrors.unauthorized("Employee session required.");
    }
    const tokenHash = employeeSecretHash("session", "employee-session", token);
    const session = await repository.getEmployeeSessionByTokenHash(tokenHash);
    if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) {
      throw app.httpErrors.unauthorized("Employee session is invalid or expired.");
    }
    const employee = await repository.getEmployee(session.employeeId);
    if (!employee || !employee.active || employee.assignedEmail !== session.assignedEmail) {
      throw app.httpErrors.unauthorized("Employee session no longer matches an active employee.");
    }
    return { employee, session };
  }

  async function revokeDeliveryBeforeReplacement(delivery: DeliveryRecord): Promise<void> {
    if (["revoked", "expired", "failed", "cancelled"].includes(delivery.status)) return;
    const provider = registry.getDeliveryProvider(delivery.deliveryProviderId);
    await assertDeliveryProviderSupports(provider, "revokeLink", "replace links by revoking the previous delivery");
    await provider.revoke(delivery.deliveryAccountId, delivery.providerDeliveryId ?? delivery.id);
    await repository.updateDelivery(delivery.id, { status: "revoked", revokedAt: new Date().toISOString() });
    deliveryUrlCache.delete(delivery.id);
    await audit("delivery.revoke", "success", {
      deliveryAccountId: delivery.deliveryAccountId,
      deliveryId: delivery.id,
      safeDetails: "request_replacement"
    });
  }

  async function assertCatalogPolicy(policy: Pick<CredentialCatalogEntry, "allowedEmployeeIds" | "allowedTeams" | "allowedRoles">): Promise<void> {
    if (policy.allowedEmployeeIds.length === 0 && policy.allowedTeams.length === 0 && policy.allowedRoles.length === 0) {
      throw new Error("Catalog entries must name at least one allowed employee, team or role.");
    }
    for (const employeeId of policy.allowedEmployeeIds) {
      const employee = await repository.getEmployee(employeeId);
      if (!employee || !employee.active) {
        throw new Error(`Catalog allowed employee is not active or does not exist: ${employeeId}`);
      }
    }
  }

  async function applyCatalogAutoApproval(accessRequest: CredentialAccessRequestRecord, entry: CredentialCatalogEntry): Promise<CredentialAccessRequestRecord> {
    const policy = entry.autoApprovalPolicy;
    if (!policy) return accessRequest;

    const skipReason = catalogAutoApprovalSkipReason(policy, entry, accessRequest);
    if (skipReason) {
      await audit("credential_request.auto_approval_skip", "cancelled", {
        sourceAccountId: accessRequest.sourceAccountId,
        safeDetails: `request=${accessRequest.id};reason=${skipReason}`
      });
      return accessRequest;
    }

    const updated = await repository.updateCredentialAccessRequest(accessRequest.id, {
      status: "approved",
      decidedAt: new Date().toISOString(),
      approver: "WardSen auto-approval policy",
      decisionReason: autoApprovalDecisionReason(policy)
    });
    await audit("credential_request.auto_approve", "success", {
      sourceAccountId: accessRequest.sourceAccountId,
      safeDetails: `request=${accessRequest.id};policy=maxRisk:${policy.maxRiskTier}`
    });
    return updated;
  }

  function breakGlassRequestFields(body: z.infer<typeof employeePortalRequestSchema> | z.infer<typeof credentialAccessRequestSchema>, catalogEntryId: string): Partial<CredentialAccessRequestRecord> {
    if (!body.breakGlass) return {};
    assertDestructiveConfirmation(body, confirmationPhrase("BREAK GLASS", catalogEntryId));
    if (body.confirmRiskSummary !== true) {
      throw new Error("Break-glass credential requests require confirmation of emergency need, requester, assigned email and audit impact.");
    }
    if (!body.breakGlassJustification) {
      throw new Error("Break-glass credential requests require an emergency justification.");
    }
    return {
      status: "break_glass",
      breakGlass: true,
      breakGlassJustification: body.breakGlassJustification,
      breakGlassConfirmedAt: new Date().toISOString()
    };
  }

  function catalogAutoApprovalSkipReason(policy: NonNullable<CredentialCatalogEntry["autoApprovalPolicy"]>, entry: CredentialCatalogEntry, accessRequest: CredentialAccessRequestRecord): string | undefined {
    if (!riskTierWithinPolicy(entry.riskTier, policy.maxRiskTier)) {
      return "risk_tier_exceeds_policy";
    }
    if (policy.requireTicketRef && !accessRequest.ticketRef) {
      return "ticket_required";
    }
    if (policy.maxExpectedDurationMinutes !== undefined) {
      const requestedDuration = accessRequest.expectedDurationMinutes;
      if (!requestedDuration || requestedDuration > policy.maxExpectedDurationMinutes) {
        return "duration_exceeds_policy";
      }
    }
    return undefined;
  }

  function autoApprovalDecisionReason(policy: NonNullable<CredentialCatalogEntry["autoApprovalPolicy"]>): string {
    const ticketRule = policy.requireTicketRef ? "ticket required" : "ticket optional";
    const durationRule = policy.maxExpectedDurationMinutes ? `duration <= ${policy.maxExpectedDurationMinutes}m` : "duration unrestricted";
    return `Auto-approved by catalog policy (${policy.maxRiskTier} risk max, ${durationRule}, ${ticketRule}). Admin confirmation still required before delivery.`;
  }

  function catalogEntryAllowsEmployee(entry: CredentialCatalogEntry, employee: EmployeeRecord): boolean {
    const team = employee.team?.trim().toLowerCase();
    const role = employee.role?.trim().toLowerCase();
    return entry.allowedEmployeeIds.includes(employee.id)
      || Boolean(team && entry.allowedTeams.some((candidate) => candidate.trim().toLowerCase() === team))
      || Boolean(role && entry.allowedRoles.some((candidate) => candidate.trim().toLowerCase() === role));
  }

  function rememberAccountProfile(account: Pick<AccountRecord, "id" | "profileDirectory">): void {
    const expectedProfileDirectory = managedProfileDirectory(profileRoot, account.id);
    if (!pathsEqual(account.profileDirectory, expectedProfileDirectory)) {
      throw new Error("Stored provider profile directory is not managed by WardSen. Reconnect this account to create an isolated profile.");
    }
    assertManagedProfileDirectoryTarget(profileRoot, expectedProfileDirectory);
    accountProfileDirectories.set(account.id, expectedProfileDirectory);
  }

  function managedProfileDirectoryForAccount(accountId: string): string | undefined {
    const profileDirectory = accountProfileDirectories.get(accountId);
    if (!profileDirectory) return undefined;
    const expectedProfileDirectory = managedProfileDirectory(profileRoot, accountId);
    if (!pathsEqual(profileDirectory, expectedProfileDirectory)) {
      throw new Error("Stored provider profile directory is not managed by WardSen. Reconnect this account to create an isolated profile.");
    }
    assertManagedProfileDirectoryTarget(profileRoot, expectedProfileDirectory);
    return expectedProfileDirectory;
  }

  async function reconcileStuckDeliveries(): Promise<void> {
    let page = 1;
    while (true) {
      const deliveries = await repository.listDeliveries({ page, pageSize: 100 });
      for (const delivery of deliveries.items) {
        const status = String(delivery.status);
        if (status !== "creating" && status !== "handoff_pending") continue;
        const recoveryDetail = await recoverStuckDeliveryFromProvider(delivery);
        if (recoveryDetail?.recovered) continue;
        await repository.updateDelivery(delivery.id, { status: "failed" });
        await audit("delivery.reconcile", "failure", {
          deliveryAccountId: delivery.deliveryAccountId,
          deliveryId: delivery.id,
          safeDetails: recoveryDetail?.safeDetails ? `stuck_status=${status};${recoveryDetail.safeDetails}` : `stuck_status=${status}`
        });
      }
      if (page * deliveries.pageSize >= deliveries.total) break;
      page += 1;
    }
  }

  async function recoverStuckDeliveryFromProvider(delivery: DeliveryRecord): Promise<{ recovered: boolean; safeDetails?: string } | undefined> {
    if (!delivery.operationId) return undefined;
    const provider = registry.getDeliveryProvider(delivery.deliveryProviderId);
    const capabilities = await provider.getCapabilities();
    if (!capabilities.statusLookup) return undefined;
    if (!provider.findDeliveryByOperationId) return undefined;
    try {
      const status = await provider.findDeliveryByOperationId(delivery.deliveryAccountId, delivery.operationId);
      if (!status) return undefined;
      const checkedAt = new Date().toISOString();
      const firstViewedAt = delivery.firstViewedAt ?? (deliveryAccessObserved(status.status, status.accessCount) ? checkedAt : undefined);
      const deliveryAccessCodeObservedAt = delivery.deliveryAccessCodeObservedAt
        ?? (delivery.deliveryAccessCodeRequired && deliveryAccessObserved(status.status, status.accessCount) ? checkedAt : undefined);
      await repository.updateDelivery(delivery.id, {
        providerDeliveryId: status.deliveryId,
        status: status.status,
        accessCount: status.accessCount,
        expiresAt: status.expiresAt?.toISOString() ?? delivery.expiresAt,
        revokedAt: status.revokedAt?.toISOString() ?? delivery.revokedAt,
        ...(firstViewedAt ? { firstViewedAt } : {}),
        ...(deliveryAccessCodeObservedAt ? { deliveryAccessCodeObservedAt } : {}),
        lastCheckedAt: checkedAt
      });
      await audit("delivery.reconcile", "success", {
        deliveryAccountId: delivery.deliveryAccountId,
        deliveryId: delivery.id,
        safeDetails: `recovered_operation=${delivery.operationId}`
      });
      if (!delivery.deliveryAccessCodeObservedAt && deliveryAccessCodeObservedAt) {
        await audit("delivery.access_code.observed", "success", {
          deliveryAccountId: delivery.deliveryAccountId,
          deliveryId: delivery.id,
          safeDetails: `observed=${deliveryAccessCodeObservedAt};reconciled=true`
        });
      }
      return { recovered: true };
    } catch (error) {
      return { recovered: false, safeDetails: `provider_lookup_failed=${safeErrorMessage(error)}` };
    }
  }

  function explicitOptInManifest(providerId: string) {
    const manifest = providerManifestFor(providerId);
    if (!manifest || manifest.kind !== "delivery" || !manifest.requiresExplicitOptIn) {
      throw app.httpErrors.badRequest("This delivery provider does not require an explicit weaker-provider opt-in.");
    }
    return manifest;
  }

  function providerOptInSettingKey(providerId: string): string {
    return `delivery-provider-opt-in:${providerId}`;
  }

  async function isDeliveryProviderEnabled(providerId: string): Promise<boolean> {
    const manifest = providerManifestFor(providerId);
    if (!manifest?.requiresExplicitOptIn) return true;
    return (await repository.getLocalSetting(providerOptInSettingKey(providerId))) === "enabled";
  }

  async function assertDeliveryProviderEnabled(providerId: string): Promise<void> {
    const manifest = providerManifestFor(providerId);
    if (!manifest?.requiresExplicitOptIn || await isDeliveryProviderEnabled(providerId)) return;
    if (manifest.configurationRequired) {
      throw app.httpErrors.forbidden(`${manifest.displayName} is disabled until its local configuration check succeeds and an operator enables it in Settings > Optional Delivery Providers.`);
    }
    throw app.httpErrors.forbidden(`${manifest.displayName} is disabled by default because WardSen cannot provide complete link lifecycle controls. Review its warning and enable it in Settings with the exact confirmation phrase before creating a delivery.`);
  }
}

async function assertDeliveryProviderSupports(provider: DeliveryProvider, capability: keyof Awaited<ReturnType<DeliveryProvider["getCapabilities"]>>, action: string): Promise<void> {
  const capabilities = await provider.getCapabilities();
  if (!capabilities[capability]) {
    throw new Error(`${provider.displayName} cannot ${action} through WardSen because this provider does not expose that capability.`);
  }
}

function isAuthorizedLocalApiRequest(header: string | string[] | undefined, apiToken?: string, allowUnauthenticatedLocalApi?: boolean): boolean {
  if (!apiToken) {
    return allowUnauthenticatedLocalApi === true || process.env.NODE_ENV === "test" || process.env.WARDSEN_ALLOW_UNAUTHENTICATED_LOCAL_API === "true";
  }
  const value = Array.isArray(header) ? header[0] : header;
  return value === apiToken;
}

function firstHeaderValue(header: string | string[] | undefined): string | undefined {
  return Array.isArray(header) ? header[0] : header;
}

function operationIdFromRequest(header: string | string[] | undefined, bodyOperationId?: string): string | undefined {
  const headerValue = firstHeaderValue(header);
  if (!headerValue) return bodyOperationId;
  const parsed = operationIdSchema.parse(headerValue);
  if (bodyOperationId && bodyOperationId !== parsed) {
    throw new Error("Body operationId and X-WardSen-Idempotency-Key must match when both are provided.");
  }
  return parsed;
}

function applyCorsHeaders(reply: { header: (name: string, value: string) => unknown }, origin: string): void {
  reply.header("access-control-allow-origin", origin);
  reply.header("vary", "Origin");
  reply.header("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  reply.header("access-control-allow-headers", "content-type,x-wardsen-api-token,x-wardsen-idempotency-key,x-wardsen-employee-session");
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
const terminalHandoffLaunchParams = idParams.extend({ launchId: z.string().min(1).max(128) });
const BULK_EMPLOYEE_PROVISION_CONFIRMATION = "PROVISION EMPLOYEES FROM PEOPLE";
const accountSchema = z.object({
  id: z.string().optional(),
  providerId: z.string().min(1),
  label: z.string().min(1),
  username: z.string().optional(),
  serverUrl: z.string().url().optional(),
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
const credentialSearchSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.union([z.literal("all"), z.coerce.number().int().positive().max(100)]).default(25),
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
const providerExecutablePathSchema = z.object({
  executablePath: z.string().trim().min(1).max(2048),
  trustAcknowledged: z.literal(true)
});
const retentionPruneSchema = destructiveConfirmationSchema.extend({
  auditLogBefore: z.string().datetime().optional(),
  employeeAuthBefore: z.string().datetime().optional()
});
const operationIdSchema = z.string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/, "Operation id may contain letters, numbers, dots, underscores, colons and hyphens only");
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
const normalizedEmailSchema = z.string().email().transform((value) => normalizeEmail(value));
const employeeQuerySchema = paginationSchema.extend({
  active: z.coerce.boolean().optional(),
  search: z.string().optional()
});
const employeeSchema = z.object({
  id: z.string().optional(),
  personId: z.string().min(1).optional(),
  name: z.string().min(1),
  assignedEmail: normalizedEmailSchema,
  team: z.string().optional(),
  role: z.string().optional(),
  active: z.boolean().optional()
});
const bulkEmployeeProvisionSchema = z.object({
  personIds: z.array(z.string().min(1)).min(1).max(100),
  confirm: z.literal(BULK_EMPLOYEE_PROVISION_CONFIRMATION),
  confirmRiskSummary: z.literal(true),
  defaultTeam: z.string().optional(),
  defaultRole: z.string().optional(),
  active: z.boolean().optional()
});
const issueEmployeeSignInCodeSchema = z.object({
  ttlMinutes: z.coerce.number().int().min(5).max(60).optional(),
  senderEmail: normalizedEmailSchema.optional()
});
const employeeSessionSchema = z.object({
  assignedEmail: normalizedEmailSchema,
  code: z.string().trim().min(6).max(32)
});
const credentialCatalogQuerySchema = paginationSchema.extend({
  active: z.coerce.boolean().optional(),
  employeeId: z.string().optional(),
  search: z.string().optional()
});
const employeeCatalogQuerySchema = paginationSchema.extend({
  employeeId: z.string().min(1),
  assignedEmail: normalizedEmailSchema,
  search: z.string().optional()
});
const employeePortalCatalogQuerySchema = paginationSchema.extend({
  search: z.string().optional()
});
const catalogAutoApprovalPolicySchema = z.object({
  maxRiskTier: z.enum(["low", "medium", "high", "critical"]).default("low"),
  maxExpectedDurationMinutes: z.coerce.number().int().positive().max(60 * 24 * 30).optional(),
  requireTicketRef: z.boolean().default(true)
});
const credentialCatalogEntryBaseSchema = z.object({
  id: z.string().optional(),
  sourceProviderId: z.string().min(1),
  sourceAccountId: z.string().min(1),
  sourceItemId: z.string().min(1),
  credentialName: z.string().min(1),
  username: z.string().optional(),
  domain: z.string().optional(),
  tags: z.array(z.string().min(1)).default([]),
  riskTier: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  allowedEmployeeIds: z.array(z.string().min(1)).default([]),
  allowedTeams: z.array(z.string().min(1)).default([]),
  allowedRoles: z.array(z.string().min(1)).default([]),
  autoApprovalPolicy: catalogAutoApprovalPolicySchema.optional(),
  active: z.boolean().optional()
});
const credentialCatalogEntrySchema = credentialCatalogEntryBaseSchema.refine((value) => value.allowedEmployeeIds.length > 0 || value.allowedTeams.length > 0 || value.allowedRoles.length > 0, {
  message: "Catalog entries must name at least one allowed employee, team or role."
});
const credentialCatalogEntryPatchSchema = credentialCatalogEntryBaseSchema.partial();
const credentialAccessRequestQuerySchema = paginationSchema.extend({
  employeeId: z.string().optional(),
  status: z.enum(["pending", "approved", "break_glass", "denied", "fulfilled", "cancelled"]).optional()
});
const breakGlassRequestSchema = {
  breakGlass: z.boolean().optional(),
  breakGlassJustification: z.string().trim().min(12).max(1000).optional(),
  confirm: z.string().optional(),
  confirmRiskSummary: z.boolean().optional()
};
const credentialAccessRequestSchema = z.object({
  employeeId: z.string().min(1),
  assignedEmail: normalizedEmailSchema,
  catalogEntryId: z.string().min(1),
  reason: z.string().trim().min(8).max(1000),
  ticketRef: z.string().trim().min(1).max(200).optional(),
  expectedDurationMinutes: z.number().int().positive().max(60 * 24 * 30).optional(),
  ...breakGlassRequestSchema
});
const employeePortalRequestSchema = z.object({
  catalogEntryId: z.string().min(1),
  reason: z.string().trim().min(8).max(1000),
  ticketRef: z.string().trim().min(1).max(200).optional(),
  expectedDurationMinutes: z.number().int().positive().max(60 * 24 * 30).optional(),
  ...breakGlassRequestSchema
});
const credentialAccessDecisionSchema = z.object({
  approver: z.string().trim().min(1).max(200),
  decisionReason: z.string().trim().min(1).max(1000).optional()
});
const credentialAccessApprovalSchema = credentialAccessDecisionSchema.extend({
  operationId: operationIdSchema.optional(),
  deliveryProviderId: z.string().min(1),
  deliveryAccountId: z.string().min(1),
  expiresAt: z.string(),
  viewLimit: z.union([z.string(), z.number()]).optional(),
  viewOnce: z.boolean().optional(),
  accessPassword: z.string().optional(),
  hideText: z.boolean().optional(),
  issueDeliveryAccessCode: z.boolean().optional(),
  confirmRiskSummary: z.boolean().optional()
});
const credentialAccessReplacementSchema = credentialAccessApprovalSchema.extend({
  replacementReason: z.string().trim().min(8).max(1000)
});
const csvImportSchema = z.object({
  csv: z.string().max(1024 * 1024)
});
const deliverySchema = z.object({
  operationId: operationIdSchema.optional(),
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
const deliveryCredentialReferenceSchema = z.object({
  sourceProviderId: z.string().min(1),
  sourceAccountId: z.string().min(1),
  sourceItemId: z.string().min(1)
});
const deliveryBundleSchema = deliverySchema.omit({
  sourceProviderId: true,
  sourceAccountId: true,
  sourceItemId: true
}).extend({
  sourceCredentials: z.array(deliveryCredentialReferenceSchema).min(2).max(20),
  confirmBundle: z.boolean().optional()
});
const customTextDeliverySchema = deliverySchema.omit({
  sourceProviderId: true,
  sourceAccountId: true,
  sourceItemId: true
}).extend({
  text: z.string().max(16 * 1024).refine((value) => value.trim().length > 0, "Custom text cannot be blank.")
});
type DeliveryCreateBody = z.infer<typeof deliverySchema> & {
  batchId?: string;
  deliveryAccessCodeIssuedAt?: string;
  bundleSourceCredentials?: Array<z.infer<typeof deliveryCredentialReferenceSchema>>;
};
interface DeliveryContentOverride {
  sourceCredential: SensitiveCredential;
  credentialName: string;
  deliveryText?: string;
  sensitiveValues: string[];
  rejectExistingOperation?: boolean;
}
const bulkDeliverySchema = deliverySchema.omit({ recipient: true }).extend({
  recipients: z.array(z.object({ id: z.string(), name: z.string(), email: z.string().optional(), phone: z.string().optional() })).min(1).max(500),
  concurrency: z.number().int().positive().max(5).optional(),
  confirmRiskSummary: z.boolean().optional(),
  largeBatchConfirmation: z.string().optional()
});
const LARGE_BATCH_RECIPIENT_THRESHOLD = 25;
const EMPLOYEE_SIGN_IN_CODE_TTL_MS = 15 * 60 * 1000;
const EMPLOYEE_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const RETENTION_PRUNE_CONFIRMATION = "PRUNE RETENTION";
const employeeCode = customAlphabet("23456789ABCDEFGHJKLMNPQRSTUVWXYZ", 10);
const employeeDeliveryCodeValue = customAlphabet("23456789ABCDEFGHJKLMNPQRSTUVWXYZ", 16);

async function findAccount(repository: WardSenRepository, id: string): Promise<AccountRecord> {
  const account = (await repository.listAccounts()).find((candidate) => candidate.id === id);
  if (!account) throw new Error(`Account not found: ${id}`);
  return account;
}

function terminalHandoffIdentityForAccount(account: AccountRecord): TerminalSessionHandoffIdentity {
  return {
    username: account.username?.trim() ?? "",
    serverUrl: account.serverUrl,
    providerPrincipalId: account.providerPrincipalId
  };
}

async function findCredentialAccessRequest(repository: WardSenRepository, id: string): Promise<CredentialAccessRequestRecord> {
  const accessRequest = await repository.getCredentialAccessRequest(id);
  if (!accessRequest) throw new Error(`Credential access request not found: ${id}`);
  return accessRequest;
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeEmployeeCode(value: string): string {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

function employeeSecretHash(kind: "code" | "session", scope: string, value: string): string {
  return createHash("sha256").update(`wardsen-employee-${kind}-v1:${scope}:${value}`).digest("hex");
}

function employeeDeliveryCode(): string {
  const value = employeeDeliveryCodeValue();
  return `WDS-${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}-${value.slice(12)}`;
}

function buildEmployeeSignInEmailDraft(input: {
  senderEmail: string;
  employeeName: string;
  assignedEmail: string;
  code: string;
  expiresAt: string;
}) {
  return {
    senderEmail: input.senderEmail,
    to: input.assignedEmail,
    subject: "WardSen employee portal sign-in code",
    body: [
      `Hi ${input.employeeName},`,
      "",
      "Use this one-time code to sign in to the WardSen employee portal:",
      input.code,
      "",
      `Assigned email: ${input.assignedEmail}`,
      `Expires: ${input.expiresAt}`,
      "",
      "WardSen does not use a permanent employee password for this flow. Only use this code if you expected a WardSen access request."
    ].join("\n")
  };
}

function employeeSessionTokenFromHeaders(headers: Record<string, string | string[] | undefined>): string | undefined {
  const direct = firstHeader(headers["x-wardsen-employee-session"]);
  if (direct) return direct.trim();
  const authorization = firstHeader(headers.authorization);
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  return bearer?.trim();
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function sanitizeDelivery(record: DeliveryRecord, url: string) {
  return {
    ...record,
    oneTimeDeliveryUrl: url
  };
}

function retryExpiry(delivery: DeliveryRecord): Date {
  const createdAt = new Date(delivery.createdAt).getTime();
  const expiresAt = new Date(delivery.expiresAt).getTime();
  const originalDurationMs = expiresAt - createdAt;
  const fallbackDurationMs = 24 * 60 * 60 * 1000;
  return new Date(Date.now() + (Number.isFinite(originalDurationMs) && originalDurationMs > 0 ? originalDurationMs : fallbackDurationMs));
}

function assertDeliveryAccountMatchesProvider(deliveryProviderId: string, deliveryAccount: AccountRecord): void {
  if (deliveryProviderId === "bitwarden-send" && deliveryAccount.providerId !== "bitwarden") {
    throw new Error("Bitwarden Send delivery requires an unlocked Bitwarden account");
  }
}

function isManualHandoffProvider(deliveryProviderId: string): boolean {
  return builtInProviderManifests.find((manifest) => manifest.id === deliveryProviderId)?.delivery?.secureLinkCreation === "manual";
}

function accountIdFromAccountRequest(request: FastifyRequest): string | undefined {
  const match = /^\/api\/accounts\/([^/?]+)(?:\/|$)/.exec(request.url);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

function riskTierWithinPolicy(riskTier: CredentialCatalogEntry["riskTier"], maxRiskTier: CredentialCatalogEntry["riskTier"]): boolean {
  const order: Record<CredentialCatalogEntry["riskTier"], number> = { low: 1, medium: 2, high: 3, critical: 4 };
  return order[riskTier] <= order[maxRiskTier];
}

async function assertDeliveryProviderReady(deliveryProvider: DeliveryProvider, accountId: string, account: AccountRecord): Promise<void> {
  try {
    const result = await deliveryProvider.testConnection(accountId);
    if (!result.ok || result.status !== "unlocked") {
      throw new Error(result.safeMessage ?? result.status);
    }
  } catch (error) {
    const detail = safeErrorMessage(error);
    const label = account.label || account.username || account.id;
    if (deliveryProvider.id === "bitwarden-send") {
      throw new Error(`Bitwarden Send account "${label}" is not ready. Go to Vaults > Account Access, select "${label}", use Terminal login / unlock if Bitwarden asks for first login or verification, then wait for WardSen to show the account as unlocked before creating a secure link. Detail: ${detail}`);
    }
    throw new Error(`${deliveryProvider.displayName} is not configured for audit account "${label}". Check Settings > Provider Capabilities for its local setup requirements. Detail: ${detail}`);
  }
}

function largeBatchConfirmation(recipientCount: number): string {
  return `SEND ${recipientCount}`;
}

function confirmationPhrase(action: "DELETE ACCOUNT" | "DELETE PERSON" | "OFFBOARD PERSON" | "REVOKE DELIVERY" | "REVOKE BATCH LINKS" | "CANCEL BATCH" | "REPLACE REQUEST" | "BREAK GLASS", id: string): string {
  return `${action} ${id}`;
}

function sensitiveCredentialValues(credential: { password?: string; totp?: string; notes?: string; urls?: string[] }, accessPassword?: string): string[] {
  return [credential.password, credential.totp, credential.notes, ...(credential.urls ?? []), accessPassword].filter((value): value is string => Boolean(value));
}

async function providerRuntimeDiagnostic(providerId: string, configuredExecutable?: string) {
  if (providerId === "bitwarden" || providerId === "bitwarden-send") {
    return cliRuntimeDiagnostic("bw", "WARDSEN_BITWARDEN_CLI_PATH", bitwardenDiagnosticCandidates(), configuredExecutable);
  }
  if (providerId === "keepassxc") {
    return cliRuntimeDiagnostic("keepassxc-cli", "WARDSEN_KEEPASSXC_CLI_PATH", keepassXcDiagnosticCandidates());
  }
  if (providerId === "yopass") {
    return cliRuntimeDiagnostic("yopass", "WARDSEN_YOPASS_CLI_PATH", yopassDiagnosticCandidates());
  }
  if (providerId === "ente-paste") {
    return { kind: "browser", binaryFound: false, version: "Not applicable", detail: "Manual browser handoff; WardSen does not authenticate to Ente Paste." };
  }
  if (providerId === "password-pusher" || providerId === "onetime-secret") {
    return { kind: "api", binaryFound: false, version: "Not applicable", detail: "Configured through local service environment variables; WardSen does not expose their values." };
  }
  return { kind: "managed", binaryFound: false, version: "Not checked", detail: "This provider does not declare a local executable diagnostic." };
}

async function cliRuntimeDiagnostic(command: string, environmentKey: string, trustedCandidates: string[], configuredExecutable?: string) {
  try {
    const executable = configuredExecutable ?? resolveProviderExecutable({ toolName: command, envPathKey: environmentKey, trustedCandidates });
    const result = await runCliCommand({ executable, args: ["--version"], timeoutMs: 5_000, maxOutputBytes: 512 });
    const version = cliVersion(result.stdout);
    return { kind: "cli", binaryFound: true, version, detail: configuredExecutable ? `${command} is available through the operator-selected local executable.` : `${command} is available to the local service.` };
  } catch (error) {
    return { kind: "cli", binaryFound: false, version: "Unavailable", detail: safeErrorMessage(error) };
  }
}

function cliVersion(output: string): string {
  return output.replace(/\s+/g, " ").trim().slice(0, 160) || "Version command completed";
}

function configuredExecutablePath(value: string | undefined): string | undefined {
  return value && path.isAbsolute(value) ? value : undefined;
}

function verifiedExecutablePath(value: string): string {
  if (!path.isAbsolute(value)) throw new Error("Choose an absolute path to the official bw executable.");
  const executablePath = path.resolve(value);
  let stats: fs.Stats;
  try {
    stats = fs.statSync(executablePath);
  } catch {
    throw new Error("The chosen executable was not found.");
  }
  if (!stats.isFile()) throw new Error("The chosen path must point to an executable file, not a folder.");
  return executablePath;
}

function providerAuthenticationDiagnostic(providerId: string, accounts: AccountRecord[]) {
  if (providerId === "password-pusher") {
    return process.env.WARDSEN_PASSWORD_PUSHER_API_TOKEN
      ? { state: "configured", detail: "Required API token is present in the local service environment." }
      : { state: "not configured", detail: "Set WARDSEN_PASSWORD_PUSHER_API_TOKEN in the local service environment." };
  }
  if (providerId === "onetime-secret") {
    return process.env.WARDSEN_ONETIME_SECRET_USERNAME && process.env.WARDSEN_ONETIME_SECRET_API_TOKEN
      ? { state: "configured", detail: "Required Onetime Secret credentials are present in the local service environment." }
      : { state: "not configured", detail: "Set WARDSEN_ONETIME_SECRET_USERNAME and WARDSEN_ONETIME_SECRET_API_TOKEN in the local service environment." };
  }
  if (providerId === "ente-paste" || providerId === "yopass") {
    return { state: "not applicable", detail: providerId === "ente-paste" ? "Manual handoff does not use a WardSen provider session." : "The current Yopass CLI contract does not expose a WardSen authentication state." };
  }
  const unlocked = accounts.filter((account) => account.status === "unlocked").length;
  if (unlocked > 0) return { state: "unlocked", detail: `${unlocked} selected account${unlocked === 1 ? " is" : "s are"} unlocked for this provider.` };
  if (accounts.length > 0) return { state: "locked", detail: `${accounts.length} configured account${accounts.length === 1 ? " is" : "s are"} currently locked or logged out.` };
  return { state: "no account", detail: "Add an account, then sign in or unlock it when this provider requires a vault session." };
}

function providerLinkPreviewRisk(providerId: string): string {
  if (providerId === "ente-paste") return "Manual browser handoff. WardSen cannot see sender-visible access, revoke, or link-preview telemetry.";
  if (providerId === "yopass") return "One-time URL. Avoid sending it through channels that fetch link previews; the current CLI cannot report access or revoke it.";
  if (providerId === "bitwarden-send") return "External links can be opened by anyone with the link. Use one link per recipient and provider limits when a stronger binding is needed.";
  if (providerId === "password-pusher" || providerId === "onetime-secret") return "External delivery links may be fetched by link-preview clients. Treat provider status as link state, not verified viewer identity.";
  return "Review the provider's sharing behavior before sending a live link.";
}

function bitwardenDiagnosticCandidates(): string[] {
  const candidates: string[] = [];
  if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, "WardSen", "tools", "bw.exe"));
  if (process.env.APPDATA) candidates.push(path.join(process.env.APPDATA, "WardSen", "tools", "bw.exe"));
  if (process.env.HOME) candidates.push(path.join(process.env.HOME, ".local", "bin", "bw"), path.join(process.env.HOME, "Library", "Application Support", "WardSen", "tools", "bw"), path.join(process.env.HOME, ".wardsen", "tools", "bw"));
  return [...candidates, "/opt/homebrew/bin/bw", "/usr/local/bin/bw", "/opt/local/bin/bw"];
}

function keepassXcDiagnosticCandidates(): string[] {
  const candidates: string[] = [];
  if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, "WardSen", "tools", "keepassxc-cli.exe"));
  if (process.env.ProgramFiles) candidates.push(path.join(process.env.ProgramFiles, "KeePassXC", "keepassxc-cli.exe"));
  if (process.env["ProgramFiles(x86)"]) candidates.push(path.join(process.env["ProgramFiles(x86)"], "KeePassXC", "keepassxc-cli.exe"));
  if (process.env.HOME) candidates.push(path.join(process.env.HOME, "Applications", "KeePassXC.app", "Contents", "MacOS", "keepassxc-cli"), path.join(process.env.HOME, ".wardsen", "tools", "keepassxc-cli"));
  return [...candidates, "/Applications/KeePassXC.app/Contents/MacOS/keepassxc-cli", "/usr/local/bin/keepassxc-cli", "/opt/homebrew/bin/keepassxc-cli", "/usr/bin/keepassxc-cli"];
}

function yopassDiagnosticCandidates(): string[] {
  const candidates: string[] = [];
  if (process.env.LOCALAPPDATA) candidates.push(path.join(process.env.LOCALAPPDATA, "WardSen", "tools", "yopass.exe"));
  if (process.env.USERPROFILE) candidates.push(path.join(process.env.USERPROFILE, "go", "bin", "yopass.exe"));
  if (process.env.HOME) candidates.push(path.join(process.env.HOME, "go", "bin", "yopass"), path.join(process.env.HOME, ".local", "bin", "yopass"), path.join(process.env.HOME, "Library", "Application Support", "WardSen", "tools", "yopass"));
  return [...candidates, "/opt/homebrew/bin/yopass", "/usr/local/bin/yopass", "/opt/local/bin/yopass"];
}

function assertDestructiveConfirmation(body: unknown, expected: string): void {
  const parsed = destructiveConfirmationSchema.safeParse(body);
  if (!parsed.success || parsed.data.confirm !== expected) {
    throw new Error(`Destructive action requires confirmation phrase: ${expected}`);
  }
}

function assertRetentionCutoff(label: string, cutoffIso: string): void {
  const cutoffMs = Date.parse(cutoffIso);
  if (!Number.isFinite(cutoffMs)) {
    throw new Error(`${label} retention cutoff must be an ISO timestamp.`);
  }
  if (cutoffMs > Date.now() + 1000) {
    throw new Error(`${label} retention cutoff cannot be in the future.`);
  }
}

function childOperationId(parentOperationId: string, childId: string): string {
  return `${parentOperationId}:${createHash("sha256").update(childId).digest("hex").slice(0, 16)}`;
}

function deliveryPolicySnapshot(body: DeliveryCreateBody, expiresAt: Date, viewLimit?: number): DeliveryPolicySnapshot {
  return {
    sourceProviderId: body.sourceProviderId,
    sourceAccountId: body.sourceAccountId,
    sourceItemId: body.sourceItemId,
    deliveryProviderId: body.deliveryProviderId,
    deliveryAccountId: body.deliveryAccountId,
    recipientId: body.recipient?.id,
    deliveryMethod: body.deliveryMethod,
    expiresAt: expiresAt.toISOString(),
    viewLimit,
    viewOnce: body.viewOnce === true,
    accessSecretRequired: Boolean(body.accessPassword),
    hideText: body.hideText === true,
    bundleSourceCredentials: body.bundleSourceCredentials
  };
}

function deliveryOperationFingerprint(policySnapshot: DeliveryPolicySnapshot): string {
  return createHash("sha256").update(JSON.stringify(policySnapshot)).digest("hex");
}

function isReturnableDelivery(delivery: DeliveryRecord): boolean {
  return delivery.status === "active" || delivery.status === "viewed" || delivery.status === "limit_reached";
}

function deliveryAccessObserved(status?: DeliveryRecord["status"], accessCount?: number): boolean {
  return (accessCount ?? 0) > 0 || status === "viewed" || status === "limit_reached";
}
