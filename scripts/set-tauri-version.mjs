import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const configPath = process.env.WARDSEN_TAURI_CONFIG
  ? path.resolve(root, process.env.WARDSEN_TAURI_CONFIG)
  : path.join(root, "apps", "desktop", "src-tauri", "tauri.conf.json");
const tag = process.env.RELEASE_TAG?.trim();

if (!tag) {
  throw new Error("RELEASE_TAG is required to derive the Tauri installer version.");
}
if (!/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(tag)) {
  throw new Error(`Release tag must look like vX.Y.Z or vX.Y.Z-prerelease: ${tag}`);
}

const releaseVersion = tag.slice(1);
const version = releaseVersion.split(/[+-]/)[0];
const config = JSON.parse(readFileSync(configPath, "utf8"));
config.version = version;
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
console.log(`Set Tauri package version to ${version} in ${configPath} for release ${tag}`);
