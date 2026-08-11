import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Archive,
  CheckCircle2,
  Copy,
  Database,
  KeyRound,
  Lock,
  Mail,
  RefreshCcw,
  RotateCcw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Trash2,
  UsersRound,
  Vault,
  X
} from "lucide-react";
import { parseBulkDeliveryResult, parseCreatedDeliveryRecord, type BulkDeliveryItemResultContract, type BulkDeliveryResultContract, type CreatedDeliveryRecordContract } from "@wardsen/contracts";
import { apiDownload, apiGet, apiSend, canRestartLocalService, copyExternalUrl, copyTextToClipboard, getLocalServiceStatus, openExternalUrl, openMailDraft, restartLocalService, type LocalServiceStatus } from "./api";
import { describeError } from "./errorHelp";
import { appReleaseMetadata, appVersion } from "./version";
import "./styles.css";

type NavItem = "Overview" | "Vaults" | "Credentials" | "People" | "Requests" | "Deliveries" | "Settings";
type LoadState = "loading" | "ready" | "error";

interface ProviderInfo {
  id: string;
  displayName: string;
  capabilities: Record<string, boolean>;
}

interface AccountRecord {
  id: string;
  providerId: string;
  label: string;
  username?: string;
  serverUrl?: string;
  status: string;
  autoLockMinutes: number;
  updatedAt: string;
}

interface PersonRecord {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  groupName?: string;
  role?: string;
  active: boolean;
}

interface DeliveryRecord {
  id: string;
  operationId?: string;
  operationFingerprint?: string;
  policySnapshot?: Record<string, unknown>;
  providerDeliveryId?: string;
  credentialName: string;
  personId?: string;
  sourceProviderId: string;
  sourceAccountId: string;
  deliveryProviderId: string;
  deliveryAccountId: string;
  batchId?: string;
  deliveryMethod?: "copy" | "whatsapp" | "email";
  createdAt: string;
  expiresAt: string;
  viewLimit?: number;
  accessCount?: number;
  status: string;
  revokedAt?: string;
  lastCheckedAt?: string;
}

interface DeliveryBatchRecord {
  id: string;
  requestedCount: number;
  completedCount: number;
  failedCount: number;
  cancelled: boolean;
  createdAt: string;
  completedAt?: string;
}

interface EmployeeRecord {
  id: string;
  personId?: string;
  name: string;
  assignedEmail: string;
  team?: string;
  role?: string;
  active: boolean;
}

interface CredentialCatalogEntry {
  id: string;
  sourceProviderId: string;
  sourceAccountId: string;
  sourceItemId: string;
  credentialName: string;
  username?: string;
  domain?: string;
  tags: string[];
  riskTier: "low" | "medium" | "high" | "critical";
  allowedEmployeeIds: string[];
  allowedTeams: string[];
  allowedRoles: string[];
  active: boolean;
  autoApprovalPolicy?: CatalogAutoApprovalPolicy;
}

interface CatalogAutoApprovalPolicy {
  maxRiskTier: CredentialCatalogEntry["riskTier"];
  maxExpectedDurationMinutes?: number;
  requireTicketRef: boolean;
}

interface CredentialAccessRequestRecord {
  id: string;
  employeeId: string;
  assignedEmail: string;
  catalogEntryId: string;
  credentialName: string;
  reason: string;
  ticketRef?: string;
  expectedDurationMinutes?: number;
  breakGlass: boolean;
  breakGlassJustification?: string;
  breakGlassConfirmedAt?: string;
  status: "pending" | "approved" | "break_glass" | "denied" | "fulfilled" | "cancelled";
  requestedAt: string;
  approver?: string;
  decisionReason?: string;
  deliveryId?: string;
  deliveryProviderId?: string;
  deliveryAccountId?: string;
  previousDeliveryId?: string;
  replacementCount?: number;
  lastReplacementAt?: string;
}

interface EmployeeSignInCodeResponse {
  employeeId: string;
  assignedEmail: string;
  code: string;
  expiresAt: string;
  delivery: "manual" | "email_draft";
  emailDraft?: {
    senderEmail: string;
    to: string;
    subject: string;
    body: string;
  };
}

interface BulkEmployeeProvisionResponse {
  created: EmployeeRecord[];
  skipped: Array<{ personId: string; reason: string; assignedEmail?: string; employeeId?: string }>;
}

interface EmployeePortalSession {
  sessionToken: string;
  expiresAt: string;
  employee: EmployeeRecord;
}

type CreatedDeliveryRecord = CreatedDeliveryRecordContract;
type BulkDeliveryResult = BulkDeliveryResultContract;
type BulkDeliveryItemResult = BulkDeliveryItemResultContract;
type CredentialAccessRequestCreateResponse = CredentialAccessRequestRecord | {
  request: CredentialAccessRequestRecord;
  delivery?: CreatedDeliveryRecord;
  autoApproved?: boolean;
};

interface CredentialSummary {
  id: string;
  accountId: string;
  providerId: string;
  title: string;
  username?: string;
  domain?: string;
  uriPreview?: string;
  itemType: string;
}

interface CredentialSearchState {
  status: LoadState | "idle";
  query: string;
  providerId: string;
  accountId: string;
  page: number;
  pageSize: number;
  total: number;
  items: CredentialSummary[];
  errors: Array<{ accountId: string; providerId: string; safeMessage: string }>;
  selected?: CredentialSummary;
  error?: string;
}

interface ApiState {
  status: LoadState;
  error?: string;
  loadingMessage?: string;
  credentialProviders: ProviderInfo[];
  deliveryProviders: ProviderInfo[];
  accounts: AccountRecord[];
  people: PersonRecord[];
  employees: EmployeeRecord[];
  catalogEntries: CredentialCatalogEntry[];
  credentialRequests: CredentialAccessRequestRecord[];
  deliveries: DeliveryRecord[];
  batches: DeliveryBatchRecord[];
}

const navItems: Array<{ id: NavItem; icon: React.ElementType }> = [
  { id: "Overview", icon: ShieldCheck },
  { id: "Vaults", icon: Vault },
  { id: "Credentials", icon: KeyRound },
  { id: "People", icon: UsersRound },
  { id: "Requests", icon: Archive },
  { id: "Deliveries", icon: Send },
  { id: "Settings", icon: Settings }
];

function App() {
  const [active, setActive] = useState<NavItem>("Overview");
  const api = useWardSenApi();
  const deliveryProviderId = api.deliveryProviders[0]?.id ?? "bitwarden-send";
  const deliveryCapabilities = api.deliveryProviders.find((provider) => provider.id === deliveryProviderId)?.capabilities ?? {};

  return (
    <div className="shell">
      <a className="skipLink" href="#main-content">Skip to content</a>
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark"><ShieldCheck size={22} aria-hidden="true" /></div>
          <div>
            <strong>WardSen</strong>
            <span>Local dispatch hub</span>
            <span className="brandVersion" title={releaseMetadataTitle()}>{appVersion}</span>
          </div>
        </div>
        <nav aria-label="Primary">
          {navItems.map(({ id, icon: Icon }) => (
            <button key={id} type="button" aria-current={active === id ? "page" : undefined} className={active === id ? "nav active" : "nav"} onClick={() => setActive(id)}>
              <Icon size={18} aria-hidden="true" />
              {id}
            </button>
          ))}
        </nav>
        <p className="disclaimer">
          Independent open-source project. Not affiliated with, endorsed by or sponsored by Bitwarden, 1Password,
          Proton, KeePassXC, Keeper or their respective companies.
        </p>
      </aside>

      <main id="main-content" className="workspace" tabIndex={-1}>
        <header className="topbar">
          <div>
            <h1>{active}</h1>
            <p>WardSen is a local-first credential dispatch hub for password managers and secure-sharing providers.</p>
          </div>
          <div className="topbarActions">
            <span className="versionBadge" title={releaseMetadataTitle()}>{appVersion}</span>
            <button type="button" className="primary" onClick={() => api.refresh()}><RefreshCcw size={16} aria-hidden="true" /> Refresh</button>
          </div>
        </header>

        <ApiBanner api={api} />
        {active === "Overview" && <Overview api={api} />}
        {active === "Vaults" && <Vaults api={api} />}
        {active === "Credentials" && <Credentials api={api} />}
        {active === "People" && <People api={api} />}
        {active === "Requests" && <RequestsView api={api} />}
        {active === "Deliveries" && <Deliveries api={api} />}
        {active === "Settings" && <SettingsView providers={api.deliveryProviders} capabilities={deliveryCapabilities} />}
      </main>
    </div>
  );
}

function useWardSenApi() {
  const [state, setState] = useState<ApiState>({
    status: "loading",
    credentialProviders: [],
    deliveryProviders: [],
    accounts: [],
    people: [],
    employees: [],
    catalogEntries: [],
    credentialRequests: [],
    deliveries: [],
    batches: []
  });

  async function refresh(): Promise<boolean> {
    setState((current) => ({ ...current, status: "loading", error: undefined, loadingMessage: "Loading local WardSen data..." }));
    try {
      const [providers, accounts, people, employees, catalogEntries, credentialRequests, deliveries, batches] = await Promise.all([
        apiGet<{ credentialProviders: ProviderInfo[]; deliveryProviders: ProviderInfo[] }>("/api/providers"),
        apiGet<AccountRecord[]>("/api/accounts"),
        apiGet<{ items: PersonRecord[] }>("/api/people?page=1&pageSize=50"),
        apiGet<{ items: EmployeeRecord[] }>("/api/employees?page=1&pageSize=100"),
        apiGet<{ items: CredentialCatalogEntry[] }>("/api/credential-catalog?page=1&pageSize=100"),
        apiGet<{ items: CredentialAccessRequestRecord[] }>("/api/credential-requests?page=1&pageSize=100"),
        apiGet<{ items: DeliveryRecord[] }>("/api/deliveries?page=1&pageSize=50"),
        apiGet<{ items: DeliveryBatchRecord[] }>("/api/batches?page=1&pageSize=10")
      ]);
      setState({
        status: "ready",
        credentialProviders: providers.credentialProviders,
        deliveryProviders: providers.deliveryProviders,
        accounts,
        people: people.items,
        employees: employees.items,
        catalogEntries: catalogEntries.items,
        credentialRequests: credentialRequests.items,
        deliveries: deliveries.items,
        batches: batches.items,
        loadingMessage: undefined
      });
      return true;
    } catch (error) {
      setState((current) => ({ ...current, status: "error", error: error instanceof Error ? error.message : String(error), loadingMessage: undefined }));
      return false;
    }
  }

  async function recover(): Promise<boolean> {
    if (!canRestartLocalService()) return refresh();
    setState((current) => ({ ...current, status: "loading", error: undefined, loadingMessage: "Restarting WardSen local service..." }));
    try {
      await restartLocalService();
      await sleep(600);
    } catch (error) {
      setState((current) => ({
        ...current,
        status: "error",
        error: `WardSen could not restart the local service. Close and reopen WardSen. Restart detail: ${error instanceof Error ? error.message : String(error)}`,
        loadingMessage: undefined
      }));
      return false;
    }
    const recovered = await refresh();
    if (!recovered) {
      await appendLocalServiceStatus();
    }
    return recovered;
  }

  async function appendLocalServiceStatus() {
    try {
      const status = await getLocalServiceStatus();
      if (!status) return;
      setState((current) => ({
        ...current,
        error: `${current.error ?? "WardSen could not reach the local service."}\n\nDesktop service check:\n${formatLocalServiceStatus(status)}`
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        error: `${current.error ?? "WardSen could not reach the local service."}\n\nDesktop service check failed: ${error instanceof Error ? error.message : String(error)}`
      }));
    }
  }

  async function action(path: string, init: RequestInit = {}) {
    await apiSend(path, init);
    await refresh();
  }

  useEffect(() => {
    let cancelled = false;
    async function loadWithStartupRetries() {
      const delays = [0, 400, 1000, 2000, 4000];
      for (const delay of delays) {
        if (cancelled) return;
        if (delay > 0) await sleep(delay);
        if (cancelled) return;
        const ok = await refresh();
        if (ok) return;
      }
    }
    void loadWithStartupRetries();
    return () => {
      cancelled = true;
    };
  }, []);

  return { ...state, refresh, recover, action, canRestartLocalService: canRestartLocalService() };
}

function releaseMetadataTitle(): string {
  const parts = [`WardSen app version ${appVersion}`];
  if (appReleaseMetadata.sha) parts.push(`SHA ${appReleaseMetadata.sha}`);
  if (appReleaseMetadata.buildTimestamp) parts.push(`Built ${appReleaseMetadata.buildTimestamp}`);
  parts.push(`Release schema ${appReleaseMetadata.schemaVersion}`);
  return parts.join(" / ");
}

function ApiBanner({ api }: { api: ReturnType<typeof useWardSenApi> }) {
  if (api.status === "ready") return null;
  return (
    api.status === "loading"
      ? <div className="notice" role="status" aria-live="polite">{api.loadingMessage ?? "Loading local WardSen data..."}</div>
      : <ErrorNotice message={api.error} actionLabel={api.canRestartLocalService ? "Restart service and retry" : "Retry"} onAction={api.recover} />
  );
}

function Overview({ api }: { api: ReturnType<typeof useWardSenApi> }) {
  const activeDeliveries = api.deliveries.filter((delivery) => delivery.status === "active").length;
  const failedDeliveries = api.deliveries.filter((delivery) => delivery.status === "failed").length;
  return (
    <div className="grid two">
      <Metric label="Connected vaults" value={String(api.accounts.length)} detail={`${api.credentialProviders.length} provider adapters`} />
      <Metric label="Active deliveries" value={String(activeDeliveries)} detail={`${api.deliveries.length} total records`} />
      <Metric label="Failed deliveries" value={String(failedDeliveries)} detail="Retry from delivery history" />
      <Metric label="People" value={String(api.people.length)} detail="Server-side paginated" />
      <section className="panel wide">
        <PanelTitle icon={Database} title="Recent Dispatch Activity" action="Refresh" onAction={api.refresh} />
        <DeliveryTable api={api} />
      </section>
    </div>
  );
}

function Vaults({ api }: { api: ReturnType<typeof useWardSenApi> }) {
  const [accountForm, setAccountForm] = useState({
    providerId: "",
    label: "",
    username: "",
    serverUrl: "",
    autoLockMinutes: "15"
  });
  const [accessForm, setAccessForm] = useState({
    accountId: "",
    password: "",
    verificationCode: "",
    verificationMethod: "email",
    databasePath: "",
    keyFilePath: "",
    sso: false
  });
  const [verificationNeeded, setVerificationNeeded] = useState(false);
  const verificationCodeRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ status: "idle" | "loading" | "ready" | "error"; text?: string }>({ status: "idle" });
  const providerLabel = (id: string) => api.credentialProviders.find((provider) => provider.id === id)?.displayName ?? id;
  const selectedAccount = api.accounts.find((account) => account.id === accessForm.accountId) ?? api.accounts[0];
  const providerId = accountForm.providerId || api.credentialProviders[0]?.id || "bitwarden";
  const selectedAccountIsBitwarden = selectedAccount?.providerId === "bitwarden";
  const unlockDisabledForVerification = selectedAccountIsBitwarden && verificationNeeded;

  useEffect(() => {
    if (verificationNeeded) verificationCodeRef.current?.focus();
  }, [verificationNeeded]);

  async function createAccount(event: React.FormEvent) {
    event.preventDefault();
    setMessage({ status: "loading", text: "Adding account..." });
    try {
      const account = await apiSend<AccountRecord>("/api/accounts", {
        body: JSON.stringify({
          providerId,
          label: accountForm.label,
          username: accountForm.username || undefined,
          serverUrl: accountForm.serverUrl || undefined,
          autoLockMinutes: Number(accountForm.autoLockMinutes) || 15
        })
      });
      setAccessForm((current) => ({ ...current, accountId: account.id }));
      setAccountForm((current) => ({ ...current, label: "", username: "", serverUrl: "" }));
      setMessage({ status: "ready", text: `Added ${account.label}.` });
      await api.refresh();
    } catch (error) {
      setMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function accountAccess(action: "login" | "unlock" | "status") {
    const account = selectedAccount;
    if (!account) {
      setMessage({ status: "error", text: "Create or select an account first." });
      return;
    }
    setMessage({ status: "loading", text: `${titleStatus(action)} running for ${account.label}...` });
    try {
      if (action === "status") {
        const result = await apiGet<{ ok: boolean; status: string; safeMessage?: string }>(`/api/accounts/${account.id}/status`);
        setMessage({ status: result.ok ? "ready" : "error", text: `${account.label}: ${titleStatus(result.status)}${result.safeMessage ? ` (${result.safeMessage})` : ""}` });
        return;
      }
      await apiSend(`/api/accounts/${account.id}/${action}`, {
        body: JSON.stringify({
          username: account.username,
          serverUrl: account.serverUrl,
          password: accessForm.password || undefined,
          verificationCode: accessForm.verificationCode || undefined,
          verificationMethod: accessForm.verificationMethod || undefined,
          databasePath: accessForm.databasePath || undefined,
          keyFilePath: accessForm.keyFilePath || undefined,
          sso: accessForm.sso
        })
      });
      setVerificationNeeded(false);
      setAccessForm((current) => ({ ...current, verificationCode: "" }));
      setMessage({ status: "ready", text: `${titleStatus(action)} completed for ${account.label}.` });
      await api.refresh();
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      const help = describeError(text);
      if (help.kind === "bitwardenVerification") {
        setVerificationNeeded(true);
        window.setTimeout(() => verificationCodeRef.current?.focus(), 0);
      } else if (help.kind === "bitwardenTerminalLogin") {
        setVerificationNeeded(false);
      }
      setMessage({ status: "error", text });
    }
  }

  return (
    <div className="grid">
      {message.status === "error" && <ErrorNotice message={message.text} />}
      {message.status !== "idle" && message.status !== "error" && <div className="notice" role="status" aria-live="polite">{message.text}</div>}
      <form className="panel formGrid" onSubmit={createAccount}>
        <PanelTitle icon={Vault} title="Add Vault Account" action="Refresh" onAction={api.refresh} />
        <label>Provider<select name="providerId" value={providerId} onChange={(event) => setAccountForm((current) => ({ ...current, providerId: event.target.value }))}>
          {api.credentialProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.displayName}</option>)}
        </select></label>
        <label>Label<input name="label" required value={accountForm.label} onChange={(event) => setAccountForm((current) => ({ ...current, label: event.target.value }))} placeholder="Work Bitwarden" /></label>
        <label>Username<input name="username" autoComplete="username" value={accountForm.username} onChange={(event) => setAccountForm((current) => ({ ...current, username: event.target.value }))} placeholder="name@example.com" /></label>
        <label>Server URL<input name="serverUrl" type="url" value={accountForm.serverUrl} onChange={(event) => setAccountForm((current) => ({ ...current, serverUrl: event.target.value }))} placeholder="Optional custom server" /></label>
        <small>WardSen creates an isolated provider profile automatically for each account.</small>
        <label>Auto-lock minutes<input name="autoLockMinutes" value={accountForm.autoLockMinutes} onChange={(event) => setAccountForm((current) => ({ ...current, autoLockMinutes: event.target.value }))} inputMode="numeric" /></label>
        <button className="primary full"><Vault size={16} aria-hidden="true" /> Add account</button>
      </form>
      <section className="panel formGrid">
        <PanelTitle icon={KeyRound} title="Account Access" action="Status" onAction={() => void accountAccess("status")} />
        {selectedAccountIsBitwarden ? (
          <div className="notice compact wide">
            <strong>Bitwarden unlock flow</strong>
            <span>Use <strong>Terminal login / unlock</strong>, type the Bitwarden password only in PowerShell or Terminal, then return here and select <strong>Unlock from terminal session</strong>.</span>
          </div>
        ) : null}
        <label>Account<select value={selectedAccount?.id ?? ""} onChange={(event) => {
          setVerificationNeeded(false);
          setAccessForm((current) => ({ ...current, accountId: event.target.value, verificationCode: "" }));
        }}>
          {api.accounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
        </select></label>
        <label>Password<input value={accessForm.password} onChange={(event) => setAccessForm((current) => ({ ...current, password: event.target.value }))} placeholder={selectedAccountIsBitwarden ? "Leave blank for terminal flow" : "Master password or database password"} type="password" />
          {selectedAccountIsBitwarden ? <small className="fieldInstruction">The copied command runs Bitwarden login visibly, then asks for the Bitwarden password in Terminal to unlock WardSen's isolated profile. Type that password in Terminal, not in WardSen.</small> : null}
        </label>
        {selectedAccountIsBitwarden && verificationNeeded ? (
          <label className={verificationNeeded ? "attentionField" : undefined}>Verification code
            <input
              name="verificationCode"
              ref={verificationCodeRef}
              value={accessForm.verificationCode}
              onChange={(event) => setAccessForm((current) => ({ ...current, verificationCode: event.target.value }))}
              placeholder="Email or authenticator code"
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-describedby="bitwarden-verification-help"
              aria-invalid={verificationNeeded && !accessForm.verificationCode.trim()}
            />
            <small id="bitwarden-verification-help" className="fieldInstruction">{verificationNeeded ? "Bitwarden is waiting for this code. Keep Email / new-device selected for Bitwarden email codes, then select Submit code and login." : "Only needed when Bitwarden emails a new-device code or asks for two-step verification."}</small>
          </label>
        ) : null}
        {selectedAccountIsBitwarden && verificationNeeded ? (
          <label>Code type
            <select
              value={accessForm.verificationMethod}
              onChange={(event) => setAccessForm((current) => ({ ...current, verificationMethod: event.target.value }))}
            >
              <option value="email">Email / new-device code</option>
              <option value="authenticator">Authenticator app</option>
              <option value="yubikey">YubiKey</option>
            </select>
          </label>
        ) : null}
        <label>Database path<input name="databasePath" value={accessForm.databasePath} onChange={(event) => setAccessForm((current) => ({ ...current, databasePath: event.target.value }))} placeholder="KeePassXC .kdbx path" /></label>
        <label>Key file path<input name="keyFilePath" value={accessForm.keyFilePath} onChange={(event) => setAccessForm((current) => ({ ...current, keyFilePath: event.target.value }))} placeholder="Optional KeePassXC key file" /></label>
        <label className="check"><input name="sso" checked={accessForm.sso} type="checkbox" onChange={(event) => setAccessForm((current) => ({ ...current, sso: event.target.checked }))} /> Login with SSO</label>
        <div className="buttonRow">
          <button type="button" className={selectedAccountIsBitwarden || verificationNeeded ? "primary" : undefined} onClick={() => void accountAccess("login")}><ShieldCheck size={16} /> {selectedAccountIsBitwarden ? "Terminal login / unlock" : verificationNeeded ? "Submit code and login" : "Login"}</button>
          <button
            type="button"
            className={selectedAccountIsBitwarden || verificationNeeded ? undefined : "primary"}
            disabled={unlockDisabledForVerification}
            title={unlockDisabledForVerification ? "Submit the Bitwarden verification code with Login first." : undefined}
            onClick={() => void accountAccess("unlock")}
          ><KeyRound size={16} /> {selectedAccountIsBitwarden ? "Unlock from terminal session" : "Unlock"}</button>
          {unlockDisabledForVerification ? <small className="buttonHint">Unlock is available after Bitwarden login finishes.</small> : null}
        </div>
      </section>
      <section className="panel">
        <PanelTitle icon={Vault} title="Vault Accounts" action="Refresh" onAction={api.refresh} />
        {api.accounts.length === 0 ? <EmptyState text="No vault accounts yet. Add one above to begin search and delivery." /> : (
          <div className="rows">
            {api.accounts.map((vault) => (
              <div className="row" key={vault.id}>
                <div>
                  <strong>{vault.label}</strong>
                  <span>{providerLabel(vault.providerId)} / {vault.username ?? "No username"}</span>
                </div>
                <span>{vault.serverUrl ?? "Default server"}</span>
                <Status value={titleStatus(vault.status)} />
                <span>{vault.autoLockMinutes} min lock</span>
                <div className="actions">
                  <button type="button" aria-label={`Select ${vault.label}`} title="Select" onClick={() => setAccessForm((current) => ({ ...current, accountId: vault.id }))}><KeyRound size={16} aria-hidden="true" /></button>
                  <button type="button" aria-label={`Sync ${vault.label}`} title="Sync" onClick={() => api.action(`/api/accounts/${vault.id}/sync`)}><RefreshCcw size={16} aria-hidden="true" /></button>
                  <button type="button" aria-label={`Lock ${vault.label}`} title="Lock" onClick={() => api.action(`/api/accounts/${vault.id}/lock`)}><Lock size={16} aria-hidden="true" /></button>
                  <button type="button" aria-label={`Delete ${vault.label}`} title="Delete" onClick={() => void confirmDestructiveAction(`DELETE ACCOUNT ${vault.id}`, `Delete vault account "${vault.label}"? This removes local account metadata.`).then((confirmed) => {
                    if (confirmed) void api.action(`/api/accounts/${vault.id}`, { method: "DELETE", body: JSON.stringify({ confirm: `DELETE ACCOUNT ${vault.id}` }) });
                  })}><Trash2 size={16} aria-hidden="true" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Credentials({ api }: { api: ReturnType<typeof useWardSenApi> }) {
  const [search, setSearch] = useState<CredentialSearchState>({
    status: "idle",
    query: "",
    providerId: "",
    accountId: "",
    page: 1,
    pageSize: 10,
    total: 0,
    items: [],
    errors: []
  });
  const searchableAccounts = api.accounts.filter((account) =>
    account.status === "unlocked" &&
    (!search.accountId || account.id === search.accountId) &&
    (!search.providerId || account.providerId === search.providerId)
  );
  const lockedSelectedAccount = search.accountId ? api.accounts.find((account) => account.id === search.accountId && account.status !== "unlocked") : undefined;

  async function runSearch(event?: React.FormEvent, page = search.page) {
    event?.preventDefault();
    setSearch((current) => ({ ...current, page, status: "loading", error: undefined, errors: [] }));
    const params = new URLSearchParams({ q: search.query, page: String(page), pageSize: String(search.pageSize) });
    if (search.providerId) params.set("providerId", search.providerId);
    if (search.accountId) params.set("accountId", search.accountId);
    try {
      const result = await apiGet<{
        items: CredentialSummary[];
        total: number;
        errors: Array<{ accountId: string; providerId: string; safeMessage: string }>;
      }>(`/api/credentials/search?${params.toString()}`);
      setSearch((current) => ({
        ...current,
        page,
        status: "ready",
        items: result.items,
        total: result.total,
        errors: result.errors,
        selected: result.items.find((item) => item.id === current.selected?.id && item.accountId === current.selected.accountId)
      }));
    } catch (error) {
      setSearch((current) => ({ ...current, status: "error", error: error instanceof Error ? error.message : String(error) }));
    }
  }

  return (
    <div className="grid split">
      <section className="panel">
        <PanelTitle icon={Search} title="Credential Search" action="Search" onAction={() => void runSearch()} />
        <form className="filters" onSubmit={(event) => runSearch(event, 1)}>
          <select aria-label="Credential account filter" value={search.accountId} onChange={(event) => setSearch((current) => ({ ...current, accountId: event.target.value, page: 1 }))}>
            <option value="">All unlocked vaults</option>
            {api.accounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
          </select>
          <select aria-label="Credential provider filter" value={search.providerId} onChange={(event) => setSearch((current) => ({ ...current, providerId: event.target.value, page: 1 }))}>
            <option value="">All providers</option>
            {api.credentialProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.displayName}</option>)}
          </select>
          <input aria-label="Credential search query" value={search.query} onChange={(event) => setSearch((current) => ({ ...current, query: event.target.value, page: 1 }))} placeholder="Search credential names, usernames or domains" />
          <button className="primary"><Search size={16} aria-hidden="true" /> Search</button>
        </form>
        {search.status === "error" && <ErrorNotice message={search.error} />}
        {search.errors.length > 0 && <ErrorNotice message={formatCredentialSearchIssues(api, search.errors)} />}
        {search.status === "ready" && (
          <div className="pager" role="status" aria-live="polite">
            <span>{search.total} result{search.total === 1 ? "" : "s"} on page {search.page}</span>
            <div className="buttonRow">
              <button type="button" disabled={search.page <= 1} onClick={() => void runSearch(undefined, search.page - 1)}>Previous</button>
              <button type="button" disabled={search.items.length < search.pageSize} onClick={() => void runSearch(undefined, search.page + 1)}>Next</button>
            </div>
          </div>
        )}
        <div className="resultList">
          {search.status === "idle" && <EmptyState text="Run a search after unlocking a vault. Credential secrets stay on the backend." />}
          {search.status === "loading" && <EmptyState text="Searching unlocked vaults..." />}
          {search.status === "ready" && search.items.length === 0 && lockedSelectedAccount && <EmptyState text={`Unlock ${lockedSelectedAccount.label} in Vaults > Account Access before searching credentials. For Bitwarden, use Terminal login, then Unlock from terminal session.`} />}
          {search.status === "ready" && search.items.length === 0 && !lockedSelectedAccount && searchableAccounts.length === 0 && <EmptyState text="No unlocked vaults match this search filter. Go to Vaults > Account Access, unlock a vault, then search again." />}
          {search.status === "ready" && search.items.length === 0 && !lockedSelectedAccount && searchableAccounts.length > 0 && <EmptyState text="No credential summaries matched this search." />}
          {search.items.map((item) => (
            <button
              className={search.selected?.id === item.id && search.selected.accountId === item.accountId ? "result selected" : "result"}
              type="button"
              aria-pressed={search.selected?.id === item.id && search.selected.accountId === item.accountId}
              key={`${item.providerId}-${item.accountId}-${item.id}`}
              onClick={() => setSearch((current) => ({ ...current, selected: item }))}
            >
              <strong>{item.title}</strong>
              <span>{item.username ?? "No username"} / {item.domain ?? item.uriPreview ?? "No domain"} / {accountLabel(api.accounts, item.accountId)}</span>
            </button>
          ))}
        </div>
      </section>
      <DeliveryComposer api={api} selectedCredential={search.selected} />
    </div>
  );
}

function People({ api }: { api: ReturnType<typeof useWardSenApi> }) {
  const [form, setForm] = useState({ name: "", phone: "", email: "", groupName: "", role: "" });
  const [filters, setFilters] = useState({ search: "", groupName: "", active: "active" });
  const [csv, setCsv] = useState("");
  const [message, setMessage] = useState<{ status: "idle" | "loading" | "ready" | "error"; text?: string }>({ status: "idle" });
  const groups = [...new Set(api.people.map((person) => person.groupName).filter(Boolean))].sort();
  const filteredPeople = api.people.filter((person) => {
    const search = filters.search.trim().toLowerCase();
    if (filters.groupName && person.groupName !== filters.groupName) return false;
    if (filters.active === "active" && !person.active) return false;
    if (filters.active === "inactive" && person.active) return false;
    if (!search) return true;
    return [person.name, person.phone, person.email, person.groupName, person.role]
      .filter(Boolean)
      .some((value) => value!.toLowerCase().includes(search));
  });

  async function savePerson(event: React.FormEvent) {
    event.preventDefault();
    setMessage({ status: "loading", text: "Saving person..." });
    try {
      const result = await apiSend<{ person: PersonRecord; duplicates: PersonRecord[] }>("/api/people", {
        body: JSON.stringify({
          name: form.name,
          phone: form.phone || undefined,
          email: form.email || undefined,
          groupName: form.groupName || undefined,
          role: form.role || undefined,
          active: true
        })
      });
      setForm({ name: "", phone: "", email: "", groupName: "", role: "" });
      setMessage({
        status: "ready",
        text: result.duplicates.length > 0 ? `Saved ${result.person.name}; ${result.duplicates.length} possible duplicate${result.duplicates.length === 1 ? "" : "s"} found.` : `Saved ${result.person.name}.`
      });
      await api.refresh();
    } catch (error) {
      setMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function importPeople(event: React.FormEvent) {
    event.preventDefault();
    if (!csv.trim()) {
      setMessage({ status: "error", text: "Paste CSV rows before importing." });
      return;
    }
    setMessage({ status: "loading", text: "Importing people..." });
    try {
      const result = await apiSend<{ importedCount: number; duplicateCount: number }>("/api/people/import", {
        body: JSON.stringify({ csv })
      });
      setCsv("");
      setMessage({ status: "ready", text: `Imported ${result.importedCount} people; ${result.duplicateCount} duplicate signal${result.duplicateCount === 1 ? "" : "s"}.` });
      await api.refresh();
    } catch (error) {
      setMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function exportPeople() {
    try {
      await apiDownload("/api/people/export", "wardsen-people.csv");
    } catch (error) {
      setMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <div className="grid">
      {message.status === "error" && <ErrorNotice message={message.text} />}
      {message.status !== "idle" && message.status !== "error" && <div className="notice" role="status" aria-live="polite">{message.text}</div>}
      <form className="panel formGrid" onSubmit={savePerson}>
        <PanelTitle icon={UsersRound} title="Add Person" action="Refresh" onAction={api.refresh} />
        <label>Name<input name="name" required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Mira Patel" /></label>
        <label>Phone<input name="phone" type="tel" autoComplete="tel" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="+1..." /></label>
        <label>Email<input name="email" type="email" autoComplete="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder="mira@example.com" /></label>
        <label>Group<input name="groupName" value={form.groupName} onChange={(event) => setForm((current) => ({ ...current, groupName: event.target.value }))} placeholder="Ops" /></label>
        <label>Role<input name="role" value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))} placeholder="Admin" /></label>
        <button className="primary full"><UsersRound size={16} aria-hidden="true" /> Save person</button>
      </form>
      <form className="panel formGrid" onSubmit={importPeople}>
        <PanelTitle icon={Archive} title="CSV Import" action="Export" onAction={exportPeople} />
        <label className="spanAll">CSV<textarea name="peopleCsv" value={csv} onChange={(event) => setCsv(event.target.value)} placeholder="name,email,phone,groupName,role&#10;Mira,mira@example.com,+1,Ops,Admin" /></label>
        <button className="primary full"><Archive size={16} aria-hidden="true" /> Import CSV</button>
      </form>
      <section className="panel">
        <PanelTitle icon={UsersRound} title="People Directory" action="Export CSV" onAction={exportPeople} />
        <div className="filters">
          <input aria-label="People search filter" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Search people, groups, phone or email" />
          <select aria-label="People group filter" value={filters.groupName} onChange={(event) => setFilters((current) => ({ ...current, groupName: event.target.value }))}>
            <option value="">All groups</option>
            {groups.map((group) => <option key={group} value={group}>{group}</option>)}
          </select>
          <select aria-label="People active status filter" value={filters.active} onChange={(event) => setFilters((current) => ({ ...current, active: event.target.value }))}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </select>
          <button type="button" onClick={exportPeople}><Archive size={16} aria-hidden="true" /> Export CSV</button>
        </div>
        {filteredPeople.length === 0 ? <EmptyState text="No people match the current filters." /> : (
          <div className="rows">
            {filteredPeople.map((person) => (
              <div className="row person" key={person.id}>
                <div>
                  <strong>{person.name}</strong>
                  <span>{person.email ?? person.phone ?? "No contact"}</span>
                </div>
                <span>{person.groupName ?? "No group"}</span>
                <span>{person.role ?? "No role"}</span>
                <Status value={person.active ? "Active" : "Inactive"} />
                <div className="actions">
                  <button type="button" aria-label={`Copy contact for ${person.name}`} title="Copy contact" onClick={() => navigator.clipboard?.writeText(person.email ?? person.phone ?? person.name)}><Copy size={15} aria-hidden="true" /></button>
                  {person.active ? (
                    <button type="button" aria-label={`Archive ${person.name}`} title="Archive" onClick={() => api.action(`/api/people/${person.id}`, { method: "DELETE" })}><Archive size={15} aria-hidden="true" /></button>
                  ) : (
                    <button type="button" aria-label={`Restore ${person.name}`} title="Restore" onClick={() => api.action(`/api/people/${person.id}/restore`)}><RotateCcw size={15} aria-hidden="true" /></button>
                  )}
                  <button type="button" aria-label={`Delete ${person.name} permanently`} title="Delete permanently" onClick={() => void confirmDestructiveAction(`DELETE PERSON ${person.id}`, `Permanently delete "${person.name}"? This cannot be restored from WardSen.`).then((confirmed) => {
                    if (confirmed) void api.action(`/api/people/${person.id}?hard=true`, { method: "DELETE", body: JSON.stringify({ confirm: `DELETE PERSON ${person.id}` }) });
                  })}><Trash2 size={15} aria-hidden="true" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function RequestsView({ api }: { api: ReturnType<typeof useWardSenApi> }) {
  const [employeeForm, setEmployeeForm] = useState({ personId: "", name: "", assignedEmail: "", team: "", role: "" });
  const [bulkEmployeeForm, setBulkEmployeeForm] = useState<{ personIds: string[]; defaultTeam: string; defaultRole: string }>({ personIds: [], defaultTeam: "", defaultRole: "" });
  const [codeForm, setCodeForm] = useState({ employeeId: "", ttlMinutes: "15", senderEmail: "" });
  const [issuedCode, setIssuedCode] = useState<EmployeeSignInCodeResponse | undefined>();
  const [portalSignInForm, setPortalSignInForm] = useState({ assignedEmail: "", code: "" });
  const [portalSession, setPortalSession] = useState<EmployeePortalSession | undefined>();
  const [portalCatalog, setPortalCatalog] = useState<CredentialCatalogEntry[]>([]);
  const [portalRequests, setPortalRequests] = useState<CredentialAccessRequestRecord[]>([]);
  const [portalRequestForm, setPortalRequestForm] = useState({
    catalogEntryId: "",
    reason: "",
    ticketRef: "",
    expectedDurationMinutes: "60",
    breakGlass: false,
    breakGlassJustification: ""
  });
  const [catalogForm, setCatalogForm] = useState({
    sourceAccountId: "",
    sourceItemId: "",
    credentialName: "",
    username: "",
    domain: "",
    tags: "",
    riskTier: "medium" as CredentialCatalogEntry["riskTier"],
    allowedEmployeeId: "",
    allowedTeams: "",
    allowedRoles: "",
    autoApprovalEnabled: false,
    autoApprovalMaxRiskTier: "low" as CredentialCatalogEntry["riskTier"],
    autoApprovalMaxExpectedDurationMinutes: "60",
    autoApprovalRequireTicketRef: true
  });
  const [requestForm, setRequestForm] = useState({
    employeeId: "",
    catalogEntryId: "",
    reason: "",
    ticketRef: "",
    expectedDurationMinutes: "60",
    breakGlass: false,
    breakGlassJustification: ""
  });
  const [approvalForm, setApprovalForm] = useState({
    approver: "",
    deliveryProviderId: "",
    deliveryAccountId: "",
    expiryHours: "24",
    viewLimit: "1",
    viewOnce: true,
    replacementReason: "Unexpected access or stale link"
  });
  const [message, setMessage] = useState<{ status: "idle" | "loading" | "ready" | "error"; text?: string; url?: string }>({ status: "idle" });
  const activeEmployees = api.employees.filter((employee) => employee.active);
  const employeePeople = api.people.filter((person) => person.active && person.email);
  const employeeEmails = new Set(api.employees.map((employee) => employee.assignedEmail));
  const employeePersonIds = new Set(api.employees.map((employee) => employee.personId).filter(Boolean));
  const provisionablePeople = employeePeople.filter((person) => {
    const email = person.email?.trim().toLowerCase();
    return Boolean(email && !employeeEmails.has(email) && !employeePersonIds.has(person.id));
  });
  const sourceAccountId = catalogForm.sourceAccountId || api.accounts[0]?.id || "";
  const sourceAccount = api.accounts.find((account) => account.id === sourceAccountId);
  const allowedEmployeeId = catalogForm.allowedEmployeeId;
  const codeEmployeeId = codeForm.employeeId || activeEmployees[0]?.id || "";
  const selectedRequestEmployee = activeEmployees.find((employee) => employee.id === requestForm.employeeId);
  const requestCatalog = api.catalogEntries.filter((entry) => entry.active && (!requestForm.employeeId || catalogEntryAllowsEmployee(entry, selectedRequestEmployee)));
  const portalSelectedEntry = portalCatalog.find((entry) => entry.id === portalRequestForm.catalogEntryId);
  const deliveryProviderId = approvalForm.deliveryProviderId || api.deliveryProviders[0]?.id || "";
  const deliveryAccountId = approvalForm.deliveryAccountId || api.accounts[0]?.id || "";

  async function saveEmployee(event: React.FormEvent) {
    event.preventDefault();
    setMessage({ status: "loading", text: "Saving employee identity..." });
    try {
      const employee = await apiSend<EmployeeRecord>("/api/employees", {
        body: JSON.stringify({
          name: employeeForm.name,
          assignedEmail: employeeForm.assignedEmail,
          personId: employeeForm.personId || undefined,
          team: employeeForm.team || undefined,
          role: employeeForm.role || undefined
        })
      });
      setEmployeeForm({ personId: "", name: "", assignedEmail: "", team: "", role: "" });
      setRequestForm((current) => ({ ...current, employeeId: employee.id, catalogEntryId: "" }));
      setMessage({ status: "ready", text: `Saved ${employee.name} with assigned email ${employee.assignedEmail}.` });
      await api.refresh();
    } catch (error) {
      setMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  function selectEmployeePerson(personId: string) {
    const person = employeePeople.find((candidate) => candidate.id === personId);
    setEmployeeForm((current) => ({
      ...current,
      personId,
      name: person?.name ?? current.name,
      assignedEmail: person?.email ?? current.assignedEmail,
      team: person?.groupName ?? current.team,
      role: person?.role ?? current.role
    }));
  }

  function toggleBulkEmployeePerson(personId: string, checked: boolean) {
    setBulkEmployeeForm((current) => ({
      ...current,
      personIds: checked
        ? [...new Set([...current.personIds, personId])]
        : current.personIds.filter((id) => id !== personId)
    }));
  }

  async function provisionEmployeesFromPeople() {
    const personIds = bulkEmployeeForm.personIds.filter((personId) => provisionablePeople.some((person) => person.id === personId));
    if (personIds.length === 0) {
      setMessage({ status: "error", text: "Select at least one eligible Person with an assigned email." });
      return;
    }
    if (!window.confirm(`Provision ${personIds.length} employee request identities from People?\n\nThis grants Employee Portal request access to the selected assigned emails. People without an explicit Employee identity still cannot sign in.`)) {
      return;
    }
    setMessage({ status: "loading", text: `Provisioning ${personIds.length} employee identities...` });
    try {
      const result = await apiSend<BulkEmployeeProvisionResponse>("/api/employees/bulk-from-people", {
        body: JSON.stringify({
          personIds,
          defaultTeam: bulkEmployeeForm.defaultTeam || undefined,
          defaultRole: bulkEmployeeForm.defaultRole || undefined,
          confirm: "PROVISION EMPLOYEES FROM PEOPLE",
          confirmRiskSummary: true
        })
      });
      setBulkEmployeeForm({ personIds: [], defaultTeam: "", defaultRole: "" });
      setMessage({ status: "ready", text: `Provisioned ${result.created.length} employee identities; skipped ${result.skipped.length}.` });
      await api.refresh();
    } catch (error) {
      setMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function issueEmployeeCode(event: React.FormEvent) {
    event.preventDefault();
    if (!codeEmployeeId) {
      setMessage({ status: "error", text: "Add an active employee before issuing a sign-in code." });
      return;
    }
    setMessage({ status: "loading", text: "Issuing employee sign-in code..." });
    try {
      const result = await apiSend<EmployeeSignInCodeResponse>(`/api/employees/${codeEmployeeId}/sign-in-code`, {
        body: JSON.stringify({
          ttlMinutes: Number(codeForm.ttlMinutes) || 15,
          senderEmail: codeForm.senderEmail || undefined
        })
      });
      setIssuedCode(result);
      setPortalSignInForm((current) => ({ ...current, assignedEmail: result.assignedEmail, code: "" }));
      setMessage({ status: "ready", text: result.emailDraft ? `Sign-in code issued and email draft prepared for ${result.assignedEmail}.` : `Sign-in code issued for ${result.assignedEmail}.` });
    } catch (error) {
      setMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function openIssuedCodeEmailDraft() {
    if (!issuedCode?.emailDraft) return;
    setMessage({ status: "loading", text: "Preparing sign-in email draft..." });
    try {
      await copyTextToClipboard(issuedCode.emailDraft.body);
      await openMailDraft(employeeSignInMailtoHref(issuedCode.emailDraft));
      setMessage({
        status: "ready",
        text: `Draft body copied. Send it to ${issuedCode.emailDraft.to} from ${issuedCode.emailDraft.senderEmail}.`
      });
    } catch (error) {
      setMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function employeePortalSignIn(event: React.FormEvent) {
    event.preventDefault();
    setMessage({ status: "loading", text: "Signing in employee..." });
    try {
      const session = await apiSend<EmployeePortalSession>("/api/employee-sessions", {
        body: JSON.stringify({
          assignedEmail: portalSignInForm.assignedEmail,
          code: portalSignInForm.code
        })
      });
      setPortalSession(session);
      setPortalSignInForm({ assignedEmail: session.employee.assignedEmail, code: "" });
      setMessage({ status: "ready", text: `${session.employee.name} signed in to the employee portal.` });
      await loadEmployeePortal(session.sessionToken);
    } catch (error) {
      setMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function loadEmployeePortal(sessionToken = portalSession?.sessionToken) {
    if (!sessionToken) return;
    const headers = employeeSessionHeaders(sessionToken);
    const [catalog, requests] = await Promise.all([
      apiSend<{ items: CredentialCatalogEntry[] }>("/api/employee-portal/catalog?page=1&pageSize=100", { method: "GET", headers }),
      apiSend<{ items: CredentialAccessRequestRecord[] }>("/api/employee-portal/credential-requests?page=1&pageSize=100", { method: "GET", headers })
    ]);
    setPortalCatalog(catalog.items);
    setPortalRequests(requests.items);
    setPortalRequestForm((current) => ({
      ...current,
      catalogEntryId: current.catalogEntryId && catalog.items.some((entry) => entry.id === current.catalogEntryId)
        ? current.catalogEntryId
        : catalog.items[0]?.id ?? ""
    }));
  }

  async function submitEmployeePortalRequest(event: React.FormEvent) {
    event.preventDefault();
    if (!portalSession) {
      setMessage({ status: "error", text: "Employee sign-in is required before requesting access." });
      return;
    }
    setMessage({ status: "loading", text: "Submitting employee portal request..." });
    try {
      const response = await apiSend<CredentialAccessRequestCreateResponse>("/api/employee-portal/credential-requests", {
        headers: employeeSessionHeaders(portalSession.sessionToken),
        body: JSON.stringify({
          catalogEntryId: portalRequestForm.catalogEntryId,
          reason: portalRequestForm.reason,
          ticketRef: portalRequestForm.ticketRef || undefined,
          expectedDurationMinutes: Number(portalRequestForm.expectedDurationMinutes) || undefined
        })
      });
      const { request, delivery, autoApproved } = normalizeAccessRequestResponse(response);
      setPortalRequestForm((current) => ({ ...current, reason: "", ticketRef: "" }));
      setMessage({
        status: "ready",
        text: autoApproved ? `Policy approved ${request.credentialName}; admin delivery confirmation is still required.` : `Employee request queued for ${request.credentialName}.`,
        url: delivery?.oneTimeDeliveryUrl
      });
      await loadEmployeePortal(portalSession.sessionToken);
      await api.refresh();
    } catch (error) {
      setMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function signOutEmployeePortal() {
    if (!portalSession) return;
    setMessage({ status: "loading", text: "Signing out employee..." });
    try {
      await apiSend("/api/employee-sessions/current/logout", {
        headers: employeeSessionHeaders(portalSession.sessionToken)
      });
      setPortalSession(undefined);
      setPortalCatalog([]);
      setPortalRequests([]);
      setMessage({ status: "ready", text: "Employee portal signed out." });
    } catch (error) {
      setMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function saveCatalogEntry(event: React.FormEvent) {
    event.preventDefault();
    if (!sourceAccount) {
      setMessage({ status: "error", text: "Add a vault account before publishing catalog entries." });
      return;
    }
    const allowedTeams = catalogForm.allowedTeams.split(",").map((team) => team.trim()).filter(Boolean);
    const allowedRoles = catalogForm.allowedRoles.split(",").map((role) => role.trim()).filter(Boolean);
    const allowedEmployeeIds = allowedEmployeeId ? [allowedEmployeeId] : [];
    if (allowedEmployeeIds.length === 0 && allowedTeams.length === 0 && allowedRoles.length === 0) {
      setMessage({ status: "error", text: "Add at least one allowed employee, team or role before publishing a catalog entry." });
      return;
    }
    const autoApprovalPolicy: CatalogAutoApprovalPolicy | undefined = catalogForm.autoApprovalEnabled ? {
      maxRiskTier: catalogForm.autoApprovalMaxRiskTier,
      maxExpectedDurationMinutes: Number(catalogForm.autoApprovalMaxExpectedDurationMinutes) || undefined,
      requireTicketRef: catalogForm.autoApprovalRequireTicketRef
    } : undefined;
    setMessage({ status: "loading", text: "Publishing credential metadata to the request catalog..." });
    try {
      const entry = await apiSend<CredentialCatalogEntry>("/api/credential-catalog", {
        body: JSON.stringify({
          sourceProviderId: sourceAccount.providerId,
          sourceAccountId: sourceAccount.id,
          sourceItemId: catalogForm.sourceItemId,
          credentialName: catalogForm.credentialName,
          username: catalogForm.username || undefined,
          domain: catalogForm.domain || undefined,
          tags: catalogForm.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
          riskTier: catalogForm.riskTier,
          allowedEmployeeIds,
          allowedTeams,
          allowedRoles,
          autoApprovalPolicy
        })
      });
      setCatalogForm((current) => ({ ...current, sourceItemId: "", credentialName: "", username: "", domain: "", tags: "", allowedTeams: "", allowedRoles: "" }));
      setRequestForm((current) => ({ ...current, catalogEntryId: entry.id }));
      setMessage({ status: "ready", text: `Published ${entry.credentialName} as requestable metadata.` });
      await api.refresh();
    } catch (error) {
      setMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function submitAccessRequest(event: React.FormEvent) {
    event.preventDefault();
    const assignedEmail = selectedRequestEmployee?.assignedEmail;
    if (!assignedEmail) {
      setMessage({ status: "error", text: "Choose an active employee before submitting a credential request." });
      return;
    }
    setMessage({ status: "loading", text: "Submitting employee credential request..." });
    try {
      const response = await apiSend<CredentialAccessRequestCreateResponse>("/api/credential-requests", {
        body: JSON.stringify({
          employeeId: requestForm.employeeId,
          assignedEmail,
          catalogEntryId: requestForm.catalogEntryId,
          reason: requestForm.reason,
          ticketRef: requestForm.ticketRef || undefined,
          expectedDurationMinutes: Number(requestForm.expectedDurationMinutes) || undefined
        })
      });
      const { request: accessRequest, delivery, autoApproved } = normalizeAccessRequestResponse(response);
      setRequestForm((current) => ({ ...current, reason: "", ticketRef: "" }));
      setMessage({
        status: "ready",
        text: autoApproved ? `Policy approved ${accessRequest.credentialName}; admin delivery confirmation is still required.` : `Request queued for ${accessRequest.credentialName}.`,
        url: delivery?.oneTimeDeliveryUrl
      });
      await api.refresh();
    } catch (error) {
      setMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function approveRequest(accessRequest: CredentialAccessRequestRecord) {
    if (!deliveryProviderId || !deliveryAccountId) {
      setMessage({ status: "error", text: "Choose a delivery provider and delivery account before approving." });
      return;
    }
    const action = accessRequest.status === "approved" ? "Fulfill" : "Approve";
    const confirmed = window.confirm(`${action} ${accessRequest.credentialName} for ${accessRequest.assignedEmail}?\n\nWardSen will create a one-access email delivery link for this assigned employee email.`);
    if (!confirmed) return;
    setMessage({ status: "loading", text: `Approving ${accessRequest.credentialName}...` });
    try {
      const result = await apiSend<{ request: CredentialAccessRequestRecord; delivery: CreatedDeliveryRecord }>(`/api/credential-requests/${accessRequest.id}/approve`, {
        body: JSON.stringify({
          approver: approvalForm.approver || "WardSen admin",
          deliveryProviderId,
          deliveryAccountId,
          expiresAt: new Date(Date.now() + (Number(approvalForm.expiryHours) || 24) * 3600000).toISOString(),
          viewLimit: approvalForm.viewLimit || "1",
          viewOnce: approvalForm.viewOnce,
          confirmRiskSummary: true
        })
      });
      setMessage({ status: "ready", text: `${result.request.credentialName} approved for ${result.request.assignedEmail}.`, url: result.delivery.oneTimeDeliveryUrl });
      await api.refresh();
    } catch (error) {
      setMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function replaceRequestLink(accessRequest: CredentialAccessRequestRecord) {
    if (!deliveryProviderId || !deliveryAccountId) {
      setMessage({ status: "error", text: "Choose a delivery provider and delivery account before replacing a link." });
      return;
    }
    if (!accessRequest.deliveryId) {
      setMessage({ status: "error", text: "Only fulfilled requests with an existing delivery link can be replaced." });
      return;
    }
    const confirmed = window.confirm(`Replace the delivery link for ${accessRequest.credentialName} and ${accessRequest.assignedEmail}?\n\nWardSen will revoke the previous link before creating a fresh one-access email delivery.`);
    if (!confirmed) return;
    setMessage({ status: "loading", text: `Replacing link for ${accessRequest.credentialName}...` });
    try {
      const result = await apiSend<{ request: CredentialAccessRequestRecord; delivery: CreatedDeliveryRecord }>(`/api/credential-requests/${accessRequest.id}/replacement-link`, {
        body: JSON.stringify({
          approver: approvalForm.approver || "WardSen admin",
          deliveryProviderId,
          deliveryAccountId,
          expiresAt: new Date(Date.now() + (Number(approvalForm.expiryHours) || 24) * 3600000).toISOString(),
          viewLimit: approvalForm.viewLimit || "1",
          viewOnce: approvalForm.viewOnce,
          replacementReason: approvalForm.replacementReason || "Unexpected access or stale link",
          confirmRiskSummary: true,
          confirm: `REPLACE REQUEST ${accessRequest.id}`
        })
      });
      setMessage({ status: "ready", text: `Replacement link created for ${result.request.assignedEmail}.`, url: result.delivery.oneTimeDeliveryUrl });
      await api.refresh();
    } catch (error) {
      setMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function denyRequest(accessRequest: CredentialAccessRequestRecord) {
    setMessage({ status: "loading", text: `Denying ${accessRequest.credentialName}...` });
    try {
      await apiSend<CredentialAccessRequestRecord>(`/api/credential-requests/${accessRequest.id}/deny`, {
        body: JSON.stringify({
          approver: approvalForm.approver || "WardSen admin",
          decisionReason: "Denied in WardSen admin panel"
        })
      });
      setMessage({ status: "ready", text: `${accessRequest.credentialName} request denied.` });
      await api.refresh();
    } catch (error) {
      setMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <div className="grid">
      {message.status === "error" && <ErrorNotice message={message.text} />}
      {message.status !== "idle" && message.status !== "error" && (
        <div className="notice" role="status" aria-live="polite">
          {message.text}
          {message.url ? <CopyFeedbackButton value={message.url} label="Copy approved link" copiedLabel="Approved link copied" /> : null}
        </div>
      )}
      <form className="panel formGrid" onSubmit={saveEmployee}>
        <PanelTitle icon={UsersRound} title="Admin Employee Identity" action="Refresh" onAction={api.refresh} />
        <label className="spanAll">Link person<select name="employeePersonId" value={employeeForm.personId} onChange={(event) => selectEmployeePerson(event.target.value)}>
          <option value="">No linked person</option>
          {employeePeople.map((person) => <option key={person.id} value={person.id}>{person.name} / {person.email}</option>)}
        </select></label>
        <label>Name<input name="employeeName" required value={employeeForm.name} onChange={(event) => setEmployeeForm((current) => ({ ...current, name: event.target.value }))} placeholder="Ravi Menon" /></label>
        <label>Assigned email<input name="assignedEmail" required type="email" value={employeeForm.assignedEmail} onChange={(event) => setEmployeeForm((current) => ({ ...current, assignedEmail: event.target.value }))} placeholder="ravi@example.com" /></label>
        <label>Team<input name="employeeTeam" value={employeeForm.team} onChange={(event) => setEmployeeForm((current) => ({ ...current, team: event.target.value }))} placeholder="Ops" /></label>
        <label>Role<input name="employeeRole" value={employeeForm.role} onChange={(event) => setEmployeeForm((current) => ({ ...current, role: event.target.value }))} placeholder="Engineer" /></label>
        <button className="primary full"><UsersRound size={16} aria-hidden="true" /> Save employee</button>
      </form>
      <section className="panel formGrid">
        <PanelTitle icon={UsersRound} title="Bulk Employee Provisioning" action="Refresh" onAction={api.refresh} />
        <label>Default team<input value={bulkEmployeeForm.defaultTeam} onChange={(event) => setBulkEmployeeForm((current) => ({ ...current, defaultTeam: event.target.value }))} placeholder="Ops" /></label>
        <label>Default role<input value={bulkEmployeeForm.defaultRole} onChange={(event) => setBulkEmployeeForm((current) => ({ ...current, defaultRole: event.target.value }))} placeholder="Member" /></label>
        <div className="riskSummary spanAll">
          <strong>{bulkEmployeeForm.personIds.length} selected / {provisionablePeople.length} eligible</strong>
          <div className="buttonRow">
            <button type="button" disabled={provisionablePeople.length === 0} onClick={() => setBulkEmployeeForm((current) => ({ ...current, personIds: provisionablePeople.map((person) => person.id) }))}>Select all eligible</button>
            <button type="button" disabled={bulkEmployeeForm.personIds.length === 0} onClick={() => setBulkEmployeeForm((current) => ({ ...current, personIds: [] }))}>Clear</button>
          </div>
          {provisionablePeople.slice(0, 12).map((person) => (
            <label key={person.id} className="checkboxLine">
              <input
                type="checkbox"
                checked={bulkEmployeeForm.personIds.includes(person.id)}
                onChange={(event) => toggleBulkEmployeePerson(person.id, event.target.checked)}
              />
              <span>{person.name} / {person.email}</span>
            </label>
          ))}
          {provisionablePeople.length > 12 ? <span>{provisionablePeople.length - 12} more eligible People not shown in this compact panel.</span> : null}
          {provisionablePeople.length === 0 ? <span>No eligible People with unused assigned emails.</span> : null}
        </div>
        <button type="button" className="primary full" disabled={bulkEmployeeForm.personIds.length === 0} onClick={() => void provisionEmployeesFromPeople()}><UsersRound size={16} aria-hidden="true" /> Provision selected</button>
      </section>
      <form className="panel formGrid" onSubmit={issueEmployeeCode}>
        <PanelTitle icon={KeyRound} title="Employee Sign-In Code" action="Refresh" onAction={api.refresh} />
        <label>Employee<select value={codeEmployeeId} onChange={(event) => setCodeForm((current) => ({ ...current, employeeId: event.target.value }))}>
          {activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} / {employee.assignedEmail}</option>)}
        </select></label>
        <label>Code minutes<input inputMode="numeric" value={codeForm.ttlMinutes} onChange={(event) => setCodeForm((current) => ({ ...current, ttlMinutes: event.target.value }))} /></label>
        <label className="spanAll">Sender email<input type="email" value={codeForm.senderEmail} onChange={(event) => setCodeForm((current) => ({ ...current, senderEmail: event.target.value }))} placeholder="security@example.com" /></label>
        {issuedCode ? (
          <div className="riskSummary spanAll">
            <strong>{issuedCode.assignedEmail}</strong>
            <code>{issuedCode.code}</code>
            <span>Expires {formatDate(issuedCode.expiresAt)}</span>
            <CopyFeedbackButton value={issuedCode.code} label="Copy code" copiedLabel="Code copied" />
            {issuedCode.emailDraft ? (
              <>
                <span>Email draft: {issuedCode.emailDraft.senderEmail} to {issuedCode.emailDraft.to}</span>
                <CopyFeedbackButton value={issuedCode.emailDraft.body} label="Copy draft body" copiedLabel="Draft body copied" />
                <button type="button" onClick={() => void openIssuedCodeEmailDraft()}><Mail size={15} aria-hidden="true" /> Copy body and open draft</button>
              </>
            ) : null}
          </div>
        ) : null}
        <button className="primary full" disabled={!codeEmployeeId}><KeyRound size={16} aria-hidden="true" /> Issue code</button>
      </form>
      <form className="panel formGrid" onSubmit={saveCatalogEntry}>
        <PanelTitle icon={KeyRound} title="Admin Catalog Metadata" action="Refresh" onAction={api.refresh} />
        <label>Vault account<select value={sourceAccountId} onChange={(event) => setCatalogForm((current) => ({ ...current, sourceAccountId: event.target.value }))}>
          {api.accounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
        </select></label>
        <label>Source item ID<input required value={catalogForm.sourceItemId} onChange={(event) => setCatalogForm((current) => ({ ...current, sourceItemId: event.target.value }))} placeholder="Vault item id" /></label>
        <label>Credential name<input required value={catalogForm.credentialName} onChange={(event) => setCatalogForm((current) => ({ ...current, credentialName: event.target.value }))} placeholder="GitHub Production" /></label>
        <label>Allowed employee<select value={allowedEmployeeId} onChange={(event) => setCatalogForm((current) => ({ ...current, allowedEmployeeId: event.target.value }))}>
          <option value="">No exact employee</option>
          {activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} / {employee.assignedEmail}</option>)}
        </select></label>
        <label>Allowed teams<input value={catalogForm.allowedTeams} onChange={(event) => setCatalogForm((current) => ({ ...current, allowedTeams: event.target.value }))} placeholder="Ops, Support" /></label>
        <label>Allowed roles<input value={catalogForm.allowedRoles} onChange={(event) => setCatalogForm((current) => ({ ...current, allowedRoles: event.target.value }))} placeholder="Engineer, Admin" /></label>
        <label>Username<input value={catalogForm.username} onChange={(event) => setCatalogForm((current) => ({ ...current, username: event.target.value }))} placeholder="Optional metadata" /></label>
        <label>Domain<input value={catalogForm.domain} onChange={(event) => setCatalogForm((current) => ({ ...current, domain: event.target.value }))} placeholder="example.com" /></label>
        <label>Tags<input value={catalogForm.tags} onChange={(event) => setCatalogForm((current) => ({ ...current, tags: event.target.value }))} placeholder="prod, deploy" /></label>
        <label>Risk tier<select value={catalogForm.riskTier} onChange={(event) => setCatalogForm((current) => ({ ...current, riskTier: event.target.value as CredentialCatalogEntry["riskTier"] }))}>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
        </select></label>
        <label className="inlineCheck"><input type="checkbox" checked={catalogForm.autoApprovalEnabled} onChange={(event) => setCatalogForm((current) => ({ ...current, autoApprovalEnabled: event.target.checked }))} /> Auto-approve policy matches</label>
        {catalogForm.autoApprovalEnabled ? (
          <>
            <label>Max risk<select value={catalogForm.autoApprovalMaxRiskTier} onChange={(event) => setCatalogForm((current) => ({ ...current, autoApprovalMaxRiskTier: event.target.value as CredentialCatalogEntry["riskTier"] }))}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select></label>
            <label>Max minutes<input inputMode="numeric" value={catalogForm.autoApprovalMaxExpectedDurationMinutes} onChange={(event) => setCatalogForm((current) => ({ ...current, autoApprovalMaxExpectedDurationMinutes: event.target.value }))} /></label>
            <label className="inlineCheck"><input type="checkbox" checked={catalogForm.autoApprovalRequireTicketRef} onChange={(event) => setCatalogForm((current) => ({ ...current, autoApprovalRequireTicketRef: event.target.checked }))} /> Require ticket</label>
          </>
        ) : null}
        <button className="primary full" disabled={!sourceAccountId}><KeyRound size={16} aria-hidden="true" /> Publish metadata</button>
      </form>
      <form className="panel formGrid" onSubmit={submitAccessRequest}>
        <PanelTitle icon={Archive} title="Employee-Side Request" action="Refresh" onAction={api.refresh} />
        <label>Employee<select required value={requestForm.employeeId} onChange={(event) => {
          setRequestForm((current) => ({ ...current, employeeId: event.target.value, catalogEntryId: "" }));
        }}>
          <option value="">Choose employee</option>
          {activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
        </select></label>
        <label>Assigned email<input required readOnly aria-readonly="true" type="email" value={selectedRequestEmployee?.assignedEmail ?? ""} placeholder="assigned email from employee record" /></label>
        <label>Credential<select required value={requestForm.catalogEntryId} onChange={(event) => setRequestForm((current) => ({ ...current, catalogEntryId: event.target.value }))}>
          <option value="">Choose credential metadata</option>
          {requestCatalog.map((entry) => <option key={entry.id} value={entry.id}>{entry.credentialName} / {titleStatus(entry.riskTier)}</option>)}
        </select></label>
        <label>Expected minutes<input inputMode="numeric" value={requestForm.expectedDurationMinutes} onChange={(event) => setRequestForm((current) => ({ ...current, expectedDurationMinutes: event.target.value }))} /></label>
        <label className="spanAll">Reason<textarea required value={requestForm.reason} onChange={(event) => setRequestForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Emergency deploy rollback" /></label>
        <label>Ticket<input value={requestForm.ticketRef} onChange={(event) => setRequestForm((current) => ({ ...current, ticketRef: event.target.value }))} placeholder="Optional ticket" /></label>
        <button className="primary full" disabled={!requestForm.employeeId || !requestForm.catalogEntryId}><Archive size={16} aria-hidden="true" /> Request access</button>
      </form>
      {!portalSession ? (
        <form className="panel formGrid" onSubmit={employeePortalSignIn}>
          <PanelTitle icon={Lock} title="Employee Portal Sign-In" action="Refresh" onAction={api.refresh} />
          <label>Assigned email<input required type="email" value={portalSignInForm.assignedEmail} onChange={(event) => setPortalSignInForm((current) => ({ ...current, assignedEmail: event.target.value }))} placeholder="ravi@example.com" /></label>
          <label>One-time code<input required value={portalSignInForm.code} onChange={(event) => setPortalSignInForm((current) => ({ ...current, code: event.target.value }))} placeholder="Code" /></label>
          <button className="primary full"><Lock size={16} aria-hidden="true" /> Sign in</button>
        </form>
      ) : (
        <form className="panel formGrid" onSubmit={submitEmployeePortalRequest}>
          <PanelTitle icon={Archive} title="Employee Portal Request" action="Sign out" onAction={() => void signOutEmployeePortal()} />
          <label>Employee<input readOnly aria-readonly="true" value={`${portalSession.employee.name} / ${portalSession.employee.assignedEmail}`} /></label>
          <label>Credential<select required value={portalRequestForm.catalogEntryId} onChange={(event) => setPortalRequestForm((current) => ({ ...current, catalogEntryId: event.target.value }))}>
            <option value="">Choose credential metadata</option>
            {portalCatalog.map((entry) => <option key={entry.id} value={entry.id}>{entry.credentialName} / {titleStatus(entry.riskTier)}</option>)}
          </select></label>
          <label>Expected minutes<input inputMode="numeric" value={portalRequestForm.expectedDurationMinutes} onChange={(event) => setPortalRequestForm((current) => ({ ...current, expectedDurationMinutes: event.target.value }))} /></label>
          <label>Ticket<input value={portalRequestForm.ticketRef} onChange={(event) => setPortalRequestForm((current) => ({ ...current, ticketRef: event.target.value }))} placeholder="Optional ticket" /></label>
          <label className="spanAll">Reason<textarea required value={portalRequestForm.reason} onChange={(event) => setPortalRequestForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Emergency deploy rollback" /></label>
          {portalSelectedEntry ? <small className="spanAll">Selected: {portalSelectedEntry.credentialName} / {portalSelectedEntry.domain ?? portalSelectedEntry.sourceAccountId}</small> : null}
          <button className="primary full" disabled={!portalRequestForm.catalogEntryId}><Archive size={16} aria-hidden="true" /> Submit portal request</button>
          <div className="table spanAll">
            <div className="tableHead requests">
              <span>Credential</span><span>Employee</span><span>Assigned email</span><span>Reason</span><span>Status</span><span>Actions</span>
            </div>
            {portalRequests.map((accessRequest) => (
              <div className="tableRow requests" key={accessRequest.id}>
                <strong>{accessRequest.credentialName}</strong>
                <span>{portalSession.employee.name}</span>
                <span>{accessRequest.assignedEmail}</span>
                <span>{accessRequest.reason}</span>
                <Status value={titleStatus(accessRequest.status)} />
                <span>{accessRequest.ticketRef ?? formatDate(accessRequest.requestedAt)}</span>
              </div>
            ))}
            {portalRequests.length === 0 ? <EmptyState text="No employee portal requests yet." /> : null}
          </div>
        </form>
      )}
      <section className="panel">
        <PanelTitle icon={Send} title="Admin Request Queue" action="Refresh" onAction={api.refresh} />
        <div className="filters">
          <input aria-label="Approver name" value={approvalForm.approver} onChange={(event) => setApprovalForm((current) => ({ ...current, approver: event.target.value }))} placeholder="Approver" />
          <select aria-label="Approval delivery provider" value={deliveryProviderId} onChange={(event) => setApprovalForm((current) => ({ ...current, deliveryProviderId: event.target.value }))}>
            {api.deliveryProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.displayName}</option>)}
          </select>
          <select aria-label="Approval delivery account" value={deliveryAccountId} onChange={(event) => setApprovalForm((current) => ({ ...current, deliveryAccountId: event.target.value }))}>
            {api.accounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
          </select>
          <input aria-label="Approval expiry hours" inputMode="numeric" value={approvalForm.expiryHours} onChange={(event) => setApprovalForm((current) => ({ ...current, expiryHours: event.target.value }))} placeholder="Hours" />
          <input aria-label="Approval view limit" inputMode="numeric" value={approvalForm.viewLimit} onChange={(event) => setApprovalForm((current) => ({ ...current, viewLimit: event.target.value }))} placeholder="Views" />
          <input aria-label="Replacement reason" value={approvalForm.replacementReason} onChange={(event) => setApprovalForm((current) => ({ ...current, replacementReason: event.target.value }))} placeholder="Replacement reason" />
          <label className="inlineCheck"><input type="checkbox" checked={approvalForm.viewOnce} onChange={(event) => setApprovalForm((current) => ({ ...current, viewOnce: event.target.checked }))} /> One access</label>
        </div>
        {api.credentialRequests.length === 0 ? <EmptyState text="No credential requests yet." /> : (
          <div className="table">
            <div className="tableHead requests">
              <span>Credential</span><span>Employee</span><span>Assigned email</span><span>Reason</span><span>Status</span><span>Actions</span>
            </div>
            {api.credentialRequests.map((accessRequest) => (
              <div className="tableRow requests" key={accessRequest.id}>
                <div>
                  <strong>{accessRequest.credentialName}</strong>
                  <span>{accessRequest.ticketRef ?? formatDate(accessRequest.requestedAt)}</span>
                  {(accessRequest.replacementCount ?? 0) > 0 ? <span>{accessRequest.replacementCount} replacement{accessRequest.replacementCount === 1 ? "" : "s"} / previous {accessRequest.previousDeliveryId ?? "link"}</span> : null}
                </div>
                <span>{employeeLabel(api.employees, accessRequest.employeeId)}</span>
                <span>{accessRequest.assignedEmail}</span>
                <span>{accessRequest.reason}</span>
                <Status value={titleStatus(accessRequest.status)} />
                <div className="actions">
                  <button type="button" disabled={accessRequest.status !== "pending" && accessRequest.status !== "approved"} onClick={() => void approveRequest(accessRequest)}><Send size={15} aria-hidden="true" /> {accessRequest.status === "approved" ? "Fulfill" : "Approve"}</button>
                  <button type="button" disabled={accessRequest.status !== "fulfilled" || !accessRequest.deliveryId} onClick={() => void replaceRequestLink(accessRequest)}><RotateCcw size={15} aria-hidden="true" /> Replace</button>
                  <button type="button" disabled={accessRequest.status !== "pending" && accessRequest.status !== "approved"} onClick={() => void denyRequest(accessRequest)}><X size={15} aria-hidden="true" /> Deny</button>
                  {accessRequest.deliveryId ? <button type="button" aria-label={`Copy delivery ID for ${accessRequest.credentialName}`} title="Copy delivery ID" onClick={() => navigator.clipboard?.writeText(accessRequest.deliveryId ?? "")}><Copy size={15} aria-hidden="true" /></button> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Deliveries({ api }: { api: ReturnType<typeof useWardSenApi> }) {
  const [batchDetails, setBatchDetails] = useState<{ status: LoadState | "idle"; batchId?: string; deliveries: DeliveryRecord[]; error?: string }>({
    status: "idle",
    deliveries: []
  });

  async function loadBatch(batchId: string) {
    setBatchDetails({ status: "loading", batchId, deliveries: [] });
    try {
      const result = await apiGet<{ items: DeliveryRecord[] }>(`/api/deliveries?batchId=${encodeURIComponent(batchId)}&page=1&pageSize=100`);
      setBatchDetails({ status: "ready", batchId, deliveries: result.items });
    } catch (error) {
      setBatchDetails({ status: "error", batchId, deliveries: [], error: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <div className="grid">
      <section className="panel">
        <PanelTitle icon={ShieldCheck} title="Delivery Audit" action="Refresh" onAction={api.refresh} />
        <DeliveryAuditPanel deliveries={api.deliveries} people={api.people} />
      </section>
      <section className="panel">
        <PanelTitle icon={Send} title="Delivery History" action="Refresh" onAction={api.refresh} />
        <DeliveryTable api={api} />
      </section>
      <section className="panel">
        <PanelTitle icon={Archive} title="Bulk Batches" action="Refresh" onAction={api.refresh} />
        <BatchTable api={api} selectedBatchId={batchDetails.batchId} onSelectBatch={loadBatch} />
      </section>
      {batchDetails.status !== "idle" && (
        <section className="panel">
          <PanelTitle icon={Database} title="Batch Deliveries" action="Refresh" onAction={() => batchDetails.batchId && void loadBatch(batchDetails.batchId)} />
          {batchDetails.status === "loading" && <EmptyState text="Loading batch deliveries..." />}
          {batchDetails.status === "error" && <ErrorNotice message={batchDetails.error} />}
          {batchDetails.status === "ready" && <BatchDeliveryTable deliveries={batchDetails.deliveries} people={api.people} />}
        </section>
      )}
    </div>
  );
}

function DeliveryAuditPanel({ deliveries, people }: { deliveries: DeliveryRecord[]; people: PersonRecord[] }) {
  const personName = (id?: string) => people.find((person) => person.id === id)?.name ?? "Shared link";
  const watched = [...deliveries]
    .filter((delivery) => ["active", "viewed", "limit_reached", "expired", "revoked"].includes(delivery.status))
    .sort((a, b) => leakSignalRank(b) - leakSignalRank(a) || (b.lastCheckedAt ?? b.createdAt).localeCompare(a.lastCheckedAt ?? a.createdAt))
    .slice(0, 6);

  if (watched.length === 0) {
    return <EmptyState text="No provider access signals yet. Refresh deliveries after creating links to check provider status." />;
  }

  return (
    <div className="auditGrid">
      {watched.map((delivery) => {
        const signal = leakSignal(delivery);
        return (
          <article className={`auditItem ${signal.level}`} key={delivery.id}>
            <div>
              <strong>{attributionLabel(delivery, personName)}</strong>
              <span>{delivery.credentialName}</span>
            </div>
            <Status value={signal.label} />
            <dl>
              <div><dt>Access</dt><dd>{accessLabel(delivery)}</dd></div>
              <div><dt>First observed</dt><dd>{firstObservedLabel(delivery)}</dd></div>
              <div><dt>Last checked</dt><dd>{delivery.lastCheckedAt ? formatDate(delivery.lastCheckedAt) : "Not checked"}</dd></div>
              <div><dt>State</dt><dd>{titleStatus(delivery.status)}</dd></div>
            </dl>
            <p>{signal.detail}</p>
          </article>
        );
      })}
    </div>
  );
}

function SettingsView({ providers, capabilities }: { providers: ProviderInfo[]; capabilities: Record<string, boolean> }) {
  return (
    <section className="panel">
      <PanelTitle icon={Settings} title="Provider Capabilities" action="Refresh" />
      <div className="filters">
        <select>{providers.map((provider) => <option key={provider.id}>{provider.displayName}</option>)}</select>
      </div>
      <div className="capabilityGrid">
        {Object.entries(capabilities).map(([key, enabled]) => (
          <div className={enabled ? "capability enabled" : "capability"} key={key}>
            <CheckCircle2 size={16} />
            <span>{key.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`)}</span>
            <strong>{enabled ? "Supported" : "Hidden or disabled"}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function DeliveryComposer({ api, selectedCredential }: { api: ReturnType<typeof useWardSenApi>; selectedCredential?: CredentialSummary }) {
  const [form, setForm] = useState({
    mode: "shared" as "shared" | "individual" | "bulk",
    personId: "",
    deliveryProviderId: "",
    deliveryAccountId: "",
    expiryHours: "24",
    viewLimit: "",
    viewOnce: false,
    hideText: false,
    accessPassword: "",
    deliveryMethod: "copy" as "copy" | "whatsapp" | "email"
  });
  const [submit, setSubmit] = useState<{ status: "idle" | "loading" | "ready" | "error"; message?: string; url?: string }>({ status: "idle" });
  const [bulkResults, setBulkResults] = useState<BulkDeliveryItemResult[]>([]);
  const deliveryProviderId = form.deliveryProviderId || api.deliveryProviders[0]?.id || "";
  const deliveryAccountId = form.deliveryAccountId || selectedCredential?.accountId || api.accounts[0]?.id || "";
  const capabilities = api.deliveryProviders.find((provider) => provider.id === deliveryProviderId)?.capabilities ?? {};
  const activePeople = api.people.filter((person) => person.active);
  const recipient = activePeople.find((person) => person.id === form.personId);
  const personName = (id?: string) => api.people.find((person) => person.id === id)?.name ?? id ?? "Shared link";
  const recipientPlaceholder = form.mode === "individual" ? "Choose a person" : form.mode === "bulk" ? "All active people" : "Shared link";
  const bulkSummary = selectedCredential
    ? buildBulkRiskSummary({
        credentialTitle: selectedCredential.title,
        sourceVault: accountLabel(api.accounts, selectedCredential.accountId),
        deliveryProvider: providerLabel(api.deliveryProviders, deliveryProviderId),
        recipientCount: activePeople.length,
        linkMode: form.mode === "bulk" ? "One link per active person" : titleStatus(form.mode),
        expiry: `${form.expiryHours} hours`,
        viewLimit: form.viewLimit || "Unlimited"
      })
    : "";

  async function createDelivery(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedCredential) {
      setSubmit({ status: "error", message: "Select a credential from search before creating a link." });
      return;
    }
    if (!deliveryProviderId || !deliveryAccountId) {
      setSubmit({ status: "error", message: "Choose a delivery provider and delivery account." });
      return;
    }
    const expiresAt = new Date(Date.now() + Number(form.expiryHours) * 60 * 60 * 1000).toISOString();
    setSubmit({ status: "loading", message: "Creating secure delivery..." });
    setBulkResults([]);
    try {
      const payload = {
        operationId: newOperationId(form.mode === "bulk" ? "bulk" : "delivery"),
        sourceProviderId: selectedCredential.providerId,
        sourceAccountId: selectedCredential.accountId,
        sourceItemId: selectedCredential.id,
        deliveryProviderId,
        deliveryAccountId,
        expiresAt,
        viewLimit: capabilities.arbitraryViewLimit ? form.viewLimit || undefined : undefined,
        viewOnce: capabilities.viewOnce ? form.viewOnce : undefined,
        hideText: capabilities.hideText ? form.hideText : undefined,
        accessPassword: capabilities.accessPassword ? form.accessPassword || undefined : undefined,
        deliveryMethod: form.deliveryMethod
      };
      if (form.mode === "bulk") {
        if (activePeople.length === 0) {
          setSubmit({ status: "error", message: "Add at least one active person before creating a bulk batch." });
          return;
        }
        if (!window.confirm(`${bulkSummary}\n\nExpiry and view limits control access to the link. They cannot prevent someone from saving a credential after viewing it.`)) {
          setSubmit({ status: "idle" });
          return;
        }
        const largeBatchConfirmation = activePeople.length > 25 ? window.prompt(`Large batch confirmation required. Type SEND ${activePeople.length} to continue.`) ?? "" : undefined;
        if (activePeople.length > 25 && largeBatchConfirmation !== `SEND ${activePeople.length}`) {
          setSubmit({ status: "error", message: `Large batch cancelled. Confirmation phrase must be SEND ${activePeople.length}.` });
          return;
        }
        const batch: BulkDeliveryResult = parseBulkDeliveryResult(await apiSend<unknown>("/api/deliveries/bulk", {
          body: JSON.stringify({
            ...payload,
            recipients: activePeople.map((person) => ({ id: person.id, name: person.name, email: person.email, phone: person.phone })),
            concurrency: 2,
            confirmRiskSummary: true,
            largeBatchConfirmation
          })
        }));
        setSubmit({
          status: batch.failedCount > 0 ? "error" : "ready",
          message: `Batch ${batch.batchId}: ${batch.completedCount}/${batch.requestedCount} links created, ${batch.failedCount} failed.`
        });
        setBulkResults(batch.results);
      } else {
        const created = parseCreatedDeliveryRecord(await apiSend<unknown>("/api/deliveries", {
          body: JSON.stringify({
            ...payload,
            recipient: form.mode === "individual" && recipient ? { id: recipient.id, name: recipient.name, email: recipient.email, phone: recipient.phone } : undefined
          })
        }));
        setSubmit({ status: "ready", message: "Delivery created.", url: created.oneTimeDeliveryUrl });
        setBulkResults([]);
      }
      await api.refresh();
    } catch (error) {
      setSubmit({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <form className="panel composer" onSubmit={createDelivery}>
      <PanelTitle icon={Send} title="Delivery Form" action="Create" />
      <label>Source vault<input name="sourceVault" value={selectedCredential ? accountLabel(api.accounts, selectedCredential.accountId) : "Select from credential search"} readOnly /></label>
      <label>Selected credential<input name="selectedCredential" value={selectedCredential ? `${selectedCredential.title} (${accountLabel(api.accounts, selectedCredential.accountId)})` : "Select from credential search"} readOnly /></label>
      <label>Recipient<select name="recipientId" value={form.personId} disabled={form.mode !== "individual"} onChange={(event) => setForm((current) => ({ ...current, personId: event.target.value }))}>
        <option value="">{recipientPlaceholder}</option>
        {activePeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
      </select></label>
      <label>Delivery provider<select name="deliveryProviderId" value={deliveryProviderId} onChange={(event) => setForm((current) => ({ ...current, deliveryProviderId: event.target.value }))}>
        {api.deliveryProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.displayName}</option>)}
      </select></label>
      <label>Delivery account<select name="deliveryAccountId" value={deliveryAccountId} onChange={(event) => setForm((current) => ({ ...current, deliveryAccountId: event.target.value }))}>
        {api.accounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
      </select></label>
      <div className="segmented" role="group" aria-label="Delivery recipient mode">
        <button type="button" aria-pressed={form.mode === "shared"} className={form.mode === "shared" ? "selected" : ""} onClick={() => setForm((current) => ({ ...current, mode: "shared", personId: "" }))}>Shared</button>
        <button type="button" aria-pressed={form.mode === "individual"} className={form.mode === "individual" ? "selected" : ""} onClick={() => setForm((current) => ({ ...current, mode: "individual", personId: current.personId || activePeople[0]?.id || "" }))}>Individual</button>
        <button type="button" aria-pressed={form.mode === "bulk"} className={form.mode === "bulk" ? "selected" : ""} onClick={() => setForm((current) => ({ ...current, mode: "bulk", personId: "" }))}>All active</button>
      </div>
      <label>Expiry<select name="expiryHours" value={form.expiryHours} onChange={(event) => setForm((current) => ({ ...current, expiryHours: event.target.value }))}>
        <option value="24">24 hours</option>
        <option value="72">3 days</option>
        <option value="168">7 days</option>
      </select></label>
      <label>View limit<input name="viewLimit" value={form.viewLimit} disabled={!capabilities.arbitraryViewLimit} onChange={(event) => setForm((current) => ({ ...current, viewLimit: event.target.value }))} placeholder="Blank for unlimited" /></label>
      <label>Method<select name="deliveryMethod" value={form.deliveryMethod} onChange={(event) => setForm((current) => ({ ...current, deliveryMethod: event.target.value as "copy" | "whatsapp" | "email" }))}>
        <option value="copy">Copy link</option>
        <option value="email">Email</option>
        <option value="whatsapp">WhatsApp</option>
      </select></label>
      <label className="check"><input name="viewOnce" checked={capabilities.viewOnce ? form.viewOnce : false} disabled={!capabilities.viewOnce} type="checkbox" onChange={(event) => setForm((current) => ({ ...current, viewOnce: event.target.checked }))} /> View once</label>
      <label className="check"><input name="hideText" checked={capabilities.hideText ? form.hideText : false} disabled={!capabilities.hideText} type="checkbox" onChange={(event) => setForm((current) => ({ ...current, hideText: event.target.checked }))} /> Hide text in provider link</label>
      <label>Access password<input name="accessPassword" value={capabilities.accessPassword ? form.accessPassword : ""} disabled={!capabilities.accessPassword} onChange={(event) => setForm((current) => ({ ...current, accessPassword: event.target.value }))} placeholder="Optional provider password" type="password" /></label>
      {form.mode === "bulk" && selectedCredential && (
        <div className="riskSummary">
          <strong>Bulk confirmation summary</strong>
          <span>{bulkSummary}</span>
          <span>Expiry and view limits control link access; they cannot stop someone from saving a viewed credential.</span>
        </div>
      )}
      {submit.status === "error" && <ErrorNotice message={submit.message} compact />}
      {submit.status !== "idle" && submit.status !== "error" && (
        <div className="notice compact" role="status" aria-live="polite">
          {submit.message}
          {submit.url && <CopyFeedbackButton value={submit.url} label="Copy link" />}
        </div>
      )}
      {bulkResults.length > 0 && (
        <BulkHandoffResults
          results={bulkResults}
          personName={personName}
          method={form.deliveryMethod}
          onCopy={(url) => copyTextToClipboard(url)}
        />
      )}
      <button className="primary full" disabled={submit.status === "loading" || !selectedCredential || (form.mode === "individual" && !recipient)}>
        <Send size={16} aria-hidden="true" /> {form.mode === "bulk" ? "Create secure links" : "Create secure link"}
      </button>
    </form>
  );
}

function DeliveryTable({ api }: { api: ReturnType<typeof useWardSenApi> }) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [message, setMessage] = useState<{ status: "idle" | "loading" | "ready" | "error"; text?: string; url?: string }>({ status: "idle" });
  const personName = (id?: string) => api.people.find((person) => person.id === id)?.name ?? "Shared link";
  const visibleDeliveries = api.deliveries.filter((delivery) => statusFilter === "all" || delivery.status === statusFilter);
  const statuses = [...new Set(api.deliveries.map((delivery) => delivery.status))].sort();

  async function rowAction(delivery: DeliveryRecord, action: "refresh" | "retry" | "revoke") {
    setMessage({ status: "loading", text: `${titleStatus(action)} running for ${delivery.credentialName}...` });
    try {
      if (action === "refresh") {
        const refreshed = await apiSend<DeliveryRecord>(`/api/deliveries/${delivery.id}/refresh`);
        setMessage({ status: "ready", text: `${delivery.credentialName}: ${titleStatus(refreshed.status)} checked.` });
      }
      if (action === "retry") {
        const retried = parseCreatedDeliveryRecord(await apiSend<unknown>(`/api/deliveries/${delivery.id}/retry`));
        setMessage({ status: "ready", text: `Retry created for ${delivery.credentialName}.`, url: retried.oneTimeDeliveryUrl });
      }
      if (action === "revoke") {
        const confirm = `REVOKE DELIVERY ${delivery.id}`;
        const confirmed = await confirmDestructiveAction(confirm, `Revoke the provider link for "${delivery.credentialName}"? Recipients may lose access immediately.`);
        if (!confirmed) {
          setMessage({ status: "idle" });
          return;
        }
        const revoked = await apiSend<DeliveryRecord>(`/api/deliveries/${delivery.id}`, { method: "DELETE", body: JSON.stringify({ confirm }) });
        setMessage({ status: "ready", text: `${delivery.credentialName}: ${titleStatus(revoked.status)}.` });
      }
      await api.refresh();
    } catch (error) {
      setMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function refreshAll() {
    setMessage({ status: "loading", text: "Refreshing active deliveries..." });
    const active = api.deliveries.filter((delivery) => delivery.status === "active");
    const results = await Promise.allSettled(active.map((delivery) => apiSend<DeliveryRecord>(`/api/deliveries/${delivery.id}/refresh`)));
    const failures = results.filter((result) => result.status === "rejected").length;
    setMessage({
      status: failures ? "error" : "ready",
      text: `Refreshed ${results.length - failures}/${results.length} active deliveries${failures ? `; ${failures} failed` : ""}.`
    });
    await api.refresh();
  }

  if (api.deliveries.length === 0) return <EmptyState text="No deliveries yet. Create links after unlocking a vault." />;
  return (
    <div className="grid">
      {message.status === "error" && <ErrorNotice message={message.text} compact />}
      {message.status !== "idle" && message.status !== "error" && (
        <div className="notice compact" role="status" aria-live="polite">
          {message.text}
          {message.url && <CopyFeedbackButton value={message.url} label="Copy retry link" copiedLabel="Retry link copied" />}
        </div>
      )}
      <div className="filters">
        <select aria-label="Delivery status filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">All statuses</option>
          {statuses.map((status) => <option key={status} value={status}>{titleStatus(status)}</option>)}
        </select>
        <button type="button" onClick={() => void refreshAll()}><RefreshCcw size={16} aria-hidden="true" /> Refresh active</button>
      </div>
      <div className="table">
        <div className="tableHead">
          <span>Credential</span><span>Person</span><span>Provider</span><span>Expiry</span><span>Access</span><span>Status</span><span>Actions</span>
        </div>
        {visibleDeliveries.map((delivery) => (
          <div className="tableRow" key={delivery.id}>
            <div>
              <strong>{delivery.credentialName}</strong>
              <span>{delivery.deliveryMethod ? titleStatus(delivery.deliveryMethod) : "Copy"} / {delivery.lastCheckedAt ? `Checked ${formatDate(delivery.lastCheckedAt)}` : "Not checked"}</span>
            </div>
            <span>{personName(delivery.personId)}</span>
            <span>{delivery.deliveryProviderId}</span>
            <span>{formatDate(delivery.expiresAt)}</span>
            <span>{delivery.accessCount ?? 0}{delivery.viewLimit ? ` / ${delivery.viewLimit}` : ""}</span>
            <Status value={titleStatus(delivery.status)} />
            <div className="actions">
              <button type="button" aria-label={`Copy provider ID for ${delivery.credentialName}`} title="Copy provider ID" onClick={() => navigator.clipboard?.writeText(delivery.providerDeliveryId ?? delivery.id)}><Copy size={15} aria-hidden="true" /></button>
              <button type="button" aria-label={`Create email draft for ${delivery.credentialName}`} title="Create email draft" disabled={delivery.deliveryMethod !== "email"} onClick={() => window.open(`mailto:?subject=${encodeURIComponent(`WardSen delivery: ${delivery.credentialName}`)}&body=${encodeURIComponent(`Delivery record ${delivery.providerDeliveryId ?? delivery.id}`)}`, "_blank", "noopener,noreferrer")}><Mail size={15} aria-hidden="true" /></button>
              <button type="button" aria-label={`Refresh ${delivery.credentialName}`} title="Refresh" onClick={() => void rowAction(delivery, "refresh")}><RefreshCcw size={15} aria-hidden="true" /></button>
              <button type="button" aria-label={`Retry ${delivery.credentialName}`} title="Retry" onClick={() => void rowAction(delivery, "retry")}><RotateCcw size={15} aria-hidden="true" /></button>
              <button type="button" aria-label={`Revoke ${delivery.credentialName}`} title="Revoke" disabled={delivery.status === "revoked"} onClick={() => void rowAction(delivery, "revoke")}><Trash2 size={15} aria-hidden="true" /></button>
            </div>
          </div>
        ))}
        {visibleDeliveries.length === 0 && <EmptyState text="No deliveries match this status filter." />}
      </div>
    </div>
  );
}

function CopyFeedbackButton({
  value,
  label,
  copiedLabel = "Link copied",
  onCopy,
  onCopied,
  disabled = false
}: {
  value: string;
  label: string;
  copiedLabel?: string;
  onCopy?: (value: string) => Promise<void>;
  onCopied?: () => void;
  disabled?: boolean;
}) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");

  async function handleCopy() {
    setState("idle");
    try {
      await (onCopy ?? copyTextToClipboard)(value);
      setState("copied");
      onCopied?.();
    } catch {
      setState("error");
    }
  }

  const Icon = state === "copied" ? CheckCircle2 : Copy;
  return (
    <span className="copyFeedback">
      <button type="button" disabled={disabled || !value} className={state === "copied" ? "copySuccess" : undefined} onClick={() => void handleCopy()}>
        <Icon size={15} aria-hidden="true" /> {state === "copied" ? copiedLabel : label}
      </button>
      {state === "copied" ? <small className="copyFeedbackStatus" role="status" aria-live="polite">Link copied to clipboard.</small> : null}
      {state === "error" ? <small className="copyFeedbackError" role="alert">Copy was blocked. Try again or copy the link manually.</small> : null}
    </span>
  );
}

function BulkHandoffResults({
  results,
  personName,
  method,
  onCopy
}: {
  results: BulkDeliveryItemResult[];
  personName: (id?: string) => string;
  method: "copy" | "whatsapp" | "email";
  onCopy: (url: string) => Promise<void>;
}) {
  const [handoffStatus, setHandoffStatus] = useState<Record<string, string>>({});

  async function openDraft(result: BulkDeliveryItemResult) {
    const delivery = result.delivery;
    if (!delivery?.oneTimeDeliveryUrl) return;
    try {
      await onCopy(delivery.oneTimeDeliveryUrl);
    } catch {
      setHandoffStatus((current) => ({ ...current, [resultKey(result)]: "Copy failed; draft not opened" }));
      return;
    }
    if (method === "email") {
      window.open(
        `mailto:?subject=${encodeURIComponent(`WardSen delivery: ${delivery.credentialName}`)}&body=${encodeURIComponent("Paste the WardSen delivery link copied to your clipboard. Do not forward this message after the recipient opens it.")}`,
        "_blank",
        "noopener,noreferrer"
      );
      setHandoffStatus((current) => ({ ...current, [resultKey(result)]: "Link copied; email draft opened" }));
      return;
    }
    if (method === "whatsapp") {
      window.open("https://wa.me/", "_blank", "noopener,noreferrer");
      setHandoffStatus((current) => ({ ...current, [resultKey(result)]: "Link copied; WhatsApp opened" }));
    }
  }

  return (
    <section className="bulkHandoff">
      <div className="riskSummary">
        <strong>Bulk handoff links</strong>
        <span>These links are kept only for this WardSen session. Closing or refreshing this screen may make unhanded links unavailable.</span>
      </div>
      <div className="table">
        <div className="tableHead handoff">
          <span>Person</span><span>Creation</span><span>Handoff</span><span>Action</span>
        </div>
        {results.map((result) => {
          const key = resultKey(result);
          const url = result.delivery?.oneTimeDeliveryUrl;
          return (
            <div className="tableRow handoff" key={key}>
              <strong>{personName(result.recipientId)}</strong>
              <Status value={result.ok ? "Created" : "Failed"} />
              <span>{handoffStatus[key] ?? (result.ok ? "Not handed off" : result.error ?? "Failed")}</span>
              <div className="buttonRow">
                <CopyFeedbackButton
                  value={url ?? ""}
                  label="Copy link"
                  onCopy={onCopy}
                  disabled={!url}
                  onCopied={() => setHandoffStatus((current) => ({ ...current, [key]: "Link copied" }))}
                />
                <button type="button" disabled={!url || method === "copy"} onClick={() => void openDraft(result)}><Mail size={15} aria-hidden="true" /> Copy and open</button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function BatchTable({
  api,
  selectedBatchId,
  onSelectBatch
}: {
  api: ReturnType<typeof useWardSenApi>;
  selectedBatchId?: string;
  onSelectBatch: (batchId: string) => void | Promise<void>;
}) {
  if (api.batches.length === 0) return <EmptyState text="No bulk batches yet. Create one from the credential delivery form." />;
  return (
    <div className="table">
      <div className="tableHead batch">
        <span>Batch</span><span>Requested</span><span>Completed</span><span>Failed</span><span>Status</span><span>Created</span><span>Actions</span>
      </div>
      {api.batches.map((batch) => (
        <div className={selectedBatchId === batch.id ? "tableRow batch selected" : "tableRow batch"} key={batch.id}>
          <strong>{batch.id}</strong>
          <span>{batch.requestedCount}</span>
          <span>{batch.completedCount}</span>
          <span>{batch.failedCount}</span>
          <Status value={batch.cancelled ? "Cancelled" : batch.completedAt ? "Complete" : "Queued"} />
          <span>{formatDate(batch.createdAt)}</span>
          <div className="actions">
            <button type="button" aria-label={`View deliveries for batch ${batch.id}`} title="View batch deliveries" onClick={() => void onSelectBatch(batch.id)}><Search size={15} aria-hidden="true" /></button>
            <button type="button" aria-label={`Copy batch ID ${batch.id}`} title="Copy batch ID" onClick={() => navigator.clipboard?.writeText(batch.id)}><Copy size={15} aria-hidden="true" /></button>
            <button type="button" aria-label={`Cancel batch ${batch.id}`} title="Cancel batch" disabled={batch.cancelled || Boolean(batch.completedAt)} onClick={() => void confirmDestructiveAction(`CANCEL BATCH ${batch.id}`, `Cancel batch ${batch.id}? Any queued work for this batch will stop.`).then((confirmed) => {
              if (confirmed) void api.action(`/api/batches/${batch.id}/cancel`, { body: JSON.stringify({ confirm: `CANCEL BATCH ${batch.id}` }) });
            })}><Trash2 size={15} aria-hidden="true" /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

function resultKey(result: BulkDeliveryItemResult): string {
  return result.recipientId ?? result.delivery?.id ?? result.error ?? "bulk-result";
}

function attributionLabel(delivery: DeliveryRecord, personName: (id?: string) => string): string {
  const label = delivery.personId ? `${personName(delivery.personId)}'s link` : "Shared link";
  if ((delivery.accessCount ?? 0) > 0 || delivery.status === "viewed" || delivery.status === "limit_reached") {
    return `${label} was viewed`;
  }
  if (delivery.status === "revoked") return `${label} was revoked`;
  if (delivery.status === "expired") return `${label} expired`;
  return `${label} has no observed access`;
}

function accessLabel(delivery: DeliveryRecord): string {
  const count = delivery.accessCount ?? 0;
  return delivery.viewLimit ? `${count} / ${delivery.viewLimit}` : String(count);
}

function firstObservedLabel(delivery: DeliveryRecord): string {
  if ((delivery.accessCount ?? 0) <= 0 && delivery.status !== "viewed" && delivery.status !== "limit_reached") return "No access observed";
  return delivery.lastCheckedAt ? formatDate(delivery.lastCheckedAt) : "Before last sync";
}

function leakSignal(delivery: DeliveryRecord): { label: string; detail: string; level: "low" | "watch" | "high" } {
  const accessCount = delivery.accessCount ?? 0;
  if (delivery.status === "limit_reached" || (delivery.viewLimit !== undefined && accessCount > delivery.viewLimit)) {
    return {
      label: "Unexpected access",
      detail: "Provider access count reached or exceeded the intended limit. Revoke this link and issue a replacement if the recipient still needs access.",
      level: "high"
    };
  }
  if (accessCount > 1 && (delivery.viewLimit ?? 1) <= 1) {
    return {
      label: "Unexpected access",
      detail: "This per-recipient link shows more opens than expected. Treat it as a leak signal, not proof of which person or device opened it.",
      level: "high"
    };
  }
  if (accessCount > 0 || delivery.status === "viewed") {
    return {
      label: "Low",
      detail: "A provider link assigned to this recipient was accessed. WardSen does not claim the named person or a specific device opened it.",
      level: "low"
    };
  }
  if (!delivery.lastCheckedAt && delivery.status === "active") {
    return {
      label: "Needs check",
      detail: "Refresh provider status to see whether this assigned link has been accessed, expired, limited or revoked.",
      level: "watch"
    };
  }
  return {
    label: titleStatus(delivery.status),
    detail: "No unexpected provider access signal is visible from the current status fields.",
    level: "watch"
  };
}

function leakSignalRank(delivery: DeliveryRecord): number {
  const signal = leakSignal(delivery);
  if (signal.level === "high") return 3;
  if (signal.level === "watch") return 2;
  return 1;
}

function BatchDeliveryTable({ deliveries, people }: { deliveries: DeliveryRecord[]; people: PersonRecord[] }) {
  const personName = (id?: string) => people.find((person) => person.id === id)?.name ?? "Shared link";
  if (deliveries.length === 0) return <EmptyState text="This batch has no delivery rows yet." />;
  return (
    <div className="table">
      <div className="tableHead batchDeliveries">
        <span>Credential</span><span>Person</span><span>Status</span><span>Access</span><span>Expiry</span><span>Provider ID</span>
      </div>
      {deliveries.map((delivery) => (
        <div className="tableRow batchDeliveries" key={delivery.id}>
          <strong>{delivery.credentialName}</strong>
          <span>{personName(delivery.personId)}</span>
          <Status value={titleStatus(delivery.status)} />
          <span>{delivery.accessCount ?? 0}{delivery.viewLimit ? ` / ${delivery.viewLimit}` : ""}</span>
          <span>{formatDate(delivery.expiresAt)}</span>
          <span>{delivery.providerDeliveryId ?? delivery.id}</span>
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <section className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{detail}</p>
    </section>
  );
}

function PanelTitle({ icon: Icon, title, action, onAction }: { icon: React.ElementType; title: string; action: string; onAction?: () => void }) {
  return (
    <div className="panelTitle">
      <h2><Icon size={18} aria-hidden="true" /> {title}</h2>
      <button type="button" onClick={onAction}>{action}</button>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

function ErrorNotice({ message, compact = false, actionLabel, onAction }: { message?: string; compact?: boolean; actionLabel?: string; onAction?: () => void }) {
  const help = describeError(message);
  const [dismissed, setDismissed] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>();
  const [copyStatus, setCopyStatus] = useState<string | undefined>();
  const externalAction = help.actionLabel && help.actionHref ? { label: help.actionLabel, href: help.actionHref } : undefined;
  const terminalCommand = selectTerminalCommand(help.terminalCommands);
  useEffect(() => {
    setDismissed(false);
  }, [message]);
  if (dismissed) {
    return null;
  }
  return (
    <div className={compact ? "notice error compact errorHelp" : "notice error errorHelp"} role="alert">
      <button
        type="button"
        className="noticeClose"
        aria-label="Close error message"
        title="Close"
        onClick={() => setDismissed(true)}
      ><X size={16} aria-hidden="true" /></button>
      <strong>{help.title}</strong>
      <span>{help.detail}</span>
      <small>{help.guidance}</small>
      {help.technicalDetail ? (
        <details className="technicalDetail">
          <summary>Show technical detail</summary>
          <code>{help.technicalDetail}</code>
        </details>
      ) : null}
      {help.setupNotes?.length ? (
        <ul className="setupChecklist" aria-label="Setup checklist">
          {help.setupNotes.map((note) => <li key={note}>{note}</li>)}
        </ul>
      ) : null}
      {externalAction ? (
        <div className="noticeActions">
          <button type="button" className="noticeActionLink" onClick={() => {
            setActionError(undefined);
            void openExternalUrl(externalAction.href).catch((error: unknown) => {
              const detail = error instanceof Error ? error.message : String(error);
              setActionError(`Could not open the install page automatically. Copy this link into another browser: ${externalAction.href}. Detail: ${detail}`);
            });
          }}>{externalAction.label}</button>
          <button type="button" className="noticeActionLink secondary" onClick={() => {
            setCopyStatus(undefined);
            void copyExternalUrl(externalAction.href)
              .then(() => setCopyStatus("Install link copied. Paste it into another browser if Edge closes unexpectedly."))
              .catch((error: unknown) => {
                const detail = error instanceof Error ? error.message : String(error);
                setCopyStatus(`Copy was blocked. Manually copy this link: ${externalAction.href}. Detail: ${detail}`);
              });
          }}><Copy size={15} aria-hidden="true" /> Copy install link</button>
        </div>
      ) : null}
      {terminalCommand ? (
        <div className="terminalHelp">
          <span>Terminal option: {terminalCommand.label}</span>
          <code>{terminalCommand.command}</code>
          <small>{terminalCommand.note}</small>
          <button type="button" className="noticeActionLink secondary" onClick={() => {
            setCopyStatus(undefined);
            void copyTextToClipboard(terminalCommand.command)
              .then(() => setCopyStatus(help.kind === "bitwardenTerminalLogin"
                ? "Terminal command copied. Paste it into Terminal or PowerShell, run it, then return to WardSen and select Unlock from terminal session."
                : "Terminal command copied. Paste it into Terminal, PowerShell or Command Prompt, run it, then close and reopen WardSen."))
              .catch((error: unknown) => {
                const detail = error instanceof Error ? error.message : String(error);
                setCopyStatus(`Copy was blocked. Manually copy this command: ${terminalCommand.command}. Detail: ${detail}`);
              });
          }}><Copy size={15} aria-hidden="true" /> Copy terminal command</button>
        </div>
      ) : null}
      {actionError ? <small>{actionError}</small> : null}
      {copyStatus ? <small>{copyStatus}</small> : null}
      {actionLabel && onAction ? <button type="button" onClick={onAction}>{actionLabel}</button> : null}
    </div>
  );
}

function selectTerminalCommand(commands?: Array<{ label: string; command: string; note: string }>) {
  if (!commands?.length) return undefined;
  if (typeof navigator === "undefined") return commands[0];
  const platform = `${navigator.platform} ${navigator.userAgent}`.toLowerCase();
  if (platform.includes("mac")) return commands.find((command) => command.label.toLowerCase().includes("mac")) ?? commands[0];
  if (platform.includes("win")) return commands.find((command) => command.label.toLowerCase().includes("windows")) ?? commands[0];
  return commands[0];
}

function Status({ value }: { value: string }) {
  return <span className={`status ${value.toLowerCase().replaceAll(" ", "-")}`}>{value}</span>;
}

function titleStatus(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function confirmDestructiveAction(_phrase: string, message: string): Promise<boolean> {
  return window.confirm(`${message}\n\nWardSen will ask the local service to confirm this action.`);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function formatLocalServiceStatus(status: LocalServiceStatus) {
  const lines = [
    `Process: ${status.running ? "running" : "not running"}`,
    `Port 4777: ${status.portOpen ? "open" : "not reachable"}`,
    `Bundled Node runtime: ${status.nodeRuntimeFound ? "found" : "missing"}`,
    `Server bundle: ${status.serverBundleFound ? "found" : "missing"}`
  ];
  if (status.lastExit) lines.push(`Last exit: ${status.lastExit}`);
  if (status.lastError) lines.push(`Last launch error: ${status.lastError}`);
  if (status.lastOutput) lines.push(`Recent service output: ${summarizeLocalServiceOutput(status.lastOutput)}`);
  return lines.join("\n");
}

function summarizeLocalServiceOutput(output: string) {
  const compact = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-6)
    .join(" ");
  if (!compact) return "none";
  if (compact.includes('"statusCode":401') || compact.includes("desktop API token")) {
    return "request log shows rejected desktop-session API calls; close all WardSen windows and reopen the app.";
  }
  return compact.length > 220 ? `${compact.slice(0, 217)}...` : compact;
}

function accountLabel(accounts: AccountRecord[], accountId: string) {
  return accounts.find((account) => account.id === accountId)?.label ?? accountId;
}

function formatCredentialSearchIssues(
  api: ReturnType<typeof useWardSenApi>,
  errors: Array<{ accountId: string; providerId: string; safeMessage: string }>
) {
  return errors
    .map((error) => `${accountLabel(api.accounts, error.accountId)} (${providerLabel(api.credentialProviders, error.providerId)}): ${error.safeMessage}`)
    .join("\n");
}

function employeeLabel(employees: EmployeeRecord[], employeeId: string) {
  const employee = employees.find((candidate) => candidate.id === employeeId);
  return employee ? employee.name : employeeId;
}

function catalogEntryAllowsEmployee(entry: CredentialCatalogEntry, employee?: EmployeeRecord): boolean {
  if (!employee) return false;
  const team = employee.team?.trim().toLowerCase();
  const role = employee.role?.trim().toLowerCase();
  return entry.allowedEmployeeIds.includes(employee.id)
    || Boolean(team && entry.allowedTeams.some((candidate) => candidate.trim().toLowerCase() === team))
    || Boolean(role && entry.allowedRoles.some((candidate) => candidate.trim().toLowerCase() === role));
}

function normalizeAccessRequestResponse(response: CredentialAccessRequestCreateResponse): { request: CredentialAccessRequestRecord; delivery?: CreatedDeliveryRecord; autoApproved?: boolean } {
  if ("request" in response) return response;
  return { request: response, autoApproved: response.status === "approved" };
}

function employeeSessionHeaders(sessionToken: string): HeadersInit {
  return { "x-wardsen-employee-session": sessionToken };
}

function employeeSignInMailtoHref(draft: { to: string; subject: string }): string {
  return `mailto:${encodeURIComponent(draft.to)}?subject=${encodeURIComponent(draft.subject)}`;
}

function providerLabel(providers: ProviderInfo[], providerId: string) {
  return providers.find((provider) => provider.id === providerId)?.displayName ?? providerId;
}

function newOperationId(prefix: "delivery" | "bulk"): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

function buildBulkRiskSummary(input: {
  credentialTitle: string;
  sourceVault: string;
  deliveryProvider: string;
  recipientCount: number;
  linkMode: string;
  expiry: string;
  viewLimit: string;
}) {
  return [
    `Credential: ${input.credentialTitle}`,
    `Source vault: ${input.sourceVault}`,
    `Delivery provider: ${input.deliveryProvider}`,
    `Recipients: ${input.recipientCount}`,
    `Link mode: ${input.linkMode}`,
    `Expiry: ${input.expiry}`,
    `View limit: ${input.viewLimit}`
  ].join("\n");
}

createRoot(document.getElementById("root")!).render(<App />);
