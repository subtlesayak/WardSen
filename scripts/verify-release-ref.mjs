import { execFileSync } from "node:child_process";

const tag = process.env.RELEASE_TAG?.trim();

if (!tag) {
  throw new Error("RELEASE_TAG is required.");
}
if (!/^v\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(tag)) {
  throw new Error(`Release tag must look like vX.Y.Z or vX.Y.Z-prerelease: ${tag}`);
}

const head = git("rev-parse", "HEAD");
const tagCommit = git("rev-list", "-n", "1", tag);

if (head !== tagCommit) {
  throw new Error(`Release checkout mismatch: HEAD ${head} does not equal ${tag} commit ${tagCommit}.`);
}

console.log(`Verified ${tag} at ${head}`);

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}
