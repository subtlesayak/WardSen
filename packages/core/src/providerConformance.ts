import type { CredentialProvider, DeliveryProvider } from "./types";
import type { ProviderKind, ProviderManifest, ProviderSupportLevel } from "./providerManifest";

export interface ProviderConformanceReport {
  providerId: string;
  kind: ProviderKind;
  passed: boolean;
  failures: string[];
}

export async function verifyCredentialProviderConformance(
  provider: CredentialProvider,
  manifest: ProviderManifest
): Promise<ProviderConformanceReport> {
  const failures = commonProviderFailures(provider, manifest, "credential");
  const capabilities = await provider.getCapabilities();
  for (const [key, value] of Object.entries(capabilities)) {
    if (typeof value !== "boolean") failures.push(`Credential capability ${key} must be boolean`);
  }
  return { providerId: provider.id, kind: "credential", passed: failures.length === 0, failures };
}

export async function verifyDeliveryProviderConformance(
  provider: DeliveryProvider,
  manifest: ProviderManifest
): Promise<ProviderConformanceReport> {
  const failures = commonProviderFailures(provider, manifest, "delivery");
  const capabilities = await provider.getCapabilities();
  for (const [key, value] of Object.entries(capabilities)) {
    if (typeof value !== "boolean") failures.push(`Delivery capability ${key} must be boolean`);
  }
  if (!manifest.delivery) {
    failures.push(`Delivery provider ${provider.id} must declare delivery readiness metadata`);
  } else {
    assertSupportMatchesCapability(failures, "revoke", manifest.delivery.revoke, capabilities.revokeLink);
    assertSupportMatchesCapability(failures, "statusLookup", manifest.delivery.statusLookup, capabilities.statusLookup);
    assertSupportMatchesCapability(failures, "accessCount", manifest.delivery.accessCount, capabilities.accessCount);
    if (manifest.delivery.secureLinkCreation !== "supported" && manifest.delivery.secureLinkCreation !== "manual") {
      failures.push(`Delivery provider ${provider.id} must support automated or manual secure link creation`);
    }
    if (manifest.delivery.viewerIdentity === "provider_verified") {
      failures.push(`Provider ${provider.id} must not claim provider-verified viewer identity without a provider event contract`);
    }
  }
  return { providerId: provider.id, kind: "delivery", passed: failures.length === 0, failures };
}

export function verifyProviderManifestCatalog(manifests: ProviderManifest[]): ProviderConformanceReport {
  const failures: string[] = [];
  const seenIds = new Set<string>();

  for (const manifest of manifests) {
    if (seenIds.has(manifest.id)) failures.push(`Provider manifest id ${manifest.id} must be unique`);
    seenIds.add(manifest.id);
    if (manifest.maturity === "active" && !manifest.enabledByDefault && !manifest.requiresExplicitOptIn) failures.push(`Active provider ${manifest.id} must be enabled by default or require explicit opt-in`);
    if (manifest.maturity === "planned" && manifest.enabledByDefault) failures.push(`Planned provider ${manifest.id} must stay disabled by default`);
    if (manifest.kind !== "delivery") continue;
    if (!manifest.delivery) {
      failures.push(`Delivery provider ${manifest.id} must declare delivery readiness metadata`);
      continue;
    }
    if (manifest.maturity !== "active" && manifest.delivery.secureLinkCreation !== "manual" && manifest.delivery.promotionBlockedBy.length === 0) {
      failures.push(`Candidate delivery provider ${manifest.id} must list promotion blockers`);
    }
    if (manifest.maturity !== "active" && manifest.delivery.viewerIdentity === "provider_verified") {
      failures.push(`Candidate delivery provider ${manifest.id} cannot claim provider-verified viewer identity`);
    }
  }

  return { providerId: "provider-catalog", kind: "delivery", passed: failures.length === 0, failures };
}

function commonProviderFailures(
  provider: { id: string; displayName: string },
  manifest: ProviderManifest,
  expectedKind: ProviderKind
): string[] {
  const failures: string[] = [];
  if (manifest.kind !== expectedKind) failures.push(`Manifest kind must be ${expectedKind}`);
  if (manifest.id !== provider.id) failures.push(`Manifest id ${manifest.id} must match provider id ${provider.id}`);
  if (manifest.displayName !== provider.displayName) failures.push(`Manifest display name ${manifest.displayName} must match provider display name ${provider.displayName}`);
  if (manifest.maturity === "planned") failures.push(`Provider ${provider.id} cannot be registered as functional while maturity is ${manifest.maturity}`);
  if (!manifest.enabledByDefault && !manifest.requiresExplicitOptIn) failures.push(`Provider ${provider.id} cannot be registered as functional while disabled by default`);
  return failures;
}

function assertSupportMatchesCapability(
  failures: string[],
  readinessName: string,
  support: ProviderSupportLevel,
  capability: boolean
): void {
  if (capability && support !== "supported") failures.push(`Delivery readiness ${readinessName} must be supported when the capability is enabled`);
  if (!capability && support === "supported") failures.push(`Delivery readiness ${readinessName} cannot be supported when the capability is disabled`);
}
