import rootPackage from "../../../package.json";

const releaseTag = (import.meta as ImportMeta & { env?: { VITE_WARDSEN_RELEASE_TAG?: string } }).env?.VITE_WARDSEN_RELEASE_TAG;

export function formatAppVersion(packageVersion = rootPackage.version, releaseTagOverride = releaseTag): string {
  const cleanReleaseTag = releaseTagOverride?.trim();
  return cleanReleaseTag || `v${packageVersion}`;
}

export const appVersion = formatAppVersion();
