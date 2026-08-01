import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const configuredBundleRoot = process.env.WARDSEN_BUNDLE_ROOT;
const bundleRoot = configuredBundleRoot
  ? path.resolve(root, configuredBundleRoot)
  : path.join(root, "apps", "desktop", "src-tauri", "target", "release", "bundle");
const outputPath = path.join(bundleRoot, "SHA256SUMS.txt");
const allowedExtensions = new Set([".exe", ".msi", ".dmg", ".zip"]);

if (!existsSync(bundleRoot)) {
  throw new Error(`Bundle folder does not exist: ${bundleRoot}`);
}

const artifacts = findArtifacts(bundleRoot).sort((a, b) => a.localeCompare(b));
if (artifacts.length === 0) {
  throw new Error(`No release artifacts found under ${bundleRoot}`);
}

mkdirSync(bundleRoot, { recursive: true });
const lines = [];
for (const artifact of artifacts) {
  const hash = await sha256(artifact);
  const relative = path.relative(bundleRoot, artifact).replaceAll(path.sep, "/");
  lines.push(`${hash}  ${relative}`);
}

writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
console.log(`Wrote ${outputPath}`);
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

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex").toUpperCase()));
  });
}
