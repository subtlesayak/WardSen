import type { CredentialProvider, DeliveryProvider } from "./types";

export class ProviderRegistry {
  private readonly credentialProviders = new Map<string, CredentialProvider>();
  private readonly deliveryProviders = new Map<string, DeliveryProvider>();

  registerCredentialProvider(provider: CredentialProvider): void {
    if (this.credentialProviders.has(provider.id)) {
      throw new Error(`Credential provider already registered: ${provider.id}`);
    }
    this.credentialProviders.set(provider.id, provider);
  }

  registerDeliveryProvider(provider: DeliveryProvider): void {
    if (this.deliveryProviders.has(provider.id)) {
      throw new Error(`Delivery provider already registered: ${provider.id}`);
    }
    this.deliveryProviders.set(provider.id, provider);
  }

  getCredentialProvider(id: string): CredentialProvider {
    const provider = this.credentialProviders.get(id);
    if (!provider) throw new Error(`Unknown credential provider: ${id}`);
    return provider;
  }

  getDeliveryProvider(id: string): DeliveryProvider {
    const provider = this.deliveryProviders.get(id);
    if (!provider) throw new Error(`Unknown delivery provider: ${id}`);
    return provider;
  }

  listCredentialProviders(): CredentialProvider[] {
    return [...this.credentialProviders.values()];
  }

  listDeliveryProviders(): DeliveryProvider[] {
    return [...this.deliveryProviders.values()];
  }
}
