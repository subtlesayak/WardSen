import type { CredentialProvider, DeliveryProvider } from "./types";
import type { ProviderKind, ProviderManifest } from "./providerManifest";

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
  return { providerId: provider.id, kind: "delivery", passed: failures.length === 0, failures };
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
  if (manifest.maturity !== "active") failures.push(`Provider ${provider.id} cannot be registered as functional while maturity is ${manifest.maturity}`);
  if (!manifest.enabledByDefault) failures.push(`Provider ${provider.id} cannot be registered as functional while disabled by default`);
  return failures;
}
