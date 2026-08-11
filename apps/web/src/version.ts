import rootPackage from "../../../package.json";

interface ReleaseEnv {
  VITE_WARDSEN_RELEASE_TAG?: string;
  VITE_WARDSEN_RELEASE_SHA?: string;
  VITE_WARDSEN_BUILD_TIMESTAMP?: string;
  VITE_WARDSEN_RELEASE_SCHEMA_VERSION?: string;
}

const releaseEnv = (import.meta as ImportMeta & { env?: ReleaseEnv }).env;
const releaseTag = releaseEnv?.VITE_WARDSEN_RELEASE_TAG;

export function formatAppVersion(packageVersion = rootPackage.version, releaseTagOverride = releaseTag): string {
  const cleanReleaseTag = releaseTagOverride?.trim();
  return cleanReleaseTag || `v${packageVersion}`;
}

export function releaseBuildMetadata(env: ReleaseEnv | undefined = releaseEnv, packageVersion = rootPackage.version) {
  return {
    schemaVersion: Number(env?.VITE_WARDSEN_RELEASE_SCHEMA_VERSION ?? 1),
    version: formatAppVersion(packageVersion, env?.VITE_WARDSEN_RELEASE_TAG),
    packageVersion,
    tag: env?.VITE_WARDSEN_RELEASE_TAG?.trim() || undefined,
    sha: env?.VITE_WARDSEN_RELEASE_SHA?.trim() || undefined,
    buildTimestamp: env?.VITE_WARDSEN_BUILD_TIMESTAMP?.trim() || undefined
  };
}

export const appVersion = formatAppVersion();
export const appReleaseMetadata = releaseBuildMetadata();
