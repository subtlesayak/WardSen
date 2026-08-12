import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const bundleRoot = path.resolve(root, process.env.WARDSEN_BUNDLE_ROOT ?? "apps/desktop/src-tauri/target/release/bundle");
const platform = process.env.WARDSEN_PROVENANCE_PLATFORM ?? process.platform;
const subjectsName = process.env.WARDSEN_PROVENANCE_SUBJECTS_NAME ?? "ATTESTATION-SUBJECTS.txt";
const evidenceName = process.env.WARDSEN_PROVENANCE_EVIDENCE_NAME ?? `PROVENANCE-EVIDENCE-${platform}.json`;
const subjectsPath = path.join(bundleRoot, subjectsName);
const outputPath = path.join(bundleRoot, evidenceName);
const attestationId = requiredEnv("WARDSEN_PROVENANCE_ATTESTATION_ID");
const attestationUrl = requiredHttpsUrl("WARDSEN_PROVENANCE_ATTESTATION_URL");

if (!existsSync(subjectsPath)) {
  throw new Error(`Provenance subjects file does not exist: ${subjectsPath}`);
}

const subjects = parseChecksums(readFileSync(subjectsPath, "utf8")).map(({ sha256, path: subjectPath }) => {
  const absolutePath = path.resolve(root, subjectPath);
  const relativeBundlePath = path.relative(bundleRoot, absolutePath).replaceAll(path.sep, "/");
  if (!relativeBundlePath || relativeBundlePath.startsWith("../") || path.isAbsolute(relativeBundlePath)) {
    throw new Error(`Attested subject is outside the release bundle: ${subjectPath}`);
  }
  return { path: relativeBundlePath, sha256 };
});

mkdirSync(bundleRoot, { recursive: true });
writeFileSync(outputPath, `${JSON.stringify({
  schemaVersion: 1,
  product: "WardSen",
  platform,
  releaseTag: process.env.RELEASE_TAG ?? null,
  gitSha: process.env.WARDSEN_RELEASE_SHA ?? process.env.GITHUB_SHA ?? null,
  workflowRepository: process.env.GITHUB_REPOSITORY ?? null,
  workflowRunId: process.env.GITHUB_RUN_ID ?? null,
  status: "attested",
  attestation: { id: attestationId, url: attestationUrl },
  subjects
}, null, 2)}\n`, "utf8");

console.log(`Wrote ${outputPath}`);

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required to write provenance evidence.`);
  return value;
}

function requiredHttpsUrl(name) {
  const value = requiredEnv(name);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be an HTTPS URL.`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${name} must be an HTTPS URL.`);
  return parsed.toString();
}

function parseChecksums(value) {
  const results = [];
  for (const line of value.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^([A-Fa-f0-9]{64})\s+\*?(.+)$/);
    if (!match) throw new Error(`Invalid provenance subject checksum line: ${line}`);
    results.push({ sha256: match[1].toUpperCase(), path: match[2].trim() });
  }
  if (results.length === 0) throw new Error("Provenance subjects file is empty.");
  return results;
}
