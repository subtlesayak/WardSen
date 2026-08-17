export type ProviderKind = "credential" | "delivery";
export type ProviderMaturity = "active" | "experimental" | "planned";
export type ProviderIntegrationSurface = "official_cli" | "official_api" | "self_hosted_api" | "web_only" | "unknown";
export type ProviderSupportLevel = "supported" | "manual" | "unsupported" | "unknown";
export type ViewerIdentitySupport = "provider_verified" | "recipient_link_only" | "unsupported" | "unknown";

export interface DeliveryProviderReadiness {
  integrationSurface: ProviderIntegrationSurface;
  secureLinkCreation: ProviderSupportLevel;
  revoke: ProviderSupportLevel;
  statusLookup: ProviderSupportLevel;
  accessCount: ProviderSupportLevel;
  viewerIdentity: ViewerIdentitySupport;
  promotionBlockedBy: string[];
}

export interface ProviderManifest {
  id: string;
  displayName: string;
  kind: ProviderKind;
  maturity: ProviderMaturity;
  packageName?: string;
  documentationUrl?: string;
  enabledByDefault: boolean;
  requiresExplicitOptIn?: boolean;
  optInWarning?: string;
  notes: string;
  setupInstructions?: string[];
  delivery?: DeliveryProviderReadiness;
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
    notes: "Supported delivery provider through Bitwarden Send.",
    delivery: {
      integrationSurface: "official_cli",
      secureLinkCreation: "supported",
      revoke: "supported",
      statusLookup: "supported",
      accessCount: "supported",
      viewerIdentity: "recipient_link_only",
      promotionBlockedBy: []
    }
  },
  {
    id: "ente-paste",
    displayName: "Ente Paste (experimental manual)",
    kind: "delivery",
    maturity: "experimental",
    packageName: "@wardsen/delivery-ente-paste",
    documentationUrl: "https://paste.ente.com/",
    enabledByDefault: false,
    requiresExplicitOptIn: true,
    optInWarning: "Manual browser handoff only. WardSen cannot revoke the link or observe access, access counts, viewer identity, IP address, device or user-agent data.",
    notes: "Experimental manual handoff provider. WardSen copies only the credential title, username and password to the local clipboard, offers an explicit local clipboard-clear action, returns an Ente Paste open action for the operator, and records a handoff-pending delivery. URLs, TOTP secrets and notes are excluded. Public Ente Paste docs do not expose sender-visible status, revoke, access count, IP, device or user-agent telemetry.",
    delivery: {
      integrationSurface: "web_only",
      secureLinkCreation: "manual",
      revoke: "unsupported",
      statusLookup: "unsupported",
      accessCount: "unsupported",
      viewerIdentity: "unsupported",
      promotionBlockedBy: [
        "official API or CLI contract",
        "automated ciphertext upload contract",
        "sender-visible status mapping",
        "revoke semantics",
        "operator confirmation of browser-side one-time paste creation"
      ]
    }
  },
  {
    id: "password-pusher",
    displayName: "Password Pusher",
    kind: "delivery",
    maturity: "active",
    packageName: "@wardsen/delivery-external",
    documentationUrl: "https://docs.pwpush.com/docs/api-v1/",
    enabledByDefault: true,
    notes: "Authenticated Password Pusher API delivery. WardSen projects only title, username and password, uses whole-day expiry and can expire or check a push. It does not claim sender-visible access counts or viewer identity.",
    setupInstructions: [
      "Set WARDSEN_PASSWORD_PUSHER_API_TOKEN in the local WardSen service environment.",
      "Optionally set WARDSEN_PASSWORD_PUSHER_BASE_URL to a trusted HTTPS Password Pusher instance; the default is https://pwpush.com.",
      "Choose a vault account as the audit account when creating a delivery; the API token stays only in the local process environment."
    ],
    delivery: {
      integrationSurface: "official_api",
      secureLinkCreation: "supported",
      revoke: "supported",
      statusLookup: "supported",
      accessCount: "unsupported",
      viewerIdentity: "unsupported",
      promotionBlockedBy: []
    }
  },
  {
    id: "yopass",
    displayName: "Yopass",
    kind: "delivery",
    maturity: "active",
    packageName: "@wardsen/delivery-external",
    documentationUrl: "https://github.com/jhaals/yopass",
    enabledByDefault: false,
    requiresExplicitOptIn: true,
    optInWarning: "One-time delivery without WardSen lifecycle controls. WardSen cannot revoke the link or observe access, access counts, viewer identity, IP address, device or user-agent data.",
    notes: "Yopass CLI delivery. The local CLI encrypts projected credential text before upload and returns a one-time link. WardSen cannot revoke, refresh or attribute that link through the current CLI contract.",
    setupInstructions: [
      "Install the official yopass CLI and verify yopass --version in a terminal.",
      "Set WARDSEN_YOPASS_CLI_PATH to an absolute executable path when the desktop app cannot see the CLI.",
      "Optionally set WARDSEN_YOPASS_API_URL and WARDSEN_YOPASS_PUBLIC_URL to operator-controlled HTTPS endpoints."
    ],
    delivery: {
      integrationSurface: "official_cli",
      secureLinkCreation: "supported",
      revoke: "unsupported",
      statusLookup: "unsupported",
      accessCount: "unsupported",
      viewerIdentity: "unsupported",
      promotionBlockedBy: []
    }
  },
  {
    id: "onetime-secret",
    displayName: "Onetime Secret",
    kind: "delivery",
    maturity: "active",
    packageName: "@wardsen/delivery-external",
    documentationUrl: "https://docs.onetimesecret.com/en/rest-api/",
    enabledByDefault: true,
    notes: "Authenticated Onetime Secret v2 delivery. WardSen creates a concealed one-time secret, reads receipt state and can burn the delivery. Receipt state proves link state, not the recipient's identity or device.",
    setupInstructions: [
      "Set WARDSEN_ONETIME_SECRET_USERNAME and WARDSEN_ONETIME_SECRET_API_TOKEN in the local WardSen service environment.",
      "Optionally set WARDSEN_ONETIME_SECRET_BASE_URL to an allowed regional or self-hosted HTTPS endpoint; the default is https://us.onetimesecret.com.",
      "Use a separate access password when required; WardSen sends it only to Onetime Secret and never stores it."
    ],
    delivery: {
      integrationSurface: "official_api",
      secureLinkCreation: "supported",
      revoke: "supported",
      statusLookup: "supported",
      accessCount: "unsupported",
      viewerIdentity: "unsupported",
      promotionBlockedBy: []
    }
  },
  {
    id: "onepassword-item-share",
    displayName: "1Password item sharing",
    kind: "delivery",
    maturity: "planned",
    packageName: "@wardsen/provider-scaffolds",
    documentationUrl: "https://support.1password.com/share-items/",
    enabledByDefault: false,
    notes: "Candidate delivery provider only. 1Password documents unique links, expiry and recipient restrictions in its apps and web product; do not infer a supported CLI/API adapter until one is documented.",
    delivery: {
      integrationSurface: "unknown",
      secureLinkCreation: "unknown",
      revoke: "unknown",
      statusLookup: "unknown",
      accessCount: "unknown",
      viewerIdentity: "unknown",
      promotionBlockedBy: [
        "supported automation surface",
        "recipient restriction automation",
        "status and revoke mapping",
        "provider-specific conformance tests"
      ]
    }
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
  return builtInProviderManifests.filter((manifest) => manifest.maturity === "planned" && (!kind || manifest.kind === kind));
}

export function explicitOptInProviderManifests(kind?: ProviderKind): ProviderManifest[] {
  return builtInProviderManifests.filter((manifest) => manifest.requiresExplicitOptIn && (!kind || manifest.kind === kind));
}

export function providerManifestFor(id: string): ProviderManifest | undefined {
  return builtInProviderManifests.find((manifest) => manifest.id === id);
}
