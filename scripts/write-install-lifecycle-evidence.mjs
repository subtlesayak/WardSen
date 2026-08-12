import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const bundleRoot = path.resolve(root, requiredEnv("WARDSEN_BUNDLE_ROOT"));
const platform = requiredEnv("WARDSEN_INSTALL_LIFECYCLE_PLATFORM");
const installerPath = path.resolve(root, requiredEnv("WARDSEN_INSTALL_LIFECYCLE_ARTIFACT"));
const outputName = process.env.WARDSEN_INSTALL_LIFECYCLE_EVIDENCE_NAME ?? `INSTALL-LIFECYCLE-EVIDENCE-${platform}.json`;
const outputPath = path.join(bundleRoot, outputName);
const requiredSteps = ["fresh_install", "launch", "upgrade", "vault_metadata_preserved", "uninstall"];
const completedSteps = new Set(requiredEnv("WARDSEN_INSTALL_LIFECYCLE_STEPS").split(",").map((step) => step.trim()).filter(Boolean));

if (!existsSync(installerPath)) throw new Error(`Installer does not exist: ${installerPath}`);
const relativeInstallerPath = path.relative(bundleRoot, installerPath).replaceAll(path.sep, "/");
if (!relativeInstallerPath || relativeInstallerPath.startsWith("../") || path.isAbsolute(relativeInstallerPath)) {
  throw new Error(`Installer must be inside the release bundle: ${installerPath}`);
}
for (const step of requiredSteps) {
  if (!completedSteps.has(step)) throw new Error(`Install lifecycle evidence is missing required step: ${step}`);
}

mkdirSync(bundleRoot, { recursive: true });
writeFileSync(outputPath, `${JSON.stringify({
  schemaVersion: 1,
  product: "WardSen",
  platform,
  status: "verified",
  checkedAt: process.env.WARDSEN_INSTALL_LIFECYCLE_CHECKED_AT ?? new Date().toISOString(),
  releaseTag: process.env.RELEASE_TAG ?? null,
  gitSha: process.env.WARDSEN_RELEASE_SHA ?? process.env.GITHUB_SHA ?? null,
  testEnvironment: requiredEnv("WARDSEN_INSTALL_LIFECYCLE_TEST_ENV"),
  installer: {
    path: relativeInstallerPath,
    sha256: await sha256(installerPath),
    sizeBytes: statSync(installerPath).size
  },
  completedSteps: requiredSteps
}, null, 2)}\n`, "utf8");

console.log(`Wrote ${outputPath}`);

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex").toUpperCase()));
  });
}
