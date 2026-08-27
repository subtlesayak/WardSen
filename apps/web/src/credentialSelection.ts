export interface CredentialSelectionIdentity {
  providerId: string;
  accountId: string;
  id: string;
}

export function credentialSelectionKey(credential: CredentialSelectionIdentity): string {
  return `${credential.providerId}:${credential.accountId}:${credential.id}`;
}

export function orderSelectedCredentialsFirst<T extends CredentialSelectionIdentity>(
  items: readonly T[],
  selectedCredentials: readonly CredentialSelectionIdentity[]
): T[] {
  const selectedKeys = new Set(selectedCredentials.map(credentialSelectionKey));
  const selected: T[] = [];
  const unselected: T[] = [];

  for (const item of items) {
    (selectedKeys.has(credentialSelectionKey(item)) ? selected : unselected).push(item);
  }

  return [...selected, ...unselected];
}
