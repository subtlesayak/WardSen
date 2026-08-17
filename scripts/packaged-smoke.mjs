import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const tauriConfigPath = path.join(root, "apps", "desktop", "src-tauri", "tauri.conf.json");
const tauriDir = path.dirname(tauriConfigPath);
const serverBundlePath = path.join(root, "apps", "server", "dist", "index.cjs");
const webDistPath = path.join(root, "apps", "web", "dist");
const webIndexPath = path.join(webDistPath, "index.html");
const runtimeName = process.platform === "win32" ? "node.exe" : "node";
const runtimePath = path.join(root, "apps", "desktop", "src-tauri", "gen", "runtime", runtimeName);
const outputDir = path.resolve(root, process.env.WARDSEN_PACKAGED_SMOKE_OUTPUT_DIR ?? path.join(os.tmpdir(), "wardsen-packaged-smoke"));
const outputName = process.env.WARDSEN_PACKAGED_SMOKE_NAME ?? `PACKAGED-SMOKE-${process.platform}-${process.arch}.json`;
const outputPath = path.join(outputDir, outputName);
const dataRoot = path.join(os.tmpdir(), `wardsen-packaged-smoke-${process.pid}`);
const startupTimeoutMs = positiveIntegerEnv("WARDSEN_PACKAGED_SMOKE_STARTUP_TIMEOUT_MS", 15_000);
const requestTimeoutMs = positiveIntegerEnv("WARDSEN_PACKAGED_SMOKE_REQUEST_TIMEOUT_MS", 5_000);
const outputTailLimit = 4_000;
let child;
let childOutput = "";

try {
  assertPackagedInputs();
  const port = Number(process.env.WARDSEN_PACKAGED_SMOKE_PORT ?? await getOpenPort());
  const apiToken = "packaged-smoke-token";
  const baseUrl = `http://127.0.0.1:${port}`;
  child = startServerBundle(port, apiToken);
  const health = await waitForHealth(baseUrl, apiToken);
  const unauthorized = await fetchRaw(`${baseUrl}/api/health`);
  if (unauthorized.status !== 401) {
    throw new Error(`Packaged server accepted an API request without the desktop token; expected 401, got ${unauthorized.status}.`);
  }
  const providers = await fetchJson(`${baseUrl}/api/providers`, apiToken);
  assertProviderList(providers);
  const account = await fetchJson(`${baseUrl}/api/accounts`, apiToken, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "tauri://localhost" },
    body: JSON.stringify({
      id: "packaged-smoke-bitwarden",
      providerId: "bitwarden",
      label: "Packaged smoke Bitwarden",
      username: "smoke@example.test"
    })
  });
  if (account.id !== "packaged-smoke-bitwarden" || account.status !== "locked") {
    throw new Error("Packaged server did not persist the smoke account metadata.");
  }
  const accounts = await fetchJson(`${baseUrl}/api/accounts`, apiToken);
  if (!Array.isArray(accounts) || accounts.length !== 1 || accounts[0]?.id !== account.id) {
    throw new Error("Packaged server did not isolate the smoke account from existing WardSen metadata.");
  }
  await crashServerProcess(child);
  child = startServerBundle(port, apiToken);
  await waitForHealth(baseUrl, apiToken);
  const recoveredAccounts = await fetchJson(`${baseUrl}/api/accounts`, apiToken);
  if (!Array.isArray(recoveredAccounts) || recoveredAccounts.length !== 1 || recoveredAccounts[0]?.id !== account.id) {
    throw new Error("Packaged server did not recover isolated SQLite metadata after an ungraceful restart.");
  }

  writeEvidence({
    ok: true,
    checkedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    releaseTag: process.env.RELEASE_TAG ?? null,
    gitSha: process.env.WARDSEN_RELEASE_SHA ?? process.env.GITHUB_SHA ?? null,
    artifacts: packagedArtifactEvidence(),
    api: {
      health: { ok: health.ok, name: health.name, telemetry: health.telemetry },
      unauthorizedStatus: unauthorized.status,
      credentialProviders: providers.credentialProviders.map((provider) => provider.id),
      deliveryProviders: providers.deliveryProviders.map((provider) => provider.id),
      accountCount: accounts.length,
      crashRecovery: {
        terminatedWithoutGracefulShutdown: true,
        recoveredAccountId: account.id,
        accountCountAfterRestart: recoveredAccounts.length
      }
    },
    timeouts: { startupTimeoutMs, requestTimeoutMs }
  });
  console.log(`WardSen packaged smoke passed. Evidence: ${outputPath}`);
} catch (error) {
  writeEvidence({
    ok: false,
    checkedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    error: error instanceof Error ? error.message : String(error),
    childOutput: redactOutput(childOutput)
  });
  throw error;
} finally {
  await killServerProcess(child);
  rmSync(dataRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

function assertPackagedInputs() {
  assertFile(serverBundlePath, "Built server bundle is missing. Run npm run build:server before npm run smoke:packaged.");
  assertFile(webIndexPath, "Built web index is missing. Run npm run build:web before npm run smoke:packaged.");
  assertFile(runtimePath, "Desktop Node.js runtime is missing. Run npm run prepare:desktop-runtime before packaging.");

  const config = JSON.parse(readFileSync(tauriConfigPath, "utf8"));
  const frontendDist = path.resolve(tauriDir, config.build?.frontendDist ?? "");
  if (frontendDist !== webDistPath) {
    throw new Error(`Tauri frontendDist does not point at the built web bundle: ${config.build?.frontendDist}`);
  }
  if (config.bundle?.resources?.["../../server/dist/index.cjs"] !== "server/index.cjs") {
    throw new Error("Tauri resources must bundle apps/server/dist/index.cjs as server/index.cjs.");
  }
  if (config.bundle?.resources?.["gen/runtime"] !== "runtime") {
    throw new Error("Tauri resources must bundle the prepared Node.js runtime directory.");
  }
  const csp = String(config.app?.security?.csp ?? "");
  if (!csp.includes("connect-src 'self'") || csp.includes("http://127.0.0.1:*")) {
    throw new Error("Tauri CSP must keep local API traffic behind the desktop proxy with connect-src 'self'.");
  }
  assertDesktopProxyCommand();
}

function startServerBundle(port, apiToken) {
  mkdirSync(dataRoot, { recursive: true });
  const env = {
    ...process.env,
    WARDSEN_PORT: String(port),
    WARDSEN_API_TOKEN: apiToken,
    WARDSEN_DATA_DIR: dataRoot,
    WARDSEN_DATA_DIR_STRICT: "true"
  };
  delete env.WARDSEN_ALLOW_UNAUTHENTICATED_LOCAL_API;
  const server = spawn(process.execPath, [serverBundlePath], {
    cwd: dataRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  server.stdout?.on("data", (chunk) => appendChildOutput(chunk));
  server.stderr?.on("data", (chunk) => appendChildOutput(chunk));
  return server;
}

async function waitForHealth(baseUrl, apiToken) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < startupTimeoutMs) {
    if (child?.exitCode !== null) {
      throw new Error(`Packaged server exited before health passed. Output: ${redactOutput(childOutput)}`);
    }
    try {
      const health = await fetchJson(`${baseUrl}/api/health`, apiToken);
      if (health.ok === true) return health;
      lastError = new Error("Health response did not include ok=true.");
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Timed out after ${startupTimeoutMs}ms waiting for packaged server health. Last detail: ${detail}`);
}

async function fetchJson(url, apiToken, init = {}) {
  const headers = {
    "x-wardsen-api-token": apiToken,
    ...(init.headers ?? {})
  };
  const response = await fetchRaw(url, { ...init, headers });
  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    throw new Error(`Expected JSON from ${url}, got: ${text.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(typeof json?.error === "string" ? json.error : `Request failed with HTTP ${response.status}`);
  }
  return json;
}

async function fetchRaw(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function assertProviderList(providers) {
  const credentialIds = new Set(providers.credentialProviders?.map((provider) => provider.id) ?? []);
  const deliveryIds = new Set(providers.deliveryProviders?.map((provider) => provider.id) ?? []);
  if (!credentialIds.has("bitwarden") || !credentialIds.has("keepassxc")) {
    throw new Error("Packaged server did not register the built-in credential providers.");
  }
  if (!deliveryIds.has("bitwarden-send")) {
    throw new Error("Packaged server did not register the Bitwarden Send delivery provider.");
  }
}

function packagedArtifactEvidence() {
  return {
    serverBundle: fileEvidence(serverBundlePath),
    webIndex: fileEvidence(webIndexPath),
    nodeRuntime: fileEvidence(runtimePath),
    tauriConfig: {
      path: relativePath(tauriConfigPath),
      serverResource: "server/index.cjs",
      runtimeResource: "runtime",
      apiOrigin: "tauri proxy command"
    }
  };
}

function assertDesktopProxyCommand() {
  const desktopSource = readFileSync(path.join(tauriDir, "src", "lib.rs"), "utf8");
  if (!desktopSource.includes("proxy_local_service_request") || !desktopSource.includes("tauri::generate_handler!")) {
    throw new Error("Desktop command proxy_local_service_request must be registered for packaged local API access.");
  }
}

function fileEvidence(filePath) {
  const stats = statSync(filePath);
  return { path: relativePath(filePath), bytes: stats.size };
}

function assertFile(filePath, message) {
  if (!existsSync(filePath) || !statSync(filePath).isFile() || statSync(filePath).size === 0) {
    throw new Error(message);
  }
}

function writeEvidence(value) {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function killServerProcess(server) {
  if (!server || server.exitCode !== null) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill.exe", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore", timeout: 5_000 });
    } catch {
      server.kill();
    }
    await waitForProcessExit(server, 5_000);
    return;
  }
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    delay(5_000).then(() => server.kill("SIGKILL"))
  ]);
}

async function crashServerProcess(server) {
  if (!server || server.exitCode !== null) return;
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill.exe", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore", timeout: 5_000 });
    } catch {
      server.kill();
    }
    await waitForProcessExit(server, 5_000);
    return;
  }
  server.kill("SIGKILL");
  await waitForProcessExit(server, 5_000);
}

async function waitForProcessExit(server, timeoutMs) {
  if (server.exitCode !== null) return;
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    delay(timeoutMs)
  ]);
}

function appendChildOutput(chunk) {
  childOutput = tail(`${childOutput}${chunk.toString("utf8")}`, outputTailLimit);
}

function redactOutput(value) {
  return tail(value.replaceAll("packaged-smoke-token", "[redacted-token]"), outputTailLimit);
}

function tail(value, limit) {
  return value.length > limit ? value.slice(value.length - limit) : value;
}

function relativePath(filePath) {
  return path.relative(root, filePath).replaceAll(path.sep, "/");
}

function positiveIntegerEnv(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

async function getOpenPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a localhost smoke-test port."));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
