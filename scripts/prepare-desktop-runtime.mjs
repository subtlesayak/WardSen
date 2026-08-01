import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { execPath, platform } from "node:process";

const root = process.cwd();
const source = process.env.WARDSEN_NODE_PATH || execPath;
const parsed = path.parse(source);
const targetName = platform === "win32" ? "node.exe" : "node";
const targetDir = path.join(root, "apps", "desktop", "src-tauri", "gen", "runtime");
const target = path.join(targetDir, targetName);

if (!path.isAbsolute(source)) {
  throw new Error("WARDSEN_NODE_PATH must be an absolute path when provided.");
}
if (!existsSync(source) || !statSync(source).isFile()) {
  throw new Error(`Node.js runtime does not exist: ${source}`);
}
if (platform === "win32" && parsed.base.toLowerCase() !== "node.exe") {
  throw new Error(`Expected a Windows node.exe runtime, got: ${source}`);
}
if (platform !== "win32" && parsed.base !== "node") {
  throw new Error(`Expected a node runtime executable, got: ${source}`);
}

mkdirSync(targetDir, { recursive: true });
copyFileSync(source, target);
console.log(`Prepared desktop Node.js runtime: ${target}`);
