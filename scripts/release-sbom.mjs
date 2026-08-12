import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const configuredBundleRoot = process.env.WARDSEN_BUNDLE_ROOT;
const bundleRoot = configuredBundleRoot
  ? path.resolve(root, configuredBundleRoot)
  : path.join(root, "apps", "desktop", "src-tauri", "target", "release", "bundle");
const outputName = process.env.WARDSEN_SBOM_NAME ?? "WARDSEN-SBOM.json";

if (!/^WARDSEN-SBOM(?:-[A-Za-z0-9._-]+)?\.json$/.test(outputName)) {
  throw new Error(`WARDSEN_SBOM_NAME must look like WARDSEN-SBOM-<platform>.json: ${outputName}`);
}
if (!existsSync(bundleRoot)) {
  throw new Error(`Bundle folder does not exist: ${bundleRoot}`);
}

mkdirSync(bundleRoot, { recursive: true });
const npm = npmInvocation();
const sbomJson = execFileSync(npm.command, npm.args, {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"]
});

JSON.parse(sbomJson);
const outputPath = path.join(bundleRoot, outputName);
writeFileSync(outputPath, sbomJson.endsWith("\n") ? sbomJson : `${sbomJson}\n`, "utf8");
console.log(`Wrote ${outputPath}`);

function npmInvocation() {
  const args = ["sbom", "--sbom-format", "cyclonedx", "--sbom-type", "application", "--json", "--package-lock-only"];
  if (process.env.npm_execpath) {
    return { command: process.execPath, args: [process.env.npm_execpath, ...args] };
  }
  return { command: process.platform === "win32" ? "npm.cmd" : "npm", args };
}
