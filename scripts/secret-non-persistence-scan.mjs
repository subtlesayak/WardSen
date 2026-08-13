import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const maxFileBytes = 5 * 1024 * 1024;
const defaultRoots = [
  ".wardsen-data",
  ".wardsen-profiles",
  "apps/server/dist",
  "apps/web/dist"
];
const defaultSecretProbes = [
  "WARD-SEN-CANARY-",
  "credential-password",
  "real-password",
  "super-secret",
  "send-password",
  "session-token",
  "terminal-session",
  "hunter2"
];

const scanRoots = envList("WARDSEN_SECRET_SCAN_ROOTS") ?? defaultRoots;
const secretProbes = envList("WARDSEN_SECRET_SCAN_VALUES") ?? defaultSecretProbes;
const findings = [];

for (const scanRoot of scanRoots) {
  const absoluteRoot = path.resolve(root, scanRoot);
  if (!existsSync(absoluteRoot)) continue;
  scanPath(absoluteRoot);
}

if (findings.length > 0) {
  console.error("Secret non-persistence scan failed:");
  for (const finding of findings) {
    console.error(`- ${finding.relativePath}: matched ${labelProbe(finding.probe)}`);
  }
  process.exit(1);
}

console.log(`Secret non-persistence scan passed across ${scanRoots.length} configured root(s).`);

function scanPath(targetPath) {
  const stat = statSync(targetPath);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(targetPath, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "target") continue;
      scanPath(path.join(targetPath, entry.name));
    }
    return;
  }
  if (!stat.isFile() || stat.size > maxFileBytes) return;
  const content = readFileSync(targetPath, "utf8");
  for (const probe of secretProbes) {
    if (!probe || !content.includes(probe)) continue;
    findings.push({
      relativePath: path.relative(root, targetPath).replaceAll(path.sep, "/"),
      probe
    });
  }
}

function envList(name) {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  return value
    .split(/[;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function labelProbe(probe) {
  return probe.endsWith("-") ? `${probe}*` : probe;
}
