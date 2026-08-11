export type ProviderKind = "credential" | "delivery";
export type ProviderMaturity = "active" | "experimental" | "planned";

export interface ProviderManifest {
  id: string;
  displayName: string;
  kind: ProviderKind;
  maturity: ProviderMaturity;
  packageName?: string;
  documentationUrl?: string;
  enabledByDefault: boolean;
  notes: string;
}

export const builtInProviderManifests: ProviderManifest[] = [
  {
    id: "bitwarden",
    displayName: "Bitwarden",
    kind: "credential",
    maturity: "active",
    packageName: "@wardsen/provider-bitwarden",
    documentationUrl: "https://bitwarden.com/help/cli/",
    enabledByDefault: true,
    notes: "Supported credential provider through the official Bitwarden CLI."
  },
  {
    id: "keepassxc",
    displayName: "KeePassXC",
    kind: "credential",
    maturity: "active",
    packageName: "@wardsen/provider-keepassxc",
    documentationUrl: "https://keepassxc.org/docs/KeePassXC_UserGuide#_command_line_tool",
    enabledByDefault: true,
    notes: "Supported local database credential provider through keepassxc-cli."
  },
  {
    id: "bitwarden-send",
    displayName: "Bitwarden Send",
    kind: "delivery",
    maturity: "active",
    packageName: "@wardsen/delivery-bitwarden-send",
    documentationUrl: "https://bitwarden.com/help/send-cli/",
    enabledByDefault: true,
    notes: "Supported delivery provider through Bitwarden Send."
  },
  {
    id: "onepassword",
    displayName: "1Password",
    kind: "credential",
    maturity: "planned",
    packageName: "@wardsen/provider-scaffolds",
    documentationUrl: "https://developer.1password.com/docs/cli/",
    enabledByDefault: false,
    notes: "Roadmap provider only. Do not show in normal account creation until a real adapter passes conformance tests."
  },
  {
    id: "proton-pass",
    displayName: "Proton Pass",
    kind: "credential",
    maturity: "planned",
    packageName: "@wardsen/provider-scaffolds",
    documentationUrl: "https://proton.me/support/pass",
    enabledByDefault: false,
    notes: "Roadmap provider only. Do not show in normal account creation until a real adapter passes conformance tests."
  },
  {
    id: "keeper",
    displayName: "Keeper",
    kind: "credential",
    maturity: "planned",
    packageName: "@wardsen/provider-scaffolds",
    documentationUrl: "https://docs.keeper.io/en/keeperpam/commander-cli",
    enabledByDefault: false,
    notes: "Roadmap provider only. Do not show in normal account creation until a real adapter passes conformance tests."
  }
];

export function activeProviderManifests(kind?: ProviderKind): ProviderManifest[] {
  return builtInProviderManifests.filter((manifest) => manifest.enabledByDefault && manifest.maturity === "active" && (!kind || manifest.kind === kind));
}

export function plannedProviderManifests(kind?: ProviderKind): ProviderManifest[] {
  return builtInProviderManifests.filter((manifest) => manifest.maturity !== "active" && (!kind || manifest.kind === kind));
}

export function providerManifestFor(id: string): ProviderManifest | undefined {
  return builtInProviderManifests.find((manifest) => manifest.id === id);
}
