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
    id: "ente-paste",
    displayName: "Ente Paste",
    kind: "delivery",
    maturity: "planned",
    packageName: "@wardsen/provider-scaffolds",
    documentationUrl: "https://paste.ente.com/",
    enabledByDefault: false,
    notes: "Candidate delivery provider only. The public page advertises private E2EE, one-time view and 24-hour auto-delete; do not enable until a supported API or CLI and provider status/revoke semantics pass conformance."
  },
  {
    id: "password-pusher",
    displayName: "Password Pusher",
    kind: "delivery",
    maturity: "planned",
    packageName: "@wardsen/provider-scaffolds",
    documentationUrl: "https://docs.pwpush.com/docs/api-v1/",
    enabledByDefault: false,
    notes: "Candidate delivery provider only. Its documented API includes expiration and view controls; verify instance authentication, redaction, revoke behavior and access telemetry before implementation."
  },
  {
    id: "yopass",
    displayName: "Yopass",
    kind: "delivery",
    maturity: "planned",
    packageName: "@wardsen/provider-scaffolds",
    documentationUrl: "https://github.com/jhaals/yopass",
    enabledByDefault: false,
    notes: "Candidate self-hostable delivery provider only. Its official project documents browser encryption, one-time URLs, expiry and a CLI; verify deployment ownership and status/revoke semantics before implementation."
  },
  {
    id: "onetime-secret",
    displayName: "Onetime Secret",
    kind: "delivery",
    maturity: "planned",
    packageName: "@wardsen/provider-scaffolds",
    documentationUrl: "https://docs.onetimesecret.com/en/rest-api/",
    enabledByDefault: false,
    notes: "Candidate delivery provider only. Its official documentation describes REST API versions, TTL and burn operations; verify regional endpoint policy, sender-side status and revocation before implementation."
  },
  {
    id: "onepassword-item-share",
    displayName: "1Password item sharing",
    kind: "delivery",
    maturity: "planned",
    packageName: "@wardsen/provider-scaffolds",
    documentationUrl: "https://support.1password.com/share-items/",
    enabledByDefault: false,
    notes: "Candidate delivery provider only. 1Password documents unique links, expiry and recipient restrictions in its apps and web product; do not infer a supported CLI/API adapter until one is documented."
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
