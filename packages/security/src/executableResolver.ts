import fs from "node:fs";
import path from "node:path";

export interface ProviderExecutableResolutionInput {
  toolName: string;
  envPathKey?: string;
  trustedCandidates?: string[];
}

export function resolveProviderExecutable(input: ProviderExecutableResolutionInput): string {
  const candidates = providerExecutableCandidates(input);
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? input.toolName;
}

export function providerExecutableCandidates(input: ProviderExecutableResolutionInput): string[] {
  const candidates: string[] = [];
  const explicit = input.envPathKey ? process.env[input.envPathKey] : undefined;
  if (explicit) {
    if (!path.isAbsolute(explicit)) {
      throw new Error(`${input.envPathKey} must be an absolute executable path`);
    }
    candidates.push(explicit);
  }
  for (const candidate of input.trustedCandidates ?? []) {
    if (!path.isAbsolute(candidate)) continue;
    candidates.push(candidate);
  }
  return [...new Set(candidates)];
}
