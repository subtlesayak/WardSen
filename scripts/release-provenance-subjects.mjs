import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const bundleRoot = path.resolve(root, process.env.WARDSEN_BUNDLE_ROOT ?? "apps/desktop/src-tauri/target/release/bundle");
const name = process.env.WARDSEN_PROVENANCE_SUBJECTS_NAME ?? "ATTESTATION-SUBJECTS.txt";
const outputPath = path.join(bundleRoot, name);
const installerExtensions = new Set([".exe", ".msi", ".dmg", ".zip"]);
const sbomPattern = /^WARDSEN-SBOM(?:-[A-Za-z0-9._-]+)?\.json$/;

if (!existsSync(bundleRoot)) {
  throw new Error(`Bundle folder does not exist: ${bundleRoot}`);
}

const subjects = findSubjects(bundleRoot).sort((a, b) => a.localeCompare(b));
if (!subjects.some((subject) => installerExtensions.has(path.extname(subject).toLowerCase()))) {
  throw new Error(`No installer artifacts found under ${bundleRoot}`);
}
if (!subjects.some((subject) => sbomPattern.test(path.basename(subject)))) {
  throw new Error(`No SBOM artifact found under ${bundleRoot}`);
}

const lines = [];
for (const subject of subjects) {
  const relativeToRoot = path.relative(root, subject).replaceAll(path.sep, "/");
  const subjectName = relativeToRoot && !relativeToRoot.startsWith("../") && !path.isAbsolute(relativeToRoot)
    ? relativeToRoot
    : subject.replaceAll(path.sep, "/");
  lines.push(`${await sha256(subject)}  ${subjectName}`);
}

mkdirSync(bundleRoot, { recursive: true });
writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
console.log(`Wrote ${outputPath} with ${lines.length} provenance subjects.`);

function findSubjects(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findSubjects(fullPath));
    } else if (entry.isFile() && (installerExtensions.has(path.extname(entry.name).toLowerCase()) || sbomPattern.test(entry.name))) {
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
