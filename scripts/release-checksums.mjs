import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import rootPackage from "../package.json" with { type: "json" };

const root = process.cwd();
const configuredBundleRoot = process.env.WARDSEN_BUNDLE_ROOT;
const bundleRoot = configuredBundleRoot
  ? path.resolve(root, configuredBundleRoot)
  : path.join(root, "apps", "desktop", "src-tauri", "target", "release", "bundle");
const outputPath = path.join(bundleRoot, "SHA256SUMS.txt");
const manifestPath = path.join(bundleRoot, "RELEASE-MANIFEST.json");
const allowedExtensions = new Set([".exe", ".msi", ".dmg", ".zip"]);

if (!existsSync(bundleRoot)) {
  throw new Error(`Bundle folder does not exist: ${bundleRoot}`);
}

const artifacts = findArtifacts(bundleRoot).sort((a, b) => a.localeCompare(b));
if (artifacts.length === 0) {
  throw new Error(`No release artifacts found under ${bundleRoot}`);
}
assertNoStaleMixedArtifacts(artifacts);

mkdirSync(bundleRoot, { recursive: true });
const lines = [];
const manifestArtifacts = [];
for (const artifact of artifacts) {
  const hash = await sha256(artifact);
  const relative = path.relative(bundleRoot, artifact).replaceAll(path.sep, "/");
  const sizeBytes = statSync(artifact).size;
  lines.push(`${hash}  ${relative}`);
  manifestArtifacts.push({ path: relative, sha256: hash, sizeBytes });
}

writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
writeFileSync(manifestPath, `${JSON.stringify({
  schemaVersion: 1,
  product: "WardSen",
  packageVersion: rootPackage.version,
  releaseTag: process.env.RELEASE_TAG ?? null,
  gitSha: process.env.WARDSEN_RELEASE_SHA ?? process.env.GITHUB_SHA ?? gitSha(),
  buildTimestamp: process.env.WARDSEN_BUILD_TIMESTAMP ?? new Date().toISOString(),
  bundleRoot: path.relative(root, bundleRoot).replaceAll(path.sep, "/") || ".",
  artifacts: manifestArtifacts
}, null, 2)}\n`, "utf8");
console.log(`Wrote ${outputPath}`);
console.log(`Wrote ${manifestPath}`);
for (const line of lines) console.log(line);

function findArtifacts(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findArtifacts(fullPath));
      continue;
    }
    if (entry.isFile() && allowedExtensions.has(path.extname(entry.name).toLowerCase())) {
      results.push(fullPath);
    }
  }
  return results;
}

function assertNoStaleMixedArtifacts(artifacts) {
  if (configuredBundleRoot || process.env.WARDSEN_ALLOW_MIXED_ARTIFACT_TIMES === "true") return;
  if (artifacts.length < 2) return;

  const artifactStats = artifacts.map((artifact) => ({ artifact, mtimeMs: statSync(artifact).mtimeMs }));
  const newest = Math.max(...artifactStats.map((artifact) => artifact.mtimeMs));
  const oldest = Math.min(...artifactStats.map((artifact) => artifact.mtimeMs));
  const maxSpanMs = Number(process.env.WARDSEN_MAX_ARTIFACT_TIME_SPAN_MS ?? 10 * 60 * 1000);
  if (newest - oldest <= maxSpanMs) return;

  const details = artifactStats
    .sort((a, b) => a.mtimeMs - b.mtimeMs)
    .map(({ artifact, mtimeMs }) => `${new Date(mtimeMs).toISOString()} ${path.relative(bundleRoot, artifact).replaceAll(path.sep, "/")}`)
    .join("\n");
  throw new Error([
    "Release artifacts have mixed modification times; refusing to generate a combined checksum manifest that may bless stale installers.",
    "Set WARDSEN_BUNDLE_ROOT to the exact fresh bundle folder, clean target/release/bundle before packaging, or set WARDSEN_ALLOW_MIXED_ARTIFACT_TIMES=true after reviewing the artifact list.",
    details
  ].join("\n"));
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

function gitSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}
