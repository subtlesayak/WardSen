export type CredentialItemType = "login" | "note" | "identity" | "other";
export type AccountStatus = "logged_out" | "locked" | "unlocked" | "syncing" | "error";
export type DeliveryStatusValue =
  | "queued"
  | "creating"
  | "active"
  | "viewed"
  | "limit_reached"
  | "expired"
  | "revoked"
  | "failed"
  | "cancelled";

export interface PaginationInput {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ConnectionResult {
  ok: boolean;
  status: AccountStatus;
  safeMessage?: string;
}

export interface ProviderLoginInput {
  username?: string;
  password?: string;
  verificationCode?: string;
  verificationMethod?: "email" | "authenticator" | "yubikey";
  serverUrl?: string;
  sso?: boolean;
}

export interface ProviderUnlockInput {
  password?: string;
  keyFilePath?: string;
  databasePath?: string;
}

export interface CredentialSummary {
  id: string;
  accountId: string;
  providerId: string;
  title: string;
  username?: string;
  domain?: string;
  uriPreview?: string;
  itemType: CredentialItemType;
}

export interface SensitiveCredential {
  title: string;
  username?: string;
  password?: string;
  urls: string[];
  notes?: string;
  totp?: string;
}

export interface CredentialProviderCapabilities {
  searchItems: boolean;
  multipleAccounts: boolean;
  customServers: boolean;
  localVaults: boolean;
  synchronization: boolean;
  locking: boolean;
}

export interface CredentialProvider {
  id: string;
  displayName: string;
  getCapabilities(): Promise<CredentialProviderCapabilities>;
  testConnection(accountId: string): Promise<ConnectionResult>;
  login(accountId: string, input: ProviderLoginInput): Promise<void>;
  unlock(accountId: string, input: ProviderUnlockInput): Promise<void>;
  lock(accountId: string): Promise<void>;
  logout(accountId: string): Promise<void>;
  sync(accountId: string): Promise<void>;
  search(accountId: string, query: string, pagination: PaginationInput): Promise<CredentialSummary[]>;
  getCredential(accountId: string, itemId: string): Promise<SensitiveCredential>;
}

export interface DeliveryProviderCapabilities {
  externalLinks: boolean;
  recipientEmailRestriction: boolean;
  arbitraryViewLimit: boolean;
  viewOnce: boolean;
  customExpiry: boolean;
  accessPassword: boolean;
  hideText: boolean;
  revokeLink: boolean;
  accessCount: boolean;
}

export interface DeliveryRecipient {
  id: string;
  name: string;
  email?: string;
  phone?: string;
}

export interface CreateDeliveryInput {
  sourceCredential: SensitiveCredential;
  recipient?: DeliveryRecipient;
  expiresAt: Date;
  viewLimit?: number;
  viewOnce?: boolean;
  accessPassword?: string;
  hideText?: boolean;
  deliveryAccountId?: string;
}

export interface DeliveryResult {
  deliveryId: string;
  url: string;
  expiresAt: Date;
  viewLimit?: number;
}

export interface DeliveryStatus {
  deliveryId: string;
  status: DeliveryStatusValue;
  accessCount?: number;
  expiresAt?: Date;
  revokedAt?: Date;
}

export interface DeliveryProvider {
  id: string;
  displayName: string;
  getCapabilities(): Promise<DeliveryProviderCapabilities>;
  testConnection(accountId: string): Promise<ConnectionResult>;
  createDelivery(input: CreateDeliveryInput): Promise<DeliveryResult>;
  revoke(accountId: string, deliveryId: string): Promise<void>;
  getStatus(accountId: string, deliveryId: string): Promise<DeliveryStatus>;
}

export interface AccountRecord {
  id: string;
  providerId: string;
  label: string;
  username?: string;
  serverUrl?: string;
  profileDirectory: string;
  accountType?: string;
  autoLockMinutes: number;
  status: AccountStatus;
  lastSync?: string;
  lastActivity?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersonRecord {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  groupName?: string;
  role?: string;
  notes?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DeliveryRecord {
  id: string;
  providerDeliveryId?: string;
  sourceProviderId: string;
  sourceAccountId: string;
  sourceItemId: string;
  deliveryProviderId: string;
  deliveryAccountId: string;
  credentialName: string;
  personId?: string;
  batchId?: string;
  deliveryMethod?: "copy" | "whatsapp" | "email";
  createdAt: string;
  expiresAt: string;
  viewLimit?: number;
  accessCount?: number;
  status: DeliveryStatusValue;
  revokedAt?: string;
  lastCheckedAt?: string;
}

export interface DeliveryBatchRecord {
  id: string;
  requestedCount: number;
  completedCount: number;
  failedCount: number;
  cancelled: boolean;
  createdAt: string;
  completedAt?: string;
}

export interface AuditLogRecord {
  id: string;
  action: string;
  sourceAccountId?: string;
  deliveryAccountId?: string;
  personId?: string;
  deliveryId?: string;
  outcome: "success" | "failure" | "cancelled";
  safeDetails?: string;
  createdAt: string;
}
