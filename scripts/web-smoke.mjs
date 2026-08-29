import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const distRoot = path.join(root, "apps", "web", "dist");
const outputRoot = path.resolve(root, process.env.WARDSEN_WEB_SMOKE_OUTPUT ?? path.join(os.tmpdir(), "wardsen-web-smoke"));
const host = process.env.WARDSEN_WEB_SMOKE_HOST ?? "127.0.0.1";
const port = Number(process.env.WARDSEN_WEB_SMOKE_PORT ?? 5177);
const captureTimeoutMs = Number(process.env.WARDSEN_WEB_SMOKE_TIMEOUT_MS ?? 10_000);
const httpOnly = process.env.WARDSEN_WEB_SMOKE_HTTP_ONLY === "1" || process.argv.includes("--http-only");
const baseUrl = `http://${host}:${port}/`;

if (!existsSync(path.join(distRoot, "index.html"))) {
  throw new Error("Web build output is missing. Run npm run build:web before npm run smoke:web.");
}

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });

const server = createServer((request, response) => {
  void handleRequest(request.url ?? "/", response);
});

await new Promise((resolve) => server.listen(port, host, resolve));
try {
  if (httpOnly) {
    await assertHttpSmoke();
    console.log(`WardSen web HTTP smoke passed at ${baseUrl}`);
    console.log("Browser screenshot capture skipped by the fast HTTP smoke mode.");
  } else {
    const chromePath = findChrome();
    const desktop = capture(chromePath, "desktop-1280x720.png", "1280,720");
    const mobile = capture(chromePath, "mobile-390x844.png", "390,844");
    console.log(`WardSen web smoke passed at ${baseUrl}`);
    console.log(`Desktop screenshot: ${desktop}`);
    console.log(`Mobile screenshot: ${mobile}`);
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}

async function assertHttpSmoke() {
  const indexResponse = await fetch(baseUrl);
  const index = await indexResponse.text();
  if (!indexResponse.ok || !index.includes('<div id="root">')) {
    throw new Error(`HTTP smoke failed to load WardSen index at ${baseUrl}`);
  }

  const healthResponse = await fetch(new URL("/api/health", baseUrl));
  const health = await healthResponse.json();
  if (!healthResponse.ok || health.ok !== true) {
    throw new Error("HTTP smoke failed to load mocked API health.");
  }
}

function capture(chromePath, fileName, windowSize) {
  const screenshotPath = path.join(outputRoot, fileName);
  const profilePath = path.join(outputRoot, `profile-${fileName}`);
  const args = [
    "--headless=new",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-extensions",
    "--disable-features=AutofillServerCommunication,MediaRouter,OptimizationHints",
    "--disable-gpu",
    "--disable-gpu-sandbox",
    "--disable-gpu-compositing",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    "--password-store=basic",
    "--run-all-compositor-stages-before-draw",
    `--user-data-dir=${profilePath}`,
    `--window-size=${windowSize}`,
    `--screenshot=${screenshotPath}`,
    baseUrl
  ];

  try {
    execFileSync(chromePath, args, { stdio: "pipe", timeout: captureTimeoutMs });
  } catch (error) {
    const stderr = error.stderr?.toString("utf8") ?? "";
    const timeoutHint = error.signal === "SIGTERM" ? ` after ${captureTimeoutMs}ms` : "";
    throw new Error(`Chrome smoke capture failed for ${windowSize}${timeoutHint}.\n${stderr}`);
  }

  if (!existsSync(screenshotPath) || statSync(screenshotPath).size === 0) {
    throw new Error(`Chrome did not write a screenshot for ${windowSize}: ${screenshotPath}`);
  }
  return screenshotPath;
}

async function handleRequest(requestUrl, response) {
  const parsed = new URL(requestUrl, baseUrl);
  if (parsed.pathname.startsWith("/api/")) return sendApi(parsed.pathname, response);

  const requestedPath = parsed.pathname === "/" ? "index.html" : parsed.pathname.slice(1);
  const filePath = path.resolve(distRoot, requestedPath);
  const safePath = filePath.startsWith(path.resolve(distRoot)) ? filePath : path.join(distRoot, "index.html");
  const finalPath = existsSync(safePath) ? safePath : path.join(distRoot, "index.html");
  const ext = path.extname(finalPath);
  const contentType = ext === ".html" ? "text/html" : ext === ".js" ? "application/javascript" : ext === ".css" ? "text/css" : "application/octet-stream";
  response.writeHead(200, { "content-type": contentType });
  response.end(readFileSync(finalPath));
}

function sendApi(apiPath, response) {
  const now = new Date().toISOString();
  const routes = {
    "/api/health": { ok: true, version: "0.11.0" },
    "/api/providers": {
      credentialProviders: [{ id: "mock-source", displayName: "Mock Source" }],
      deliveryProviders: [{ id: "bitwarden-send", displayName: "Bitwarden Send", capabilities: { statusLookup: true, revokeLink: true } }],
      plannedProviders: []
    },
    "/api/accounts": [{ id: "source", providerId: "mock-source", label: "Operations Vault", role: "source", status: "connected", lastCheckedAt: now }],
    "/api/people": { items: [{ id: "asha", name: "Asha", email: "asha@example.test", active: true }], page: 1, pageSize: 50, total: 1 },
    "/api/employees": { items: [], page: 1, pageSize: 100, total: 0 },
    "/api/credential-catalog": { items: [], page: 1, pageSize: 100, total: 0 },
    "/api/credential-requests": { items: [], page: 1, pageSize: 100, total: 0 },
    "/api/deliveries": { items: [{
      id: "delivery-1",
      credentialName: "CMS Login",
      personId: "asha",
      sourceProviderId: "mock-source",
      sourceAccountId: "source",
      sourceItemId: "cred-1",
      deliveryProviderId: "bitwarden-send",
      deliveryAccountId: "source",
      createdAt: "2026-08-08T12:42:00.000Z",
      status: "viewed",
      accessCount: 1,
      viewLimit: 1,
      maxAccessCount: 1,
      firstViewedAt: "2026-08-08T13:12:00.000Z",
      lastCheckedAt: now,
      expiresAt: "2026-08-11T13:12:00.000Z",
      providerDeliveryId: "send-asha"
    }], page: 1, pageSize: 50, total: 1 },
    "/api/batches": { items: [], page: 1, pageSize: 10, total: 0 },
    "/api/audit-log": []
  };

  if (apiPath === "/api/credentials/search") {
    return sendJson(response, { results: [{ id: "cred-1", accountId: "source", title: "CMS Login", username: "Email", updatedAt: now }], nextPage: null });
  }
  sendJson(response, routes[apiPath] ?? { error: "not found" }, routes[apiPath] ? 200 : 404);
}

function sendJson(response, value, status = 200) {
  const body = JSON.stringify(value);
  response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(body) });
  response.end(body);
}

function findChrome() {
  const candidates = [
    process.env.WARDSEN_WEB_SMOKE_CHROME,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter(Boolean);

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error("No Chrome-compatible browser found. Set WARDSEN_WEB_SMOKE_CHROME to a Chrome or Edge executable.");
  }
  return found;
}
