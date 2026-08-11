const publicRelease = process.env.WARDSEN_PUBLIC_RELEASE === "true";
const platform = process.env.WARDSEN_RELEASE_PLATFORM;

if (!publicRelease) {
  console.log("Public release readiness check skipped for draft/prerelease validation build.");
  process.exit(0);
}

const failures = [];

if (!process.env.RELEASE_TAG || !/^v\d+\.\d+\.\d+$/.test(process.env.RELEASE_TAG)) {
  failures.push("RELEASE_TAG must be a final vX.Y.Z tag for public release mode.");
}

if (platform === "windows" && !process.env.WINDOWS_CERTIFICATE_BASE64) {
  failures.push("WINDOWS_CERTIFICATE_BASE64 is required for public Windows release artifacts.");
}

if (platform === "macos" && process.env.MACOS_SIGNING_ENABLED !== "true") {
  failures.push("MACOS_SIGNING_ENABLED=true is required for public macOS release artifacts.");
}

if (platform === "macos") {
  for (const key of ["APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD", "APPLE_SIGNING_IDENTITY", "APPLE_API_ISSUER", "APPLE_API_KEY", "APPLE_API_KEY_P8"]) {
    if (!process.env[key]) failures.push(`${key} is required for public macOS signing and notarization.`);
  }
}

if (!platform || !["windows", "macos"].includes(platform)) {
  failures.push("WARDSEN_RELEASE_PLATFORM must be windows or macos.");
}

if (failures.length > 0) {
  console.error("Public release readiness failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Public release readiness passed for ${platform} ${process.env.RELEASE_TAG}.`);
