import type { ConnectionResult, CredentialProvider, CredentialProviderCapabilities, CredentialSummary, PaginationInput, ProviderLoginInput, ProviderUnlockInput, SensitiveCredential } from "@wardsen/core";

class NotYetImplementedCredentialProvider implements CredentialProvider {
  constructor(readonly id: string, readonly displayName: string, private readonly capabilities: CredentialProviderCapabilities) {}
  async getCapabilities(): Promise<CredentialProviderCapabilities> {
    return this.capabilities;
  }
  async testConnection(_accountId: string): Promise<ConnectionResult> {
    return { ok: false, status: "logged_out", safeMessage: "Not yet implemented" };
  }
  async login(_accountId: string, _input: ProviderLoginInput): Promise<void> {
    throw new Error(`${this.displayName} is not yet implemented`);
  }
  async unlock(_accountId: string, _input: ProviderUnlockInput): Promise<void> {
    throw new Error(`${this.displayName} is not yet implemented`);
  }
  async lock(_accountId: string): Promise<void> {}
  async logout(_accountId: string): Promise<void> {}
  async sync(_accountId: string): Promise<void> {
    throw new Error(`${this.displayName} is not yet implemented`);
  }
  async search(_accountId: string, _query: string, _pagination: PaginationInput): Promise<CredentialSummary[]> {
    throw new Error(`${this.displayName} is not yet implemented`);
  }
  async getCredential(_accountId: string, _itemId: string): Promise<SensitiveCredential> {
    throw new Error(`${this.displayName} is not yet implemented`);
  }
}

export const onePasswordProvider = new NotYetImplementedCredentialProvider("onepassword", "1Password", {
  searchItems: true,
  multipleAccounts: true,
  customServers: false,
  localVaults: false,
  synchronization: true,
  locking: true
});

export const protonPassProvider = new NotYetImplementedCredentialProvider("proton-pass", "Proton Pass", {
  searchItems: true,
  multipleAccounts: true,
  customServers: false,
  localVaults: false,
  synchronization: true,
  locking: true
});

export const keeperProvider = new NotYetImplementedCredentialProvider("keeper", "Keeper", {
  searchItems: true,
  multipleAccounts: true,
  customServers: false,
  localVaults: false,
  synchronization: true,
  locking: true
});
