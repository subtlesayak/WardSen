import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const bundleRoot = path.resolve(root, process.env.WARDSEN_BUNDLE_ROOT ?? "apps/desktop/src-tauri/target/release/bundle");
const publicRelease = process.env.WARDSEN_PUBLIC_RELEASE === "true";
const provenanceRequired = process.env.WARDSEN_PROVENANCE_REQUIRED === "true";
const installLifecycleRequired = process.env.WARDSEN_INSTALL_LIFECYCLE_REQUIRED === "true";
const manifestPath = path.join(bundleRoot, "RELEASE-MANIFEST.json");
const checksumPath = path.join(bundleRoot, "SHA256SUMS.txt");
const failures = [];

if (!existsSync(manifestPath)) failures.push(`Missing release manifest: ${manifestPath}`);
if (!existsSync(checksumPath)) failures.push(`Missing checksum file: ${checksumPath}`);

const manifest = failures.length === 0 ? JSON.parse(readFileSync(manifestPath, "utf8")) : undefined;
const artifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
const checksums = existsSync(checksumPath) ? parseChecksums(readFileSync(checksumPath, "utf8")) : new Map();

if (manifest && manifest.schemaVersion !== 1) failures.push("RELEASE-MANIFEST.json must use schemaVersion 1.");
requireArtifactKind("installer");
requireArtifactKind("sbom");
requireArtifactKind("smoke");
if (publicRelease) requireArtifactKind("signing-evidence");
if (provenanceRequired) {
  requireArtifactKind("provenance-subjects");
  requireArtifactKind("provenance-evidence");
}
if (installLifecycleRequired) requireArtifactKind("install-lifecycle-evidence");

for (const artifact of artifacts) {
  if (!artifact || typeof artifact.path !== "string" || typeof artifact.sha256 !== "string") {
    failures.push("Every manifest artifact must include path and sha256.");
    continue;
  }
  const artifactPath = path.join(bundleRoot, artifact.path);
  if (!existsSync(artifactPath)) {
    failures.push(`Manifest artifact is missing on disk: ${artifact.path}`);
    continue;
  }
  if (checksums.get(artifact.path) !== artifact.sha256) {
    failures.push(`SHA256SUMS.txt does not match manifest hash for ${artifact.path}.`);
  }
  const actualHash = await sha256(artifactPath);
  if (actualHash !== artifact.sha256) {
    failures.push(`Artifact hash mismatch for ${artifact.path}.`);
  }
}

if (publicRelease) {
  const installerHashes = new Map(
    artifacts
      .filter((artifact) => artifact.kind === "installer")
      .map((artifact) => [artifact.path, artifact.sha256])
  );
  const signedInstallerPaths = new Set();
  for (const artifact of artifacts.filter((item) => item.kind === "signing-evidence")) {
    const evidence = JSON.parse(readFileSync(path.join(bundleRoot, artifact.path), "utf8"));
    if (evidence.status !== "verified") failures.push(`${artifact.path} must have status verified.`);
    if (!Array.isArray(evidence.artifacts) || evidence.artifacts.length === 0) failures.push(`${artifact.path} must name verified installer artifacts.`);
    for (const signedArtifact of evidence.artifacts ?? []) {
      if (installerHashes.get(signedArtifact.path) !== signedArtifact.sha256) {
        failures.push(`${artifact.path} does not match manifest installer hash for ${signedArtifact.path}.`);
      } else {
        signedInstallerPaths.add(signedArtifact.path);
      }
    }
  }
  for (const installerPath of installerHashes.keys()) {
    if (!signedInstallerPaths.has(installerPath)) {
      failures.push(`Public installer ${installerPath} is not covered by signing evidence.`);
    }
  }
}

if (provenanceRequired) {
  const attestedSubjects = new Set();
  const expectedSubjects = new Map(
    artifacts
      .filter((artifact) => artifact.kind === "installer" || artifact.kind === "sbom")
      .map((artifact) => [artifact.path, artifact.sha256])
  );
  for (const artifact of artifacts.filter((item) => item.kind === "provenance-evidence")) {
    let evidence;
    try {
      evidence = JSON.parse(readFileSync(path.join(bundleRoot, artifact.path), "utf8"));
    } catch (error) {
      failures.push(`${artifact.path} is not valid provenance evidence: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (evidence.schemaVersion !== 1 || evidence.status !== "attested") {
      failures.push(`${artifact.path} must have schemaVersion 1 and status attested.`);
    }
    if (typeof evidence.attestation?.id !== "string" || !evidence.attestation.id.trim()) {
      failures.push(`${artifact.path} must include a GitHub attestation id.`);
    }
    if (typeof evidence.attestation?.url !== "string" || !/^https:\/\//.test(evidence.attestation.url)) {
      failures.push(`${artifact.path} must include an HTTPS GitHub attestation URL.`);
    }
    if (!Array.isArray(evidence.subjects) || evidence.subjects.length === 0) {
      failures.push(`${artifact.path} must name attested installer and SBOM subjects.`);
      continue;
    }
    for (const subject of evidence.subjects) {
      if (expectedSubjects.get(subject.path) !== subject.sha256) {
        failures.push(`${artifact.path} does not match manifest subject hash for ${subject.path}.`);
      } else {
        attestedSubjects.add(subject.path);
      }
    }
  }
  for (const subjectPath of expectedSubjects.keys()) {
    if (!attestedSubjects.has(subjectPath)) {
      failures.push(`Installer or SBOM ${subjectPath} is not covered by provenance evidence.`);
    }
  }
}

if (installLifecycleRequired) {
  const requiredSteps = ["fresh_install", "launch", "upgrade", "vault_metadata_preserved", "uninstall"];
  const installerHashes = new Map(
    artifacts
      .filter((artifact) => artifact.kind === "installer")
      .map((artifact) => [artifact.path, artifact])
  );
  const testedInstallers = new Set();

  for (const artifact of artifacts.filter((item) => item.kind === "install-lifecycle-evidence")) {
    let evidence;
    try {
      evidence = JSON.parse(readFileSync(path.join(bundleRoot, artifact.path), "utf8"));
    } catch (error) {
      failures.push(`${artifact.path} is not valid install lifecycle evidence: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (evidence.schemaVersion !== 1 || evidence.status !== "verified") {
      failures.push(`${artifact.path} must have schemaVersion 1 and status verified.`);
    }
    if (typeof evidence.testEnvironment !== "string" || !evidence.testEnvironment.trim()) {
      failures.push(`${artifact.path} must identify the disposable test environment.`);
    }
    if (!Array.isArray(evidence.completedSteps) || requiredSteps.some((step) => !evidence.completedSteps.includes(step))) {
      failures.push(`${artifact.path} must record fresh install, launch, upgrade, preserved vault metadata and uninstall.`);
    }
    const installer = installerHashes.get(evidence.installer?.path);
    if (!installer || installer.sha256 !== evidence.installer?.sha256 || installer.sizeBytes !== evidence.installer?.sizeBytes) {
      failures.push(`${artifact.path} does not match a manifest installer path, hash and size.`);
      continue;
    }
    testedInstallers.add(installer.path);
  }

  for (const installerPath of installerHashes.keys()) {
    if (!testedInstallers.has(installerPath)) {
      failures.push(`Installer ${installerPath} is not covered by install lifecycle evidence.`);
    }
  }
}

if (failures.length > 0) {
  console.error("Release evidence verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Release evidence verification passed for ${publicRelease ? "public" : "validation"} artifacts in ${bundleRoot}.`);

function requireArtifactKind(kind) {
  if (!artifacts.some((artifact) => artifact.kind === kind)) {
    failures.push(`RELEASE-MANIFEST.json must include at least one ${kind} artifact${publicRelease || kind !== "signing-evidence" ? "" : " when available"}.`);
  }
}

function parseChecksums(value) {
  const checksums = new Map();
  for (const line of value.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const match = line.match(/^([A-Fa-f0-9]{64})\s+\*?(.+)$/);
    if (match) checksums.set(match[2].trim(), match[1].toUpperCase());
  }
  return checksums;
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
