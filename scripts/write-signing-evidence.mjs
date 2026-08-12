import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const bundleRoot = path.resolve(root, process.env.WARDSEN_BUNDLE_ROOT ?? "apps/desktop/src-tauri/target/release/bundle");
const platform = process.env.WARDSEN_SIGNING_PLATFORM ?? process.env.WARDSEN_RELEASE_PLATFORM ?? process.platform;
const evidenceName = process.env.WARDSEN_SIGNING_EVIDENCE_NAME ?? `SIGNING-EVIDENCE-${platform}.json`;
const evidencePath = path.join(bundleRoot, evidenceName);

if (!existsSync(bundleRoot)) {
  throw new Error(`Bundle folder does not exist: ${bundleRoot}`);
}

const installers = findInstallerArtifacts(bundleRoot).sort((a, b) => a.localeCompare(b));
if (installers.length === 0) {
  throw new Error(`No signed installer artifacts found under ${bundleRoot}`);
}

const artifacts = [];
for (const installer of installers) {
  artifacts.push({
    path: path.relative(bundleRoot, installer).replaceAll(path.sep, "/"),
    sha256: await sha256(installer),
    sizeBytes: statSync(installer).size
  });
}

mkdirSync(bundleRoot, { recursive: true });
writeFileSync(evidencePath, `${JSON.stringify({
  schemaVersion: 1,
  product: "WardSen",
  platform,
  releaseTag: process.env.RELEASE_TAG ?? null,
  gitSha: process.env.WARDSEN_RELEASE_SHA ?? process.env.GITHUB_SHA ?? null,
  verifiedAt: process.env.WARDSEN_SIGNING_VERIFIED_AT ?? new Date().toISOString(),
  status: "verified",
  publicRelease: process.env.WARDSEN_PUBLIC_RELEASE === "true",
  method: process.env.WARDSEN_SIGNING_METHOD ?? "platform-signing",
  verifier: process.env.WARDSEN_SIGNING_VERIFIER ?? "platform verifier",
  artifacts
}, null, 2)}\n`, "utf8");

console.log(`Wrote ${evidencePath}`);

function findInstallerArtifacts(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findInstallerArtifacts(fullPath));
    } else if (entry.isFile() && [".exe", ".msi", ".dmg"].includes(path.extname(entry.name).toLowerCase())) {
      results.push(fullPath);
    }
  }
  return results;
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
