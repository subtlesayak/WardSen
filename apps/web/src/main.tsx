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
  Pencil,
  RefreshCcw,
  RotateCcw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Terminal,
  Trash2,
  UsersRound,
  Vault,
  X
} from "lucide-react";
import { parseBatchDeliveryRevokeResult, parseBulkDeliveryResult, parseCreatedDeliveryRecord, parseCredentialAccessRequestList, parseCredentialCatalogList, parseDeliveryList, parseDeliveryRecord, parseEmployeeList, parseTerminalSessionHandoffResponse, type BulkDeliveryItemResultContract, type BulkDeliveryResultContract, type CreatedDeliveryRecordContract, type DeliveryRecordContract } from "@wardsen/contracts";
import { apiDownload, apiGet, apiSend, canLaunchTerminalSession, canRestartLocalService, copyExternalUrl, copyTextToClipboard, getLocalServiceStatus, openExternalUrl, openMailDraft, openTerminalSession, restartLocalService, type LocalServiceStatus } from "./api";
import { describeError } from "./errorHelp";
import { DeliveryAuditPanel } from "./deliveryAuditPanel";
import { BatchDeliveryTable, BatchTable } from "./deliveryBatchTables";
import { DeliveryHistoryTable, type DeliveryHistoryAction } from "./deliveryHistoryTable";
import { EmployeePortalPage, isEmployeePortalView } from "./employeePortal";
import { credentialSelectionKey, orderSelectedCredentialsFirst } from "./credentialSelection";

import { appReleaseMetadata, appVersion } from "./version";
import "./styles.css";

type NavItem = "Overview" | "Vaults" | "Credentials" | "People" | "Requests" | "Deliveries" | "Settings";
type LoadState = "loading" | "ready" | "error";

interface ProviderInfo {
  id: string;
  displayName: string;
  kind?: string;
  maturity?: string;
  enabled?: boolean;
  enabledByDefault?: boolean;
  requiresExplicitOptIn?: boolean;
  optInWarning?: string;
  documentationUrl?: string;
  notes?: string;
  setupInstructions?: string[];
  capabilities?: Record<string, boolean>;
  delivery?: DeliveryReadiness;
}

interface ProviderDiagnostic {
  providerId: string;
  displayName: string;
  kind: string;
  runtime: { kind: string; binaryFound: boolean; version: string; detail: string };
  authentication: { state: string; detail: string };
  accounts: Array<{ id: string; label: string; status: string }>;
  capabilities: Record<string, boolean>;
  linkPreviewRisk: string;
}

interface OperationImpactPreview {
  action: string;
  impact: {
    affectedPeople: string[];
    resources: string[];
    providers: string[];
    deliveryCount: number;
    activeDeliveryCount: number;
    batch?: { id: string; requestedCount: number; completedCount: number; failedCount: number; cancelled: boolean };
  };
}

interface DeliveryReadiness {
  integrationSurface: string;
  secureLinkCreation: string;
  revoke: string;
  statusLookup: string;
  accessCount: string;
  viewerIdentity: string;
  promotionBlockedBy: string[];
}

interface AccountRecord {
  id: string;
  providerId: string;
  label: string;
  username?: string;
  serverUrl?: string;
  status: string;
  autoLockMinutes: number;
  lastActivity?: string;
  updatedAt: string;
}

interface PersonRecord {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  groupName?: string;
  role?: string;
  notes?: string;
  active: boolean;
}

type DeliveryRecord = DeliveryRecordContract;

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

type CreatedDeliveryRecord = CreatedDeliveryRecordContract;
type BulkDeliveryResult = BulkDeliveryResultContract;
type BulkDeliveryItemResult = BulkDeliveryItemResultContract;
interface MultiCredentialDeliveryResult {
  credential: CredentialSummary;
  delivery?: CreatedDeliveryRecord;
  error?: string;
}
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

type CredentialPageSize = 10 | 20 | 30 | "all";

interface CredentialSearchState {
  status: LoadState | "idle";
  query: string;
  providerId: string;
  accountId: string;
  page: number;
  pageSize: CredentialPageSize;
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
  optionalDeliveryProviders: ProviderInfo[];
  plannedProviders: ProviderInfo[];
  accounts: AccountRecord[];
  people: PersonRecord[];
  employees: EmployeeRecord[];
  catalogEntries: CredentialCatalogEntry[];
  credentialRequests: CredentialAccessRequestRecord[];
  deliveries: DeliveryRecord[];
  batches: DeliveryBatchRecord[];
}

type DestructiveConfirmation = (phrase: string, message: string) => Promise<boolean>;

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
  if (isEmployeePortalView()) return <EmployeePortalPage />;
  const [active, setActive] = useState<NavItem>("Overview");
  const api = useWardSenApi();
  const destructiveConfirmation = useDestructiveConfirmation();
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
        {active === "Overview" && <Overview api={api} confirmDestructiveAction={destructiveConfirmation.confirm} />}
        {active === "Vaults" && <Vaults api={api} confirmDestructiveAction={destructiveConfirmation.confirm} />}
        {active === "Credentials" && <Credentials api={api} />}
        {active === "People" && <People api={api} confirmDestructiveAction={destructiveConfirmation.confirm} />}
        {active === "Requests" && <RequestsView api={api} />}
        {active === "Deliveries" && <Deliveries api={api} confirmDestructiveAction={destructiveConfirmation.confirm} />}
        {active === "Settings" && <SettingsView credentialProviders={api.credentialProviders} deliveryProviders={api.deliveryProviders} optionalDeliveryProviders={api.optionalDeliveryProviders} plannedProviders={api.plannedProviders} onRefresh={api.refresh} confirmAction={destructiveConfirmation.confirm} />}
      </main>
      {destructiveConfirmation.dialog}
    </div>
  );
}

function useWardSenApi() {
  const [state, setState] = useState<ApiState>({
    status: "loading",
    credentialProviders: [],
    deliveryProviders: [],
    optionalDeliveryProviders: [],
    plannedProviders: [],
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
        apiGet<{ credentialProviders: ProviderInfo[]; deliveryProviders: ProviderInfo[]; optionalDeliveryProviders: ProviderInfo[]; plannedProviders: ProviderInfo[] }>("/api/providers"),
        apiGet<AccountRecord[]>("/api/accounts"),
        apiGet<{ items: PersonRecord[] }>("/api/people?page=1&pageSize=50"),
        apiGet<{ items: EmployeeRecord[] }>("/api/employees?page=1&pageSize=100"),
        apiGet<{ items: CredentialCatalogEntry[] }>("/api/credential-catalog?page=1&pageSize=100"),
        apiGet<{ items: CredentialAccessRequestRecord[] }>("/api/credential-requests?page=1&pageSize=100"),
        apiGet<unknown>("/api/deliveries?page=1&pageSize=50"),
        apiGet<{ items: DeliveryBatchRecord[] }>("/api/batches?page=1&pageSize=10")
      ]);
      const parsedEmployees = parseEmployeeList(employees);
      const parsedCatalogEntries = parseCredentialCatalogList(catalogEntries);
      const parsedCredentialRequests = parseCredentialAccessRequestList(credentialRequests);
      setState({
        status: "ready",
        credentialProviders: providers.credentialProviders,
        deliveryProviders: providers.deliveryProviders,
        optionalDeliveryProviders: providers.optionalDeliveryProviders,
        plannedProviders: providers.plannedProviders,
        accounts,
        people: people.items,
        employees: parsedEmployees.items,
        catalogEntries: parsedCatalogEntries.items,
        credentialRequests: parsedCredentialRequests.items,
        deliveries: parseDeliveryList(deliveries).items,
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

function Overview({ api, confirmDestructiveAction }: { api: ReturnType<typeof useWardSenApi>; confirmDestructiveAction: DestructiveConfirmation }) {
  const activeDeliveries = api.deliveries.filter((delivery) => delivery.status === "active").length;
  const failedDeliveries = api.deliveries.filter((delivery) => delivery.status === "failed").length;
  const statusRefreshBlockedAccountLabels = blockedLiveStatusRefreshAccountLabels(api.deliveries, api.accounts);
  return (
    <div className="grid two">
      <Metric label="Connected vaults" value={String(api.accounts.length)} detail={`${api.credentialProviders.length} provider adapters`} />
      <Metric label="Active deliveries" value={String(activeDeliveries)} detail={`${api.deliveries.length} total records`} />
      <Metric label="Failed deliveries" value={String(failedDeliveries)} detail="Retry from delivery history" />
      <Metric label="People" value={String(api.people.length)} detail="Server-side paginated" />
      <LiveStatusUnlockNotice accountLabels={statusRefreshBlockedAccountLabels} wide />
      <section className="panel wide">
        <PanelTitle icon={Database} title="Recent Dispatch Activity" action="Reload history" onAction={api.refresh} />
        <DeliveryTable api={api} confirmDestructiveAction={confirmDestructiveAction} />
      </section>
    </div>
  );
}

function Vaults({ api, confirmDestructiveAction }: { api: ReturnType<typeof useWardSenApi>; confirmDestructiveAction: DestructiveConfirmation }) {
  const [accountForm, setAccountForm] = useState({
    providerId: "",
    label: "",
    username: "",
    serverUrl: "",
    autoLockMinutes: "10"
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
  const [terminalHandoff, setTerminalHandoff] = useState<{ accountId: string; command: string; launchId: string; expiresAt: string }>();
  const [terminalLaunchStartedAt, setTerminalLaunchStartedAt] = useState<number>();
  const verificationCodeRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ status: "idle" | "loading" | "ready" | "error"; text?: string }>({ status: "idle" });
  const [clockMs, setClockMs] = useState(() => Date.now());
  const providerLabel = (id: string) => api.credentialProviders.find((provider) => provider.id === id)?.displayName ?? id;
  const selectedAccount = api.accounts.find((account) => account.id === accessForm.accountId) ?? api.accounts[0];
  const providerId = accountForm.providerId || api.credentialProviders[0]?.id || "bitwarden";
  const selectedAccountIsBitwarden = selectedAccount?.providerId === "bitwarden";
  const selectedAccountIsKeePassXC = selectedAccount?.providerId === "keepassxc";
  const terminalLaunchWaiting = terminalHandoff?.accountId === selectedAccount?.id && terminalLaunchStartedAt !== undefined;
  const terminalLaunchElapsed = terminalLaunchWaiting ? Math.max(0, Math.floor((clockMs - terminalLaunchStartedAt) / 1000)) : 0;

  useEffect(() => {
    if (verificationNeeded) verificationCodeRef.current?.focus();
  }, [verificationNeeded]);

  useEffect(() => {
    const timer = window.setInterval(() => setClockMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!terminalHandoff || terminalHandoff.accountId !== selectedAccount?.id) return;
    let cancelled = false;
    const checkStatus = async () => {
      if (Date.now() >= Date.parse(terminalHandoff.expiresAt)) {
        if (!cancelled) {
          setTerminalHandoff(undefined);
          setTerminalLaunchStartedAt(undefined);
          setMessage({ status: "error", text: "The Terminal login command expired before WardSen received a session. Start Terminal login / unlock again." });
        }
        return;
      }
      try {
        const result = await apiGet<{ ok: boolean; status: string }>(`/api/accounts/${terminalHandoff.accountId}/status`);
        if (!cancelled && result.ok && result.status === "unlocked") {
          setTerminalHandoff(undefined);
          setTerminalLaunchStartedAt(undefined);
          setMessage({ status: "ready", text: `${selectedAccount.label} unlocked from the terminal session.` });
          void api.refresh();
        }
      } catch {
        // The regular account-status action presents recoverable errors; this short poll stays quiet.
      }
    };
    void checkStatus();
    const timer = window.setInterval(() => void checkStatus(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selectedAccount?.id, terminalHandoff]);

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
          autoLockMinutes: Number(accountForm.autoLockMinutes) || 10
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

  async function accountAccess(action: "login" | "unlock") {
    const account = selectedAccount;
    if (!account) {
      setMessage({ status: "error", text: "Create or select an account first." });
      return;
    }
    if (action === "login" && account.providerId === "bitwarden") {
      await beginBitwardenTerminalLogin(account);
      return;
    }
    setMessage({ status: "loading", text: `${titleStatus(action)} running for ${account.label}...` });
    try {
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

  async function beginBitwardenTerminalLogin(account: AccountRecord) {
    setMessage({ status: "loading", text: `Preparing a one-time Terminal login command for ${account.label}...` });
    try {
      const response = parseTerminalSessionHandoffResponse(await apiSend(`/api/accounts/${account.id}/terminal-handoff`, {
        body: JSON.stringify({ username: account.username, serverUrl: account.serverUrl, sso: accessForm.sso })
      }));
      setVerificationNeeded(false);
      setTerminalHandoff({ accountId: account.id, ...response });
      if (canLaunchTerminalSession()) {
        try {
          setTerminalLaunchStartedAt(Date.now());
          setMessage({ status: "loading", text: "Opening Terminal. Wait for the Bitwarden password prompt..." });
          await openTerminalSession(account.id, response.launchId);
          setMessage({ status: "ready", text: "Terminal launch requested. Wait for the Bitwarden password prompt; WardSen will update this account automatically." });
          return;
        } catch (error) {
          setTerminalLaunchStartedAt(undefined);
          try {
            await copyTextToClipboard(response.command);
            setMessage({ status: "error", text: `WardSen could not open Terminal. The command was copied so you can run it manually. Detail: ${error instanceof Error ? error.message : String(error)}` });
          } catch {
            setMessage({ status: "error", text: `WardSen could not open Terminal. Copy the command below and run it manually. Detail: ${error instanceof Error ? error.message : String(error)}` });
          }
          return;
        }
      }
      try {
        await copyTextToClipboard(response.command);
        setMessage({ status: "ready", text: "Terminal command copied. Paste and run it in Terminal or PowerShell, then type the Bitwarden password only in the Bitwarden prompt. WardSen will update this account automatically." });
      } catch {
        setMessage({ status: "ready", text: "Terminal command is ready below. Copy, paste and run it in Terminal or PowerShell, then type the Bitwarden password only in the Bitwarden prompt." });
      }
    } catch (error) {
      setMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function openBitwardenTerminalAgain(handoff: NonNullable<typeof terminalHandoff>) {
    setTerminalLaunchStartedAt(Date.now());
    setMessage({ status: "loading", text: "Opening Terminal. Wait for the Bitwarden password prompt..." });
    try {
      await openTerminalSession(handoff.accountId, handoff.launchId);
      setMessage({ status: "ready", text: "Terminal launch requested. Wait for the Bitwarden password prompt." });
    } catch (error) {
      setTerminalLaunchStartedAt(undefined);
      setMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  function selectVault(vault: AccountRecord) {
    setVerificationNeeded(false);
    setTerminalHandoff(undefined);
    setTerminalLaunchStartedAt(undefined);
    setAccessForm((current) => ({ ...current, accountId: vault.id, verificationCode: "" }));
    setMessage({ status: "ready", text: `${vault.label} selected for account access.` });
  }

  async function syncVault(vault: AccountRecord) {
    setMessage({ status: "loading", text: `Sync running for ${vault.label}...` });
    try {
      await api.action(`/api/accounts/${vault.id}/sync`);
      setMessage({ status: "ready", text: `${vault.label} synced.` });
    } catch (error) {
      setMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function lockVault(vault: AccountRecord) {
    setMessage({ status: "loading", text: `Lock running for ${vault.label}...` });
    try {
      await api.action(`/api/accounts/${vault.id}/lock`);
      setMessage({ status: "ready", text: `${vault.label} locked.` });
    } catch (error) {
      await api.refresh();
      setMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function deleteVault(vault: AccountRecord) {
    const confirm = `DELETE ACCOUNT ${vault.id}`;
    let confirmed: boolean;
    try {
      confirmed = await confirmDestructivePreview(confirmDestructiveAction, confirm, `/api/accounts/${encodeURIComponent(vault.id)}/operation-preview`, `Delete vault account "${vault.label}"? This removes local account metadata.`);
    } catch (error) {
      setMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (!confirmed) {
      setMessage({ status: "idle" });
      return;
    }
    setMessage({ status: "loading", text: `Deleting ${vault.label}...` });
    try {
      await api.action(`/api/accounts/${vault.id}`, { method: "DELETE", body: JSON.stringify({ confirm }) });
      setAccessForm((current) => ({ ...current, accountId: current.accountId === vault.id ? "" : current.accountId }));
      setMessage({ status: "ready", text: `${vault.label} deleted.` });
    } catch (error) {
      setMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <div className="grid">
      {message.status === "error" && <ErrorNotice message={message.text} />}
      {message.status !== "idle" && message.status !== "error" && <div className="notice" role="status" aria-live="polite">{message.text}</div>}
      <form className="panel formGrid vaultAccountForm" onSubmit={createAccount}>
        <PanelTitle icon={Vault} title="Add Vault Account" />
        <div className="vaultProviderBlock wide">
          <label>Provider<select name="providerId" value={providerId} onChange={(event) => setAccountForm((current) => ({ ...current, providerId: event.target.value }))}>
            {api.credentialProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.displayName}</option>)}
          </select></label>
          <small className="fieldInstruction">Only active, verified adapters are selectable. Check Settings &gt; Provider Capabilities for planned and experimental providers, their requirements and current limits.</small>
        </div>
        <div className="vaultAccountFields wide">
          <label>Label<input name="label" required value={accountForm.label} onChange={(event) => setAccountForm((current) => ({ ...current, label: event.target.value }))} placeholder="Work Bitwarden" /></label>
          <label>Username<input name="username" autoComplete="username" value={accountForm.username} onChange={(event) => setAccountForm((current) => ({ ...current, username: event.target.value }))} placeholder="name@example.com" /></label>
          <label>Server URL<input name="serverUrl" type="url" value={accountForm.serverUrl} onChange={(event) => setAccountForm((current) => ({ ...current, serverUrl: event.target.value }))} placeholder="Optional custom server" /></label>
          <label>Auto-lock minutes<input name="autoLockMinutes" value={accountForm.autoLockMinutes} onChange={(event) => setAccountForm((current) => ({ ...current, autoLockMinutes: event.target.value }))} inputMode="numeric" /></label>
          <small className="fieldInstruction vaultProfileNote">WardSen creates an isolated provider profile automatically for each account.</small>
        </div>
        <div className="formActions wide">
          <button className="primary"><Vault size={16} aria-hidden="true" /> Add account</button>
        </div>
      </form>
      <section className="panel accountAccessPanel">
        <PanelTitle icon={KeyRound} title="Account Access" />
        {selectedAccountIsBitwarden ? (
          <div className="notice compact">
            <strong>Bitwarden unlock flow</strong>
            <span>Select <strong>Terminal login / unlock</strong>. WardSen opens PowerShell or Terminal in the desktop app; type the Bitwarden password only in Bitwarden's terminal prompt. WardSen unlocks automatically when the one-time handoff succeeds.</span>
          </div>
        ) : null}
        {terminalHandoff && terminalHandoff.accountId === selectedAccount?.id ? (
          <div className="notice compact terminalHandoffNotice" role="status" aria-live="polite">
            <strong>{terminalLaunchWaiting ? "Waiting for Terminal" : "Terminal command ready"}</strong>
            {terminalLaunchWaiting ? <span className="terminalLaunchWaiting">Waiting {formatElapsedSeconds(terminalLaunchElapsed)} for the Bitwarden password prompt. Terminal can take a few seconds to appear. If no prompt is visible after 10 seconds, select Open Terminal again or Copy terminal command.</span> : <span>Expires {formatDate(terminalHandoff.expiresAt)}. The command contains a one-time local handoff authorization, not your Bitwarden password or session token.</span>}
            {canLaunchTerminalSession() ? <button type="button" className="secondary" onClick={() => void openBitwardenTerminalAgain(terminalHandoff)}><Terminal size={16} aria-hidden="true" /> Open Terminal again</button> : null}
            <CopyFeedbackButton value={terminalHandoff.command} label="Copy terminal command" copiedLabel="Terminal command copied" />
          </div>
        ) : null}
        <div className="accountAccessFields">
          <label>Account<select value={selectedAccount?.id ?? ""} onChange={(event) => {
            setVerificationNeeded(false);
            setTerminalHandoff(undefined);
            setTerminalLaunchStartedAt(undefined);
            setAccessForm((current) => ({ ...current, accountId: event.target.value, verificationCode: "" }));
          }}>
            {api.accounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
          </select></label>
          {selectedAccountIsBitwarden ? (
            <div className="providerCredentialNotice">
              <span>Bitwarden master password</span>
              <strong>Enter in Bitwarden's Terminal prompt</strong>
              <small>WardSen never accepts this password. It never stores it.</small>
            </div>
          ) : (
            <label>Password<input value={accessForm.password} onChange={(event) => setAccessForm((current) => ({ ...current, password: event.target.value }))} placeholder="Master password or database password" type="password" /></label>
          )}
          {selectedAccountIsKeePassXC ? <>
            <label>Database path<input name="databasePath" value={accessForm.databasePath} onChange={(event) => setAccessForm((current) => ({ ...current, databasePath: event.target.value }))} placeholder="KeePassXC .kdbx path" /></label>
            <label>Key file path<input name="keyFilePath" value={accessForm.keyFilePath} onChange={(event) => setAccessForm((current) => ({ ...current, keyFilePath: event.target.value }))} placeholder="Optional KeePassXC key file" /></label>
          </> : null}
          {selectedAccountIsBitwarden ? <label className="checkboxLine accountAccessOption"><input name="sso" checked={accessForm.sso} type="checkbox" onChange={(event) => setAccessForm((current) => ({ ...current, sso: event.target.checked }))} /> Login with SSO</label> : null}
          {selectedAccountIsBitwarden && verificationNeeded ? (
            <label className="attentionField">Verification code
              <input
                name="verificationCode"
                ref={verificationCodeRef}
                value={accessForm.verificationCode}
                onChange={(event) => setAccessForm((current) => ({ ...current, verificationCode: event.target.value }))}
                placeholder="Email or authenticator code"
                inputMode="numeric"
                autoComplete="one-time-code"
                aria-describedby="bitwarden-verification-help"
                aria-invalid={!accessForm.verificationCode.trim()}
              />
              <small id="bitwarden-verification-help" className="fieldInstruction">Bitwarden is waiting for this code. Keep Email / new-device selected for Bitwarden email codes, then select Submit code and login.</small>
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
        </div>
        <div className="formActions accountAccessActions">
          <button type="button" className={selectedAccountIsBitwarden || verificationNeeded ? "primary" : undefined} onClick={() => void accountAccess("login")}><ShieldCheck size={16} /> {selectedAccountIsBitwarden ? "Terminal login / unlock" : verificationNeeded ? "Submit code and login" : "Login"}</button>
          {!selectedAccountIsBitwarden ? <button type="button" className="primary" onClick={() => void accountAccess("unlock")}><KeyRound size={16} /> Unlock</button> : null}
        </div>
      </section>
      <section className="panel">
        <PanelTitle icon={Vault} title="Vault Accounts" action="Refresh" onAction={api.refresh} />
        {api.accounts.length === 0 ? <EmptyState text="No vault accounts yet. Add one above to begin search and delivery." /> : (
          <div className="rows">
            {api.accounts.map((vault) => (
              <div className="row vaultRow" key={vault.id}>
                <div>
                  <strong>{vault.label}</strong>
                  <span>{providerLabel(vault.providerId)} / {vault.username ?? "No username"}</span>
                </div>
                <span>{vault.serverUrl ?? "Default server"}</span>
                <Status value={titleStatus(vault.status)} />
                <span title="Auto-lock counts down from the account's last activity.">{formatAutoLockCountdown(vault, clockMs)}</span>
                <div className="actions">
                  <button type="button" aria-label={`Select ${vault.label} for account access`} title="Select for account access" onClick={() => selectVault(vault)}><KeyRound size={16} aria-hidden="true" /></button>
                  <button type="button" aria-label={`Sync ${vault.label} from its provider`} title="Sync latest provider changes" onClick={() => void syncVault(vault)}><RefreshCcw size={16} aria-hidden="true" /></button>
                  <button type="button" aria-label={`Lock ${vault.label} and remove its WardSen session`} title="Lock and remove WardSen session" onClick={() => void lockVault(vault)}><Lock size={16} aria-hidden="true" /></button>
                  <button type="button" aria-label={`Delete ${vault.label}`} title="Delete" onClick={() => void deleteVault(vault)}><Trash2 size={16} aria-hidden="true" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function formatAutoLockCountdown(account: AccountRecord, nowMs: number): string {
  if (account.status !== "unlocked") return `${account.autoLockMinutes} min lock`;
  const lastActivityMs = Date.parse(account.lastActivity ?? account.updatedAt);
  if (!Number.isFinite(lastActivityMs)) return `${account.autoLockMinutes} min lock`;
  const remainingSeconds = Math.max(0, Math.ceil((lastActivityMs + account.autoLockMinutes * 60_000 - nowMs) / 1000));
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = String(remainingSeconds % 60).padStart(2, "0");
  return remainingSeconds === 0 ? "Locking..." : `Locks in ${minutes}:${seconds}`;
}

function formatElapsedSeconds(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
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
  const [selectedCredentials, setSelectedCredentials] = useState<CredentialSummary[]>([]);
  const [selectionNotice, setSelectionNotice] = useState<string>();
  const searchableAccounts = api.accounts.filter((account) =>
    account.status === "unlocked" &&
    (!search.accountId || account.id === search.accountId) &&
    (!search.providerId || account.providerId === search.providerId)
  );
  const lockedSelectedAccount = search.accountId ? api.accounts.find((account) => account.id === search.accountId && account.status !== "unlocked") : undefined;
  const orderedSearchItems = useMemo(
    () => orderSelectedCredentialsFirst(search.items, selectedCredentials),
    [search.items, selectedCredentials]
  );

  async function runSearch(event?: React.FormEvent, page = search.page, pageSize = search.pageSize) {
    event?.preventDefault();
    setSearch((current) => ({ ...current, page, pageSize, status: "loading", error: undefined, errors: [] }));
    const params = new URLSearchParams({ q: search.query, page: String(page), pageSize: String(pageSize) });
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
        errors: result.errors
      }));
    } catch (error) {
      setSearch((current) => ({ ...current, status: "error", error: error instanceof Error ? error.message : String(error) }));
    }
  }

  function toggleCredential(item: CredentialSummary) {
    const key = credentialSelectionKey(item);
    const isSelected = selectedCredentials.some((credential) => credentialSelectionKey(credential) === key);
    if (!isSelected && selectedCredentials.length >= 20) {
      setSelectionNotice("Select up to 20 credentials at once. Create this set before selecting more.");
      return;
    }
    setSelectedCredentials((current) => isSelected
      ? current.filter((credential) => credentialSelectionKey(credential) !== key)
      : [...current, item]);
    setSelectionNotice(undefined);
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
          <select aria-label="Credential results per page" value={String(search.pageSize)} onChange={(event) => {
            const pageSize: CredentialPageSize = event.target.value === "all" ? "all" : Number(event.target.value) as Exclude<CredentialPageSize, "all">;
            void runSearch(undefined, 1, pageSize);
          }}>
            <option value="10">10 items</option>
            <option value="20">20 items</option>
            <option value="30">30 items</option>
            <option value="all">All items</option>
          </select>
          <input aria-label="Credential search query" value={search.query} onChange={(event) => setSearch((current) => ({ ...current, query: event.target.value, page: 1 }))} placeholder="Search titles, usernames or domains (fuzzy matching supported)" />
          <button className="primary"><Search size={16} aria-hidden="true" /> Search</button>
        </form>
        {search.status === "error" && <ErrorNotice message={search.error} />}
        {search.errors.length > 0 && <ErrorNotice message={formatCredentialSearchIssues(api, search.errors)} />}
        {search.status === "ready" && (
          <div className="pager" role="status" aria-live="polite">
            <span>{search.total} result{search.total === 1 ? "" : "s"} {search.pageSize === "all" ? "shown" : `on page ${search.page}`}</span>
            {search.pageSize !== "all" ? <div className="buttonRow">
              <button type="button" disabled={search.page <= 1} onClick={() => void runSearch(undefined, search.page - 1)}>Previous</button>
              <button type="button" disabled={search.items.length < search.pageSize} onClick={() => void runSearch(undefined, search.page + 1)}>Next</button>
            </div> : null}
          </div>
        )}
        {selectedCredentials.length > 0 ? (
          <div className="selectionSummary" role="status" aria-live="polite">
            <span>{selectedCredentials.length} credential{selectedCredentials.length === 1 ? "" : "s"} selected. Choose separate links or one bundle link, then confirm the bundle below.</span>
            <button type="button" onClick={() => {
              setSelectedCredentials([]);
              setSelectionNotice(undefined);
            }}>Clear selection</button>
          </div>
        ) : null}
        {selectionNotice ? <div className="notice compact" role="status" aria-live="polite">{selectionNotice}</div> : null}
        <div className="resultList">
          {search.status === "idle" && <EmptyState text="Run a search after unlocking a vault. Credential secrets stay on the backend." />}
          {search.status === "loading" && <EmptyState text="Searching unlocked vaults..." />}
          {search.status === "ready" && search.items.length === 0 && lockedSelectedAccount && <EmptyState text={`Unlock ${lockedSelectedAccount.label} in Vaults > Account Access before searching credentials. For Bitwarden, use Terminal login / unlock and wait for WardSen to update the account automatically.`} />}
          {search.status === "ready" && search.items.length === 0 && !lockedSelectedAccount && searchableAccounts.length === 0 && <EmptyState text="No unlocked vaults match this search filter. Go to Vaults > Account Access, unlock a vault, then search again." />}
          {search.status === "ready" && search.items.length === 0 && !lockedSelectedAccount && searchableAccounts.length > 0 && <EmptyState text="No credential summaries matched this search." />}
          {orderedSearchItems.map((item) => {
            const isSelected = selectedCredentials.some((credential) => credentialSelectionKey(credential) === credentialSelectionKey(item));
            return (
              <label className={isSelected ? "result selected" : "result"} key={credentialSelectionKey(item)}>
                <input
                  type="checkbox"
                  checked={isSelected}
                  aria-label={`Select ${item.title}`}
                  onChange={() => toggleCredential(item)}
                />
                <span>
                  <strong>{item.title}</strong>
                  <span>{item.username ?? "No username"} / {item.domain ?? item.uriPreview ?? "No domain"} / {accountLabel(api.accounts, item.accountId)}</span>
                </span>
              </label>
            );
          })}
        </div>
      </section>
      <DeliveryComposer api={api} selectedCredentials={selectedCredentials} />
    </div>
  );
}

function People({ api, confirmDestructiveAction }: { api: ReturnType<typeof useWardSenApi>; confirmDestructiveAction: DestructiveConfirmation }) {
  const emptyPersonForm = { name: "", phone: "", email: "", groupName: "", role: "", notes: "", active: true };
  const [form, setForm] = useState(emptyPersonForm);
  const [editingPersonId, setEditingPersonId] = useState<string | undefined>();
  const [filters, setFilters] = useState({ search: "", groupName: "", active: "active" });
  const [csv, setCsv] = useState("");
  const [showCsvImport, setShowCsvImport] = useState(false);
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
    const updating = Boolean(editingPersonId);
    setMessage({ status: "loading", text: updating ? "Updating person..." : "Saving person..." });
    try {
      const body = {
        name: form.name,
        phone: form.phone || undefined,
        email: form.email || undefined,
        groupName: form.groupName || undefined,
        role: form.role || undefined,
        notes: form.notes || undefined,
        active: form.active
      };
      if (editingPersonId) {
        const person = await apiSend<PersonRecord>(`/api/people/${editingPersonId}`, { method: "PUT", body: JSON.stringify(body) });
        setMessage({ status: "ready", text: `Updated ${person.name}.` });
      } else {
        const result = await apiSend<{ person: PersonRecord; duplicates: PersonRecord[] }>("/api/people", { body: JSON.stringify(body) });
        setMessage({
          status: "ready",
          text: result.duplicates.length > 0 ? `Saved ${result.person.name}; ${result.duplicates.length} possible duplicate${result.duplicates.length === 1 ? "" : "s"} found.` : `Saved ${result.person.name}.`
        });
      }
      setEditingPersonId(undefined);
      setForm(emptyPersonForm);
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
      setShowCsvImport(false);
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

  function editPerson(person: PersonRecord) {
    setEditingPersonId(person.id);
    setForm({
      name: person.name,
      phone: person.phone ?? "",
      email: person.email ?? "",
      groupName: person.groupName ?? "",
      role: person.role ?? "",
      notes: person.notes ?? "",
      active: person.active
    });
    setMessage({ status: "ready", text: `Editing ${person.name}.` });
  }

  function cancelPersonEdit() {
    setEditingPersonId(undefined);
    setForm(emptyPersonForm);
    setMessage({ status: "idle" });
  }

  return (
    <div className="grid">
      {message.status === "error" && <ErrorNotice message={message.text} />}
      {message.status !== "idle" && message.status !== "error" && <div className="notice" role="status" aria-live="polite">{message.text}</div>}
      <form className="panel formGrid" onSubmit={savePerson}>
        <PanelTitle icon={UsersRound} title={editingPersonId ? "Edit Person" : "Add Person"} />
        <label>Name<input name="name" required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Mira Patel" /></label>
        <label>Phone<input name="phone" type="tel" autoComplete="tel" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="+1..." /></label>
        <label>Email<input name="email" type="email" autoComplete="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder="mira@example.com" /></label>
        <label>Group<input name="groupName" value={form.groupName} onChange={(event) => setForm((current) => ({ ...current, groupName: event.target.value }))} placeholder="Ops" /></label>
        <label>Role<input name="role" value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))} placeholder="Admin" /></label>
        <label className="spanAll">Notes<textarea name="personNotes" value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Optional contact notes" /></label>
        {editingPersonId ? <label className="check spanAll"><input type="checkbox" checked={form.active} onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))} /> Active person</label> : null}
        <div className="buttonRow spanAll">
          <button className="primary"><UsersRound size={16} aria-hidden="true" /> {editingPersonId ? "Update person" : "Save person"}</button>
          {editingPersonId ? <button type="button" onClick={cancelPersonEdit}>Cancel edit</button> : null}
        </div>
      </form>
      <section className="panel">
        <PanelTitle icon={UsersRound} title="People Directory" action="Import CSV" onAction={() => setShowCsvImport((visible) => !visible)} />
        {showCsvImport ? (
          <form className="formGrid csvImport" onSubmit={importPeople}>
            <label className="spanAll">Paste CSV rows<textarea name="peopleCsv" value={csv} onChange={(event) => setCsv(event.target.value)} placeholder="name,email,phone,groupName,role&#10;Mira,mira@example.com,+1,Ops,Admin" /></label>
            <div className="buttonRow spanAll">
              <button className="primary"><Archive size={16} aria-hidden="true" /> Import CSV</button>
              <button type="button" onClick={() => setShowCsvImport(false)}>Cancel</button>
            </div>
          </form>
        ) : null}
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
                  <CopyFeedbackButton value={person.email ?? person.phone ?? person.name} label="Copy" copiedLabel="Copied" copiedStatus="Contact copied to clipboard." />
                  <button type="button" aria-label={`Edit ${person.name}`} title="Edit person" onClick={() => editPerson(person)}><Pencil size={15} aria-hidden="true" /></button>
                  {person.active ? (
                    <button type="button" aria-label={`Offboard ${person.name}`} title="Offboard" onClick={() => void archivePerson(person)}><Archive size={15} aria-hidden="true" /></button>
                  ) : (
                    <button type="button" aria-label={`Restore ${person.name}`} title="Restore" onClick={() => api.action(`/api/people/${person.id}/restore`)}><RotateCcw size={15} aria-hidden="true" /></button>
                  )}
                  <button type="button" aria-label={`Delete ${person.name} permanently`} title="Delete permanently" onClick={() => void deletePerson(person)}><Trash2 size={15} aria-hidden="true" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );

  async function deletePerson(person: PersonRecord) {
    const confirm = `DELETE PERSON ${person.id}`;
    try {
      if (!await confirmDestructivePreview(confirmDestructiveAction, confirm, `/api/people/${encodeURIComponent(person.id)}/operation-preview`, `Permanently delete "${person.name}"? This cannot be restored from WardSen.`)) return;
    } catch (error) {
      setMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
      return;
    }
    setMessage({ status: "loading", text: `Deleting ${person.name}...` });
    try {
      await api.action(`/api/people/${person.id}?hard=true`, { method: "DELETE", body: JSON.stringify({ confirm }) });
      setMessage({ status: "ready", text: `${person.name} deleted.` });
    } catch (error) {
      setMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function archivePerson(person: PersonRecord) {
    const confirm = `OFFBOARD PERSON ${person.id}`;
    try {
      if (!await confirmDestructivePreview(confirmDestructiveAction, confirm, `/api/people/${encodeURIComponent(person.id)}/operation-preview`, `Offboard "${person.name}"? Their People record will be archived and no longer selected for new deliveries.`)) return;
      setMessage({ status: "loading", text: `Offboarding ${person.name}...` });
      await api.action(`/api/people/${person.id}`, { method: "DELETE", body: JSON.stringify({ confirm }) });
      setMessage({ status: "ready", text: `${person.name} offboarded.` });
    } catch (error) {
      setMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }
}

function RequestsView({ api }: { api: ReturnType<typeof useWardSenApi> }) {
  const emptyEmployeeForm = { name: "", assignedEmail: "", team: "", role: "", active: true };
  const [employeeForm, setEmployeeForm] = useState(emptyEmployeeForm);
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | undefined>();
  const [codeForm, setCodeForm] = useState({ employeeId: "", ttlMinutes: "15", senderEmail: "" });
  const [issuedCode, setIssuedCode] = useState<EmployeeSignInCodeResponse | undefined>();
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
  const [message, setMessage] = useState<{ status: "idle" | "loading" | "ready" | "error"; text?: string; url?: string; delivery?: CreatedDeliveryRecord }>({ status: "idle" });
  const activeEmployees = api.employees.filter((employee) => employee.active);
  const sourceAccountId = catalogForm.sourceAccountId || api.accounts[0]?.id || "";
  const sourceAccount = api.accounts.find((account) => account.id === sourceAccountId);
  const allowedEmployeeId = catalogForm.allowedEmployeeId;
  const codeEmployeeId = codeForm.employeeId || activeEmployees[0]?.id || "";
  const selectedRequestEmployee = activeEmployees.find((employee) => employee.id === requestForm.employeeId);
  const requestCatalog = api.catalogEntries.filter((entry) => entry.active && (!requestForm.employeeId || catalogEntryAllowsEmployee(entry, selectedRequestEmployee)));
  const requestSelectedEntry = requestCatalog.find((entry) => entry.id === requestForm.catalogEntryId);
  const deliveryProviderId = approvalForm.deliveryProviderId || api.deliveryProviders[0]?.id || "";
  const deliveryAccountId = approvalForm.deliveryAccountId || api.accounts[0]?.id || "";
  const selectedApprovalProvider = api.deliveryProviders.find((provider) => provider.id === deliveryProviderId);
  const approvalCapabilities = selectedApprovalProvider?.capabilities ?? {};
  const approvalManualHandoff = isManualHandoffProvider(selectedApprovalProvider);
  const approvalExpiryValue = approvalCapabilities.customExpiry === false ? "24" : approvalForm.expiryHours;
  const approvalViewLimitValue = approvalCapabilities.arbitraryViewLimit ? approvalForm.viewLimit : "";
  const approvalViewOnceChecked = approvalCapabilities.viewOnce ? (approvalManualHandoff ? true : approvalForm.viewOnce) : false;

  async function saveEmployee(event: React.FormEvent) {
    event.preventDefault();
    const updating = Boolean(editingEmployeeId);
    setMessage({ status: "loading", text: updating ? "Updating employee identity..." : "Saving employee identity..." });
    try {
      const employee = editingEmployeeId
        ? await apiSend<EmployeeRecord>(`/api/employees/${editingEmployeeId}`, {
          method: "PUT",
          body: JSON.stringify({
            name: employeeForm.name,
            team: employeeForm.team || undefined,
            role: employeeForm.role || undefined,
            active: employeeForm.active
          })
        })
        : await apiSend<EmployeeRecord>("/api/employees", {
          body: JSON.stringify({
            name: employeeForm.name,
            assignedEmail: employeeForm.assignedEmail,
            team: employeeForm.team || undefined,
            role: employeeForm.role || undefined,
            active: true
          })
        });
      setEditingEmployeeId(undefined);
      setEmployeeForm(emptyEmployeeForm);
      setRequestForm((current) => ({ ...current, employeeId: employee.id, catalogEntryId: "" }));
      setMessage({ status: "ready", text: `${updating ? "Updated" : "Saved"} ${employee.name} with assigned email ${employee.assignedEmail}.` });
      await api.refresh();
    } catch (error) {
      setMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  function editEmployee(employee: EmployeeRecord) {
    setEditingEmployeeId(employee.id);
    setEmployeeForm({
      name: employee.name,
      assignedEmail: employee.assignedEmail,
      team: employee.team ?? "",
      role: employee.role ?? "",
      active: employee.active
    });
    setMessage({ status: "ready", text: `Editing ${employee.name}.` });
  }

  function cancelEmployeeEdit() {
    setEditingEmployeeId(undefined);
    setEmployeeForm(emptyEmployeeForm);
    setMessage({ status: "idle" });
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
    if (requestForm.breakGlass) {
      if (!requestForm.breakGlassJustification.trim()) {
        setMessage({ status: "error", text: "Break-glass requests require an emergency justification." });
        return;
      }
      const credentialName = requestSelectedEntry?.credentialName ?? "selected credential";
      if (!confirmBreakGlassSubmission(credentialName, assignedEmail)) return;
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
          expectedDurationMinutes: Number(requestForm.expectedDurationMinutes) || undefined,
          ...breakGlassRequestPayload(requestForm, requestForm.catalogEntryId)
        })
      });
      const { request: accessRequest, delivery, autoApproved } = normalizeAccessRequestResponse(response);
      setRequestForm((current) => ({ ...current, reason: "", ticketRef: "", breakGlass: false, breakGlassJustification: "" }));
      setMessage({
        status: "ready",
        text: accessRequest.breakGlass ? `Emergency break-glass request queued for ${accessRequest.credentialName}.` : autoApproved ? `Policy approved ${accessRequest.credentialName}; admin delivery confirmation is still required.` : `Request queued for ${accessRequest.credentialName}.`,
        url: delivery?.oneTimeDeliveryUrl,
        delivery
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
    const confirmed = window.confirm(approvalConfirmationMessage(action, accessRequest, selectedApprovalProvider));
    if (!confirmed) return;
    setMessage({ status: "loading", text: `Approving ${accessRequest.credentialName}...` });
    try {
      const deliveryOptions = deliveryOptionsForProvider(selectedApprovalProvider, approvalForm);
      const result = await apiSend<{ request: CredentialAccessRequestRecord; delivery: CreatedDeliveryRecord }>(`/api/credential-requests/${accessRequest.id}/approve`, {
        body: JSON.stringify({
          approver: approvalForm.approver || "WardSen admin",
          deliveryProviderId,
          deliveryAccountId,
          ...deliveryOptions,
          confirmRiskSummary: true
        })
      });
      setMessage({
        status: "ready",
        text: deliveryMessage(`${result.request.credentialName} approved for ${result.request.assignedEmail}.`, result.delivery),
        url: result.delivery.oneTimeDeliveryUrl,
        delivery: result.delivery
      });
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
    const confirmed = window.confirm(replacementConfirmationMessage(accessRequest, selectedApprovalProvider));
    if (!confirmed) return;
    setMessage({ status: "loading", text: `Replacing link for ${accessRequest.credentialName}...` });
    try {
      const deliveryOptions = deliveryOptionsForProvider(selectedApprovalProvider, approvalForm);
      const result = await apiSend<{ request: CredentialAccessRequestRecord; delivery: CreatedDeliveryRecord }>(`/api/credential-requests/${accessRequest.id}/replacement-link`, {
        body: JSON.stringify({
          approver: approvalForm.approver || "WardSen admin",
          deliveryProviderId,
          deliveryAccountId,
          ...deliveryOptions,
          replacementReason: approvalForm.replacementReason || "Unexpected access or stale link",
          confirmRiskSummary: true,
          confirm: `REPLACE REQUEST ${accessRequest.id}`
        })
      });
      setMessage({
        status: "ready",
        text: deliveryMessage(`Replacement link created for ${result.request.assignedEmail}.`, result.delivery),
        url: result.delivery.oneTimeDeliveryUrl,
        delivery: result.delivery
      });
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
          {message.url ? <DeliveryLinkAction delivery={message.delivery} url={message.url} label="Copy approved link" copiedLabel="Approved link copied" /> : null}
        </div>
      )}
      <form className="panel formGrid" onSubmit={saveEmployee}>
        <PanelTitle icon={UsersRound} title={editingEmployeeId ? "Edit Employee Identity" : "Add Employee Identity"} />
        <label>Name<input name="employeeName" required value={employeeForm.name} onChange={(event) => setEmployeeForm((current) => ({ ...current, name: event.target.value }))} placeholder="Ravi Menon" /></label>
        <label>Assigned email<input name="assignedEmail" required type="email" readOnly={Boolean(editingEmployeeId)} value={employeeForm.assignedEmail} onChange={(event) => setEmployeeForm((current) => ({ ...current, assignedEmail: event.target.value }))} placeholder="ravi@example.com" />
          {editingEmployeeId ? <small className="fieldInstruction">The assigned email is this employee's request-portal identity. Create a new employee identity to change it.</small> : null}
        </label>
        <label>Team<input name="employeeTeam" value={employeeForm.team} onChange={(event) => setEmployeeForm((current) => ({ ...current, team: event.target.value }))} placeholder="Ops" /></label>
        <label>Role<input name="employeeRole" value={employeeForm.role} onChange={(event) => setEmployeeForm((current) => ({ ...current, role: event.target.value }))} placeholder="Engineer" /></label>
        {editingEmployeeId ? <label className="check spanAll"><input type="checkbox" checked={employeeForm.active} onChange={(event) => setEmployeeForm((current) => ({ ...current, active: event.target.checked }))} /> Active employee</label> : null}
        <div className="buttonRow spanAll">
          <button className="primary"><UsersRound size={16} aria-hidden="true" /> {editingEmployeeId ? "Update employee" : "Save employee"}</button>
          {editingEmployeeId ? <button type="button" onClick={cancelEmployeeEdit}>Cancel edit</button> : null}
        </div>
      </form>
      <section className="panel">
        <PanelTitle icon={UsersRound} title="Employee Identities" action="Refresh" onAction={api.refresh} />
        {api.employees.length === 0 ? <EmptyState text="No employee identities yet. Add an assigned email above to enable requests." /> : (
          <div className="rows">
            {api.employees.map((employee) => (
              <div className="row person" key={employee.id}>
                <div>
                  <strong>{employee.name}</strong>
                  <span>{employee.assignedEmail}</span>
                </div>
                <span>{employee.team ?? "No team"}</span>
                <span>{employee.role ?? "No role"}</span>
                <Status value={employee.active ? "Active" : "Inactive"} />
                <div className="actions">
                  <CopyFeedbackButton value={employee.assignedEmail} label="Copy email" copiedLabel="Email copied" copiedStatus="Email copied to clipboard." />
                  <button type="button" aria-label={`Edit ${employee.name}`} title="Edit employee" onClick={() => editEmployee(employee)}><Pencil size={15} aria-hidden="true" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <form className="panel formGrid" onSubmit={issueEmployeeCode}>
        <PanelTitle icon={KeyRound} title="Employee Sign-In Code" />
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
        <PanelTitle icon={KeyRound} title="Admin Catalog Metadata" />
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
        <PanelTitle icon={Archive} title="Admin-Assisted Request" />
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
        <label className="inlineCheck spanAll"><input type="checkbox" checked={requestForm.breakGlass} onChange={(event) => setRequestForm((current) => ({ ...current, breakGlass: event.target.checked }))} /> Emergency break-glass request</label>
        {requestForm.breakGlass ? (
          <label className="spanAll attentionField">Emergency justification<textarea required value={requestForm.breakGlassJustification} onChange={(event) => setRequestForm((current) => ({ ...current, breakGlassJustification: event.target.value }))} placeholder="Why normal approval cannot wait; include incident or customer impact." />
            <small className="fieldInstruction">Break-glass creates an audited emergency request and requires a final confirmation before submission. It does not deliver a credential without admin fulfillment.</small>
          </label>
        ) : null}
        <button className="primary full" disabled={!requestForm.employeeId || !requestForm.catalogEntryId}><Archive size={16} aria-hidden="true" /> Request access</button>
      </form>
      <section className="panel requestGuide" aria-labelledby="request-guide-title">
        <PanelTitle icon={UsersRound} title="How Requests Work" action="" />
        <ol id="request-guide-title" className="requestSteps">
          <li><strong>Admin prepares access:</strong> create an Employee with their assigned work email, then publish only credential metadata and who may request it.</li>
          <li><strong>Admin issues a code:</strong> select the employee, create a one-time sign-in code, and send that code through their assigned-email workflow.</li>
          <li><strong>Employee requests:</strong> they open Employee Portal, enter the assigned email and one-time code, choose an allowed credential, and state the reason and ticket.</li>
          <li><strong>Admin decides:</strong> review the request in Admin Request Queue, approve or deny it, then choose an available delivery provider and audit account.</li>
          <li><strong>Employee receives a link:</strong> WardSen creates a short-lived provider link. A replacement request revokes the prior link first when that provider supports revocation.</li>
        </ol>
      </section>
      <section className="panel employeePortalLaunch">
        <PanelTitle icon={Lock} title="Employee Portal" action="Open" onAction={() => window.location.assign(`${window.location.pathname}?view=employee`)} />
        <p>Employees use their assigned email and an admin-issued one-time code in a separate request-only view. It never exposes the admin queue, vault accounts or raw credentials.</p>
      </section>
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
          <input aria-label="Approval expiry hours" inputMode="numeric" value={approvalExpiryValue} disabled={approvalCapabilities.customExpiry === false} onChange={(event) => setApprovalForm((current) => ({ ...current, expiryHours: event.target.value }))} placeholder="Hours" />
          <input aria-label="Approval view limit" inputMode="numeric" value={approvalViewLimitValue} disabled={!approvalCapabilities.arbitraryViewLimit} onChange={(event) => setApprovalForm((current) => ({ ...current, viewLimit: event.target.value }))} placeholder={approvalCapabilities.arbitraryViewLimit ? "Views" : "Provider fixed"} />
          <input aria-label="Replacement reason" value={approvalForm.replacementReason} onChange={(event) => setApprovalForm((current) => ({ ...current, replacementReason: event.target.value }))} placeholder="Replacement reason" />
          <label className="inlineCheck"><input type="checkbox" checked={approvalViewOnceChecked} disabled={!approvalCapabilities.viewOnce || approvalManualHandoff} onChange={(event) => setApprovalForm((current) => ({ ...current, viewOnce: event.target.checked }))} /> One access</label>
        </div>
        {approvalManualHandoff ? (
          <div className="riskSummary">
            <strong>Ente Paste approval handoff</strong>
            <span>WardSen copies only the credential title, username and password to the local clipboard, then records handoff pending. Open Ente Paste, create the one-time link there, then send Ente's generated link to the assigned employee email.</span>
            <span>WardSen cannot verify Ente views, access counts, IP/device details, or revoke Ente Paste links.</span>
          </div>
        ) : null}
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
                  {accessRequest.breakGlass ? <span>Emergency break-glass / {accessRequest.breakGlassConfirmedAt ? formatDate(accessRequest.breakGlassConfirmedAt) : "confirmed"}</span> : null}
                  {(accessRequest.replacementCount ?? 0) > 0 ? <span>{accessRequest.replacementCount} replacement{accessRequest.replacementCount === 1 ? "" : "s"} / previous {accessRequest.previousDeliveryId ?? "link"}</span> : null}
                </div>
                <span>{employeeLabel(api.employees, accessRequest.employeeId)}</span>
                <span>{accessRequest.assignedEmail}</span>
                <span>{accessRequest.breakGlassJustification ?? accessRequest.reason}</span>
                <Status value={titleStatus(accessRequest.status)} />
                <div className="actions">
                  <button type="button" disabled={accessRequest.status !== "pending" && accessRequest.status !== "approved"} onClick={() => void approveRequest(accessRequest)}><Send size={15} aria-hidden="true" /> {accessRequest.status === "approved" ? "Fulfill" : "Approve"}</button>
                  <button type="button" disabled={accessRequest.status !== "fulfilled" || !accessRequest.deliveryId || (accessRequest.deliveryProviderId ? !deliveryProviderSupports(api.deliveryProviders, accessRequest.deliveryProviderId, "revokeLink") : false)} onClick={() => void replaceRequestLink(accessRequest)}><RotateCcw size={15} aria-hidden="true" /> Replace</button>
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

function Deliveries({ api, confirmDestructiveAction }: { api: ReturnType<typeof useWardSenApi>; confirmDestructiveAction: DestructiveConfirmation }) {
  const [batchDetails, setBatchDetails] = useState<{ status: LoadState | "idle"; batchId?: string; deliveries: DeliveryRecord[]; error?: string }>({
    status: "idle",
    deliveries: []
  });
  const [auditMessage, setAuditMessage] = useState<{ status: "idle" | "loading" | "ready" | "error"; text?: string }>({ status: "idle" });

  async function loadBatch(batchId: string) {
    setBatchDetails({ status: "loading", batchId, deliveries: [] });
    try {
      const result = parseDeliveryList(await apiGet<unknown>(`/api/deliveries?batchId=${encodeURIComponent(batchId)}&page=1&pageSize=100`));
      setBatchDetails({ status: "ready", batchId, deliveries: result.items });
    } catch (error) {
      setBatchDetails({ status: "error", batchId, deliveries: [], error: error instanceof Error ? error.message : String(error) });
    }
  }

  async function revokeSuspiciousDelivery(delivery: DeliveryRecord) {
    if (!deliveryProviderSupports(api.deliveryProviders, delivery.deliveryProviderId, "revokeLink")) {
      setAuditMessage({ status: "error", text: `${delivery.deliveryProviderId} does not expose sender-side revoke through WardSen.` });
      return;
    }
    const confirm = `REVOKE DELIVERY ${delivery.id}`;
    let confirmed: boolean;
    try {
      confirmed = await confirmDestructivePreview(confirmDestructiveAction, confirm, `/api/deliveries/${encodeURIComponent(delivery.id)}/operation-preview`, `Revoke the suspicious provider link for "${delivery.credentialName}"? Recipients may lose access immediately.`);
    } catch (error) {
      setAuditMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (!confirmed) return;

    setAuditMessage({ status: "loading", text: `Revoking ${delivery.credentialName}...` });
    try {
      const revoked = parseDeliveryRecord(await apiSend<unknown>(`/api/deliveries/${delivery.id}`, {
        method: "DELETE",
        body: JSON.stringify({ confirm })
      }));
      setAuditMessage({ status: "ready", text: `${delivery.credentialName}: ${titleStatus(revoked.status)}.` });
      await api.refresh();
    } catch (error) {
      setAuditMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function containSuspiciousBatch(delivery: DeliveryRecord) {
    if (!delivery.batchId) return;
    if (!deliveryProviderSupports(api.deliveryProviders, delivery.deliveryProviderId, "revokeLink")) {
      setAuditMessage({ status: "error", text: `${delivery.deliveryProviderId} does not expose sender-side revoke through WardSen.` });
      return;
    }
    const confirm = `REVOKE BATCH LINKS ${delivery.batchId}`;
    let confirmed: boolean;
    try {
      confirmed = await confirmDestructivePreview(confirmDestructiveAction, confirm, `/api/deliveries/${encodeURIComponent(delivery.id)}/revoke-batch/operation-preview`, `Revoke every active provider link created in this batch for "${delivery.credentialName}"? Every recipient in the batch may lose access immediately.`);
    } catch (error) {
      setAuditMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (!confirmed) return;

    setAuditMessage({ status: "loading", text: `Revoking active links in batch ${delivery.batchId}...` });
    try {
      const result = parseBatchDeliveryRevokeResult(await apiSend<unknown>(`/api/deliveries/${delivery.id}/revoke-batch`, {
        method: "POST",
        body: JSON.stringify({ confirm })
      }));
      const summary = `Revoked ${result.revokedCount} batch link${result.revokedCount === 1 ? "" : "s"}; ${result.inactiveCount} already inactive.`;
      setAuditMessage(result.failed.length
        ? { status: "error", text: `${summary} ${result.failed.length} link revoke${result.failed.length === 1 ? " failed" : "s failed"}; review the local audit log.` }
        : { status: "ready", text: summary });
      await api.refresh();
    } catch (error) {
      setAuditMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function cancelBatch(batch: DeliveryBatchRecord) {
    const confirm = `CANCEL BATCH ${batch.id}`;
    let confirmed: boolean;
    try {
      confirmed = await confirmDestructivePreview(confirmDestructiveAction, confirm, `/api/batches/${encodeURIComponent(batch.id)}/operation-preview`, `Cancel batch ${batch.id}? Any queued work for this batch will stop.`);
    } catch (error) {
      setAuditMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (!confirmed) return;
    try {
      await api.action(`/api/batches/${batch.id}/cancel`, { body: JSON.stringify({ confirm }) });
    } catch (error) {
      setAuditMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function refreshProviderStatus(silent = false) {
    if (!silent) setAuditMessage({ status: "loading", text: "Refreshing provider status for active deliveries..." });
    try {
      const summary = await refreshSupportedDeliveryStatuses(api.deliveries, api.deliveryProviders, api.accounts);
      if (!silent || summary.failed > 0 || summary.total === 0) {
        setAuditMessage({
          status: summary.failed ? "error" : "ready",
          text: refreshSummaryText(summary)
        });
      }
      await api.refresh();
    } catch (error) {
      setAuditMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  const refreshKey = [
    api.deliveries
      .filter((delivery) => isLiveStatusRefreshCandidate(delivery) && deliveryProviderSupports(api.deliveryProviders, delivery.deliveryProviderId, "statusLookup"))
      .map((delivery) => `${delivery.id}:${delivery.status}`)
      .join(","),
    api.accounts.map((account) => `${account.id}:${account.status}`).join(",")
  ].join("|");

  useEffect(() => {
    if (!refreshKey) return;
    const firstCheck = window.setTimeout(() => void refreshProviderStatus(true), 500);
    const interval = window.setInterval(() => void refreshProviderStatus(true), 2 * 60 * 1000);
    return () => {
      window.clearTimeout(firstCheck);
      window.clearInterval(interval);
    };
  }, [refreshKey]);

  return (
    <div className="grid">
      <section className="panel">
        <PanelTitle icon={ShieldCheck} title="Delivery Audit" action="Refresh provider status" onAction={() => void refreshProviderStatus()} />
        {auditMessage.status === "error" ? <ErrorNotice message={auditMessage.text} compact /> : null}
        {auditMessage.status === "loading" || auditMessage.status === "ready" ? <div className="notice compact" role="status" aria-live="polite">{auditMessage.text}</div> : null}
        <DeliveryAuditPanel
          deliveries={api.deliveries}
          people={api.people}
          providers={api.deliveryProviders}
          canRevoke={(delivery) => deliveryProviderSupports(api.deliveryProviders, delivery.deliveryProviderId, "revokeLink")}
          onRevoke={(delivery) => void revokeSuspiciousDelivery(delivery)}
          canContainBatch={(delivery) => Boolean(delivery.batchId) && deliveryProviderSupports(api.deliveryProviders, delivery.deliveryProviderId, "revokeLink")}
          onContainBatch={(delivery) => void containSuspiciousBatch(delivery)}
        />
      </section>
      <section className="panel">
        <PanelTitle icon={Send} title="Delivery History" action="Reload history" onAction={api.refresh} />
        <DeliveryTable api={api} confirmDestructiveAction={confirmDestructiveAction} />
      </section>
      <section className="panel">
        <PanelTitle icon={Archive} title="Bulk Batches" action="Refresh" onAction={api.refresh} />
        <BatchTable batches={api.batches} selectedBatchId={batchDetails.batchId} onSelectBatch={loadBatch} onCancelBatch={(batch) => void cancelBatch(batch)} />
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

function SettingsView({ credentialProviders, deliveryProviders, optionalDeliveryProviders, plannedProviders, onRefresh, confirmAction }: { credentialProviders: ProviderInfo[]; deliveryProviders: ProviderInfo[]; optionalDeliveryProviders: ProviderInfo[]; plannedProviders: ProviderInfo[]; onRefresh: () => void; confirmAction: DestructiveConfirmation }) {
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [connectionCheck, setConnectionCheck] = useState<{ providerId?: string; status: "idle" | "loading" | "ready" | "error"; text?: string }>({ status: "idle" });
  const [diagnostic, setDiagnostic] = useState<{ providerId?: string; status: "idle" | "loading" | "ready" | "error"; value?: ProviderDiagnostic; text?: string }>({ status: "idle" });
  const providers = [...credentialProviders, ...deliveryProviders, ...optionalDeliveryProviders];
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? providers[0];
  const capabilities = selectedProvider?.capabilities ?? {};
  const isSelectedProviderCheck = connectionCheck.providerId === selectedProvider?.id;
  const isSelectedDiagnostic = diagnostic.providerId === selectedProvider?.id;

  async function checkDeliveryProvider() {
    if (!selectedProvider || selectedProvider.kind !== "delivery" || selectedProvider.id === "bitwarden-send") return;
    const provider = selectedProvider;
    setConnectionCheck({ providerId: provider.id, status: "loading", text: `Checking ${provider.displayName} configuration...` });
    try {
      const result = await apiSend<{ ready: boolean; safeMessage?: string }>(`/api/delivery-providers/${encodeURIComponent(provider.id)}/test`);
      setConnectionCheck({
        providerId: provider.id,
        status: result.ready ? "ready" : "error",
        text: result.safeMessage ?? (result.ready ? `${provider.displayName} is ready.` : `${provider.displayName} is not ready.`)
      });
    } catch (error) {
      setConnectionCheck({ providerId: provider.id, status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function refreshDiagnostics() {
    if (!selectedProvider) return;
    const provider = selectedProvider;
    setDiagnostic({ providerId: provider.id, status: "loading", text: `Checking ${provider.displayName} local readiness...` });
    try {
      const value = await apiGet<ProviderDiagnostic>(`/api/provider-diagnostics/${encodeURIComponent(provider.id)}`);
      setDiagnostic({ providerId: provider.id, status: "ready", value });
    } catch (error) {
      setDiagnostic({ providerId: provider.id, status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function setWeakerProviderEnabled(provider: ProviderInfo, enabled: boolean) {
    const action = enabled ? "ENABLE" : "DISABLE";
    const phrase = `${action} WEAKER PROVIDER ${provider.id}`;
    const confirmed = await confirmAction(
      phrase,
      enabled
        ? `${provider.displayName} has reduced delivery safeguards. ${provider.optInWarning ?? "Review its limitations before enabling it."}`
        : `Disable ${provider.displayName}. It will be removed from delivery selection, while existing delivery records remain available for audit.`
    );
    if (!confirmed) return;
    try {
      await apiSend(`/api/delivery-providers/${encodeURIComponent(provider.id)}/opt-in`, {
        method: enabled ? "POST" : "DELETE",
        body: JSON.stringify({ confirm: phrase })
      });
      await onRefresh();
    } catch (error) {
      setConnectionCheck({ providerId: provider.id, status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <div className="grid">
      <section className="panel">
        <PanelTitle icon={Settings} title="Provider Capabilities" action="Refresh" onAction={onRefresh} />
        <div className="filters">
          <select aria-label="Provider capability selection" value={selectedProvider?.id ?? ""} onChange={(event) => {
            setSelectedProviderId(event.target.value);
            setConnectionCheck({ status: "idle" });
            setDiagnostic({ status: "idle" });
          }}>
            {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.displayName}</option>)}
          </select>
          {selectedProvider?.documentationUrl ? <button type="button" onClick={() => void openExternalUrl(selectedProvider.documentationUrl!)}>Open provider docs</button> : null}
          {selectedProvider?.kind === "delivery" && selectedProvider.id !== "bitwarden-send" ? <button type="button" disabled={isSelectedProviderCheck && connectionCheck.status === "loading"} onClick={() => void checkDeliveryProvider()}>{isSelectedProviderCheck && connectionCheck.status === "loading" ? "Checking..." : "Check configuration"}</button> : null}
          <button type="button" disabled={isSelectedDiagnostic && diagnostic.status === "loading"} onClick={() => void refreshDiagnostics()}>{isSelectedDiagnostic && diagnostic.status === "loading" ? "Checking runtime..." : "Refresh diagnostics"}</button>
        </div>
        {selectedProvider?.notes ? <p className="providerNotes">{selectedProvider.notes}</p> : null}
        {selectedProvider?.id === "bitwarden" || selectedProvider?.id === "bitwarden-send" ? <BitwardenCliSetupWizard onConfigured={onRefresh} /> : null}
        {selectedProvider?.setupInstructions?.length ? <ul className="providerSetup" aria-label={`${selectedProvider.displayName} setup`}>
          {selectedProvider.setupInstructions.map((instruction) => <li key={instruction}>{instruction}</li>)}
        </ul> : null}
        {selectedProvider?.id === "bitwarden-send" ? <p className="providerNotes">Bitwarden Send readiness is checked with the selected unlocked Bitwarden account when a delivery is created.</p> : null}
        {isSelectedProviderCheck && connectionCheck.status !== "idle" ? <div className={connectionCheck.status === "error" ? "notice error compact" : "notice compact"} role="status" aria-live="polite">{connectionCheck.text}</div> : null}
        {isSelectedDiagnostic && diagnostic.status === "error" ? <ErrorNotice message={diagnostic.text} compact /> : null}
        {isSelectedDiagnostic && diagnostic.status === "ready" && diagnostic.value ? <ProviderDiagnostics diagnostic={diagnostic.value} /> : null}
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
      <section className="panel">
        <PanelTitle icon={ShieldCheck} title="Optional Delivery Providers" action="Refresh" onAction={onRefresh} />
        <div className="optionalProviderList">
          {optionalDeliveryProviders.map((provider) => (
            <article className="optionalProvider" key={provider.id}>
              <div>
                <h3>{provider.displayName}</h3>
                <p>{provider.optInWarning ?? "This provider requires an operator opt-in before it can be selected for delivery."}</p>
              </div>
              <button type="button" className="warningAction" onClick={() => void setWeakerProviderEnabled(provider, true)}>
                <ShieldCheck size={15} aria-hidden="true" /> Enable {provider.displayName}
              </button>
            </article>
          ))}
          {optionalDeliveryProviders.length === 0 ? <EmptyState text="No weaker delivery providers are waiting for opt-in." /> : null}
          {deliveryProviders.filter((provider) => provider.requiresExplicitOptIn).map((provider) => (
            <article className="optionalProvider enabled" key={provider.id}>
              <div>
                <h3>{provider.displayName}</h3>
                <p>Enabled by an operator. Its reduced lifecycle safeguards still apply.</p>
              </div>
              <button type="button" onClick={() => void setWeakerProviderEnabled(provider, false)}>Disable provider</button>
            </article>
          ))}
        </div>
      </section>
      <section className="panel">
        <PanelTitle icon={Send} title="Planned Provider Candidates" action="Refresh" onAction={onRefresh} />
        <div className="table providerTable">
          <div className="tableHead providerCandidate">
            <span>Provider</span><span>Type</span><span>Status</span><span>Integration</span><span>Telemetry</span><span>Promotion blockers</span>
          </div>
          {plannedProviders.map((provider) => (
            <div className="tableRow providerCandidate" key={provider.id}>
              <div>
                <strong>{provider.displayName}</strong>
                <span>{provider.documentationUrl ?? provider.id}</span>
              </div>
              <span>{titleStatus(provider.kind ?? "provider")}</span>
              <Status value={titleStatus(provider.maturity ?? "planned")} />
              <span>{provider.delivery ? titleStatus(provider.delivery.integrationSurface) : "Unknown"}</span>
              <span>{provider.delivery ? providerTelemetryLabel(provider.delivery) : "Unknown"}</span>
              <span>{provider.delivery?.promotionBlockedBy.join(", ") || "Provider-specific conformance tests"}</span>
            </div>
          ))}
          {plannedProviders.length === 0 ? <EmptyState text="No planned providers are configured." /> : null}
        </div>
      </section>
    </div>
  );
}

function ProviderDiagnostics({ diagnostic }: { diagnostic: ProviderDiagnostic }) {
  const accountSummary = diagnostic.accounts.length
    ? diagnostic.accounts.map((account) => `${account.label}: ${titleStatus(account.status)}`).join(", ")
    : "No local account configured";
  return (
    <section className="providerDiagnostics" aria-label={`${diagnostic.displayName} diagnostics`}>
      <h3>Local readiness</h3>
      <dl>
        <div><dt>Runtime</dt><dd>{diagnostic.runtime.kind === "cli" ? `${diagnostic.runtime.binaryFound ? "CLI found" : "CLI unavailable"} - ${diagnostic.runtime.version}` : diagnostic.runtime.version}</dd></div>
        <div><dt>Authentication</dt><dd>{titleStatus(diagnostic.authentication.state)}</dd></div>
        <div><dt>Account state</dt><dd>{accountSummary}</dd></div>
        <div><dt>Link-preview risk</dt><dd>{diagnostic.linkPreviewRisk}</dd></div>
      </dl>
      <p>{diagnostic.runtime.detail}</p>
      <p>{diagnostic.authentication.detail}</p>
    </section>
  );
}

function BitwardenCliSetupWizard({ onConfigured }: { onConfigured: () => void }) {
  const [diagnostic, setDiagnostic] = useState<{ status: "loading" | "ready" | "error"; value?: ProviderDiagnostic; text?: string }>({ status: "loading" });
  const [showLocator, setShowLocator] = useState(false);
  const [executablePath, setExecutablePath] = useState("");
  const [trustAcknowledged, setTrustAcknowledged] = useState(false);
  const [saveState, setSaveState] = useState<{ status: "idle" | "loading" | "ready" | "error"; text?: string }>({ status: "idle" });

  async function checkRuntime() {
    setDiagnostic({ status: "loading" });
    try {
      const value = await apiGet<ProviderDiagnostic>("/api/provider-diagnostics/bitwarden");
      setDiagnostic({ status: "ready", value });
    } catch (error) {
      setDiagnostic({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  useEffect(() => {
    void checkRuntime();
  }, []);

  async function openInstallGuide() {
    try {
      await openExternalUrl("https://bitwarden.com/help/cli/");
    } catch (error) {
      setSaveState({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function verifyAndUseExecutable() {
    setSaveState({ status: "loading", text: "Verifying the selected CLI with bw --version..." });
    try {
      const result = await apiSend<{ version: string }>("/api/provider-tools/bitwarden/locate", {
        body: JSON.stringify({ executablePath, trustAcknowledged })
      });
      setExecutablePath("");
      setTrustAcknowledged(false);
      setShowLocator(false);
      setSaveState({ status: "ready", text: `Bitwarden CLI verified: ${result.version}. WardSen will use it immediately.` });
      await checkRuntime();
      onConfigured();
    } catch (error) {
      setSaveState({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  const cliFound = diagnostic.status === "ready" && diagnostic.value?.runtime.kind === "cli" && diagnostic.value.runtime.binaryFound;
  const cliVersion = cliFound ? diagnostic.value?.runtime.version : "Not found";
  return (
    <div className="providerSetupWizard" aria-label="Bitwarden CLI setup">
      <div className="providerSetupWizardHeader">
        <div>
          <h3>Bitwarden CLI setup</h3>
          <p>WardSen connects to Bitwarden through the provider&apos;s local <code>bw</code> CLI. It never installs npm packages or downloads a provider binary for you.</p>
        </div>
        <button type="button" onClick={() => void checkRuntime()} disabled={diagnostic.status === "loading"}>{diagnostic.status === "loading" ? "Checking..." : "Check again"}</button>
      </div>
      <ol className="providerSetupSteps">
        <li className="ready"><CheckCircle2 size={17} aria-hidden="true" /><span><strong>WardSen desktop app</strong><small>Ready</small></span></li>
        <li className={cliFound ? "ready" : "pending"}><CheckCircle2 size={17} aria-hidden="true" /><span><strong>Bitwarden CLI</strong><small>{cliFound ? `Found: ${cliVersion}` : diagnostic.status === "loading" ? "Checking local paths and PATH..." : "Not found"}</small></span></li>
      </ol>
      {!cliFound ? <p className="providerSetupGuidance">Use Bitwarden&apos;s official guide to download the correct CLI for this computer, or choose an existing IT-approved <code>bw</code> executable. WardSen checks only its version before saving the local choice.</p> : <p className="providerSetupGuidance">The local service can use this CLI. Add a Bitwarden account in Vaults, then use Terminal login / unlock.</p>}
      <div className="providerSetupActions">
        <button type="button" className="secondary" onClick={() => void openInstallGuide()}>Open official CLI guide</button>
        <button type="button" onClick={() => setShowLocator((current) => !current)}>{showLocator ? "Hide CLI path" : "Locate existing CLI"}</button>
      </div>
      {showLocator ? <div className="providerCliLocator">
        <label>Official <code>bw</code> executable path
          <input value={executablePath} onChange={(event) => setExecutablePath(event.target.value)} placeholder="Absolute path to bw or bw.exe" autoComplete="off" />
        </label>
        <label className="checkboxLine"><input type="checkbox" checked={trustAcknowledged} onChange={(event) => setTrustAcknowledged(event.target.checked)} /> I trust this official or IT-approved Bitwarden CLI file.</label>
        <small>WardSen runs <code>bw --version</code> before it uses the file. The selected path stays on this device; no binary, password, or session token is sent to WardSen&apos;s project.</small>
        <div className="providerSetupActions">
          <button type="button" className="primary" disabled={!executablePath.trim() || !trustAcknowledged || saveState.status === "loading"} onClick={() => void verifyAndUseExecutable()}>{saveState.status === "loading" ? "Verifying CLI..." : "Verify and use CLI"}</button>
        </div>
      </div> : null}
      {diagnostic.status === "error" ? <ErrorNotice message={diagnostic.text} compact /> : null}
      {saveState.status !== "idle" ? <div className={saveState.status === "error" ? "notice error compact" : "notice compact"} role="status" aria-live="polite">{saveState.text}</div> : null}
    </div>
  );
}

function DeliveryComposer({ api, selectedCredentials }: { api: ReturnType<typeof useWardSenApi>; selectedCredentials: CredentialSummary[] }) {
  const [form, setForm] = useState({
    contentType: "credential" as "credential" | "custom-text",
    mode: "shared" as "shared" | "individual" | "bulk",
    personId: "",
    deliveryProviderId: "",
    deliveryAccountId: "",
    expiryHours: "24",
    viewLimit: "",
    viewOnce: false,
    hideText: false,
    accessPassword: "",
    deliveryMethod: "copy" as "copy" | "whatsapp" | "email",
    linkArrangement: "separate" as "separate" | "bundle",
    bundleConfirmed: false,
    customText: ""
  });
  const [submit, setSubmit] = useState<{ status: "idle" | "loading" | "ready" | "error"; message?: string; url?: string; delivery?: CreatedDeliveryRecord }>({ status: "idle" });
  const [bulkResults, setBulkResults] = useState<BulkDeliveryItemResult[]>([]);
  const [multiCredentialResults, setMultiCredentialResults] = useState<MultiCredentialDeliveryResult[]>([]);
  const selectedCredential = selectedCredentials[0];
  const selectedSourceAccounts = [...new Set(selectedCredentials.map((credential) => credential.accountId))];
  const isCustomText = form.contentType === "custom-text";
  const deliveryProviderId = form.deliveryProviderId || api.deliveryProviders[0]?.id || "";
  const deliveryAccountId = form.deliveryAccountId || (!isCustomText ? selectedCredential?.accountId : undefined) || api.accounts[0]?.id || "";
  const selectedDeliveryProvider = api.deliveryProviders.find((provider) => provider.id === deliveryProviderId);
  const capabilities = selectedDeliveryProvider?.capabilities ?? {};
  const manualHandoff = isManualHandoffProvider(selectedDeliveryProvider);
  const useBundleLink = !isCustomText && selectedCredentials.length > 1 && form.linkArrangement === "bundle";
  const selectedCredentialSetKey = selectedCredentials.map(credentialSelectionKey).join("|");
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

  function resetDeliveryOutcome() {
    setSubmit({ status: "idle" });
    setBulkResults([]);
    setMultiCredentialResults([]);
  }

  useEffect(() => {
    setForm((current) => current.bundleConfirmed ? { ...current, bundleConfirmed: false } : current);
    resetDeliveryOutcome();
  }, [selectedCredentialSetKey]);

  async function createDelivery(event: React.FormEvent) {
    event.preventDefault();
    const [firstCredential] = selectedCredentials;
    const customText = form.customText;
    if (!isCustomText && !firstCredential) {
      setSubmit({ status: "error", message: "Select one or more credentials from search before creating links." });
      return;
    }
    if (isCustomText && !customText.trim()) {
      setSubmit({ status: "error", message: "Enter the custom text before creating a secure link." });
      return;
    }
    if (!deliveryProviderId || !deliveryAccountId) {
      setSubmit({ status: "error", message: "Choose a delivery provider and delivery account." });
      return;
    }
    if (!isCustomText && manualHandoff && selectedCredentials.length > 1) {
      setSubmit({ status: "error", message: "Ente Paste manual handoff supports one credential at a time because it uses the local clipboard." });
      return;
    }
    if (useBundleLink && form.mode === "bulk") {
      setSubmit({ status: "error", message: "One bundle link is for one shared or individual handoff. Use separate links when delivering to all active people." });
      return;
    }
    if (useBundleLink && !form.bundleConfirmed) {
      setSubmit({ status: "error", message: "Confirm that the selected credentials will share one link before creating it." });
      return;
    }
    if (manualHandoff && form.mode === "bulk") {
      setSubmit({ status: "error", message: "Ente Paste manual handoff is single-delivery only because WardSen copies one credential handoff to the local clipboard." });
      return;
    }
    if (isCustomText && form.mode === "bulk") {
      setSubmit({ status: "error", message: "Custom text supports one shared or individual link. Use a credential to create a delivery for all active people." });
      return;
    }
    if (!isCustomText && form.mode === "bulk" && selectedCredentials.length > 1) {
      setSubmit({ status: "error", message: "All-active delivery uses one selected credential per batch. Select one credential before creating links for everyone." });
      return;
    }
    const expiryHours = capabilities.customExpiry === false ? 24 : Number(form.expiryHours);
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();
    setSubmit({ status: "loading", message: "Creating secure delivery..." });
    setBulkResults([]);
    setMultiCredentialResults([]);
    try {
      const payloadForCredential = (credential: CredentialSummary, operationId: string) => ({
        operationId,
        sourceProviderId: credential.providerId,
        sourceAccountId: credential.accountId,
        sourceItemId: credential.id,
        deliveryProviderId,
        deliveryAccountId,
        expiresAt,
        viewLimit: capabilities.arbitraryViewLimit ? form.viewLimit || undefined : undefined,
        viewOnce: capabilities.viewOnce ? (manualHandoff ? true : form.viewOnce) : undefined,
        hideText: capabilities.hideText ? form.hideText : undefined,
        accessPassword: capabilities.accessPassword ? form.accessPassword || undefined : undefined,
        deliveryMethod: form.deliveryMethod
      });
      if (isCustomText) {
        const created = parseCreatedDeliveryRecord(await apiSend<unknown>("/api/deliveries/custom-text", {
          body: JSON.stringify({
            operationId: newOperationId("custom-text"),
            text: customText,
            deliveryProviderId,
            deliveryAccountId,
            recipient: form.mode === "individual" && recipient ? { id: recipient.id, name: recipient.name, email: recipient.email, phone: recipient.phone } : undefined,
            expiresAt,
            viewLimit: capabilities.arbitraryViewLimit ? form.viewLimit || undefined : undefined,
            viewOnce: capabilities.viewOnce ? (manualHandoff ? true : form.viewOnce) : undefined,
            hideText: capabilities.hideText ? form.hideText : undefined,
            accessPassword: capabilities.accessPassword ? form.accessPassword || undefined : undefined,
            deliveryMethod: form.deliveryMethod
          })
        }));
        setForm((current) => ({ ...current, customText: "" }));
        setSubmit({ status: "ready", message: deliveryMessage("Custom secure text link created.", created), url: created.oneTimeDeliveryUrl, delivery: created });
      } else if (form.mode === "bulk") {
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
        const payload = payloadForCredential(firstCredential, newOperationId("bulk"));
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
      } else if (useBundleLink) {
        const created = parseCreatedDeliveryRecord(await apiSend<unknown>("/api/deliveries/bundle", {
          body: JSON.stringify({
            operationId: newOperationId("bundle"),
            sourceCredentials: selectedCredentials.map((credential) => ({
              sourceProviderId: credential.providerId,
              sourceAccountId: credential.accountId,
              sourceItemId: credential.id
            })),
            deliveryProviderId,
            deliveryAccountId,
            recipient: form.mode === "individual" && recipient ? { id: recipient.id, name: recipient.name, email: recipient.email, phone: recipient.phone } : undefined,
            expiresAt,
            viewLimit: capabilities.arbitraryViewLimit ? form.viewLimit || undefined : undefined,
            viewOnce: capabilities.viewOnce ? form.viewOnce : undefined,
            hideText: capabilities.hideText ? form.hideText : undefined,
            accessPassword: capabilities.accessPassword ? form.accessPassword || undefined : undefined,
            deliveryMethod: form.deliveryMethod,
            confirmBundle: true
          })
        }));
        setSubmit({ status: "ready", message: deliveryMessage(`Bundle link created for ${selectedCredentials.length} credentials.`, created), url: created.oneTimeDeliveryUrl, delivery: created });
      } else if (selectedCredentials.length === 1) {
        const created = parseCreatedDeliveryRecord(await apiSend<unknown>("/api/deliveries", {
          body: JSON.stringify({
            ...payloadForCredential(firstCredential, newOperationId("delivery")),
            recipient: form.mode === "individual" && recipient ? { id: recipient.id, name: recipient.name, email: recipient.email, phone: recipient.phone } : undefined
          })
        }));
        setSubmit({ status: "ready", message: deliveryMessage("Delivery created.", created), url: created.oneTimeDeliveryUrl, delivery: created });
      } else {
        const handoffTarget = form.mode === "individual" && recipient ? recipient.name : "a shared handoff";
        if (!window.confirm(`Create ${selectedCredentials.length} separate secure links for ${handoffTarget}? Each link grants access to one credential only.`)) {
          setSubmit({ status: "idle" });
          return;
        }
        const results = await Promise.all(selectedCredentials.map(async (credential): Promise<MultiCredentialDeliveryResult> => {
          try {
            const delivery = parseCreatedDeliveryRecord(await apiSend<unknown>("/api/deliveries", {
              body: JSON.stringify({
                ...payloadForCredential(credential, newOperationId("delivery")),
                recipient: form.mode === "individual" && recipient ? { id: recipient.id, name: recipient.name, email: recipient.email, phone: recipient.phone } : undefined
              })
            }));
            return { credential, delivery };
          } catch (error) {
            return { credential, error: error instanceof Error ? error.message : String(error) };
          }
        }));
        const completedCount = results.filter((result) => result.delivery).length;
        setMultiCredentialResults(results);
        setSubmit({
          status: completedCount > 0 ? "ready" : "error",
          message: `${completedCount}/${results.length} separate credential links created${completedCount === results.length ? "." : "; review failed rows below."}`
        });
      }
      await api.refresh();
    } catch (error) {
      setSubmit({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <form className="panel composer" onSubmit={createDelivery}>
      <PanelTitle icon={Send} title="Delivery Form" action="Create" />
      <div className="segmented contentType" role="group" aria-label="Delivery content type">
        <button type="button" aria-pressed={!isCustomText} className={!isCustomText ? "selected" : ""} onClick={() => { resetDeliveryOutcome(); setForm((current) => ({ ...current, contentType: "credential", bundleConfirmed: false })); }}>Credential</button>
        <button type="button" aria-pressed={isCustomText} className={isCustomText ? "selected" : ""} onClick={() => { resetDeliveryOutcome(); setForm((current) => ({ ...current, contentType: "custom-text", mode: current.mode === "bulk" ? "shared" : current.mode, bundleConfirmed: false })); }}>Custom text</button>
      </div>
      {isCustomText ? (
        <label className="wide">Custom text<textarea name="customText" value={form.customText} onChange={(event) => setForm((current) => ({ ...current, customText: event.target.value }))} placeholder="Enter the text to send in this secure link" maxLength={16 * 1024} rows={5} /></label>
      ) : <>
        <label>Source vault<input name="sourceVault" value={selectedCredentials.length === 0 ? "Select from credential search" : selectedSourceAccounts.length === 1 ? accountLabel(api.accounts, selectedSourceAccounts[0]!) : `${selectedSourceAccounts.length} selected source vaults`} readOnly /></label>
        <label>Selected credentials<input name="selectedCredentials" value={selectedCredentials.length === 0 ? "Select from credential search" : selectedCredentials.length === 1 ? `${selectedCredential!.title} (${accountLabel(api.accounts, selectedCredential!.accountId)})` : `${selectedCredentials.length} selected: ${selectedCredentials.slice(0, 2).map((credential) => credential.title).join(", ")}${selectedCredentials.length > 2 ? " and more" : ""}`} readOnly /></label>
      </>}
      <label>Recipient<select name="recipientId" value={form.personId} disabled={form.mode !== "individual"} onChange={(event) => setForm((current) => ({ ...current, personId: event.target.value }))}>
        <option value="">{recipientPlaceholder}</option>
        {activePeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
      </select></label>
      <label>Delivery provider<select name="deliveryProviderId" value={deliveryProviderId} onChange={(event) => setForm((current) => ({ ...current, deliveryProviderId: event.target.value }))}>
        {api.deliveryProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.displayName}</option>)}
      </select></label>
      <small className="fieldInstruction wide">Only active delivery integrations are selectable. Check Settings &gt; Provider Capabilities for provider limits and planned candidates.</small>
      <label>{deliveryProviderId === "bitwarden-send" ? "Delivery account" : "Audit account"}<select name="deliveryAccountId" value={deliveryAccountId} onChange={(event) => setForm((current) => ({ ...current, deliveryAccountId: event.target.value }))}>
        {api.accounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
      </select></label>
      {deliveryProviderId !== "bitwarden-send" ? <small className="fieldInstruction wide">This provider reads its setup from the local WardSen service environment. The selected audit account scopes metadata only; it does not supply the provider API credential.</small> : null}
      <div className="segmented" role="group" aria-label="Delivery recipient mode">
        <button type="button" aria-pressed={form.mode === "shared"} className={form.mode === "shared" ? "selected" : ""} onClick={() => { resetDeliveryOutcome(); setForm((current) => ({ ...current, mode: "shared", personId: "" })); }}>Shared</button>
        <button type="button" aria-pressed={form.mode === "individual"} className={form.mode === "individual" ? "selected" : ""} onClick={() => { resetDeliveryOutcome(); setForm((current) => ({ ...current, mode: "individual", personId: current.personId || activePeople[0]?.id || "" })); }}>Individual</button>
        <button type="button" aria-pressed={form.mode === "bulk"} disabled={isCustomText || manualHandoff || selectedCredentials.length > 1} title={isCustomText ? "Custom text is shared or individual only" : selectedCredentials.length > 1 ? "All-active delivery uses one selected credential per batch" : undefined} className={form.mode === "bulk" ? "selected" : ""} onClick={() => { resetDeliveryOutcome(); setForm((current) => ({ ...current, mode: "bulk", personId: "" })); }}>All active</button>
      </div>
      {!isCustomText && selectedCredentials.length > 1 ? (
        <div className="segmented linkArrangement" role="group" aria-label="Credential link arrangement">
          <button type="button" aria-pressed={form.linkArrangement === "separate"} className={form.linkArrangement === "separate" ? "selected" : ""} onClick={() => { resetDeliveryOutcome(); setForm((current) => ({ ...current, linkArrangement: "separate", bundleConfirmed: false })); }}>Separate links</button>
          <button type="button" aria-pressed={form.linkArrangement === "bundle"} disabled={manualHandoff || form.mode === "bulk"} title={manualHandoff ? "Manual Ente Paste cannot safely group credentials" : form.mode === "bulk" ? "One bundle link is limited to a shared or individual handoff" : undefined} className={form.linkArrangement === "bundle" ? "selected" : ""} onClick={() => { resetDeliveryOutcome(); setForm((current) => ({ ...current, linkArrangement: "bundle", bundleConfirmed: false })); }}>One bundle link</button>
        </div>
      ) : null}
      <label>Expiry<select name="expiryHours" value={capabilities.customExpiry === false ? "24" : form.expiryHours} disabled={capabilities.customExpiry === false} onChange={(event) => setForm((current) => ({ ...current, expiryHours: event.target.value }))}>
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
      <label className="check"><input name="viewOnce" checked={capabilities.viewOnce ? (manualHandoff ? true : form.viewOnce) : false} disabled={!capabilities.viewOnce || manualHandoff} type="checkbox" onChange={(event) => setForm((current) => ({ ...current, viewOnce: event.target.checked }))} /> View once</label>
      <label className="check"><input name="hideText" checked={capabilities.hideText ? form.hideText : false} disabled={!capabilities.hideText} type="checkbox" onChange={(event) => setForm((current) => ({ ...current, hideText: event.target.checked }))} /> Hide text in provider link</label>
      <label>Access password<input name="accessPassword" value={capabilities.accessPassword ? form.accessPassword : ""} disabled={!capabilities.accessPassword} onChange={(event) => setForm((current) => ({ ...current, accessPassword: event.target.value }))} placeholder="Optional provider password" type="password" /></label>
      {form.mode === "bulk" && selectedCredential && selectedCredentials.length === 1 && (
        <div className="riskSummary">
          <strong>Bulk confirmation summary</strong>
          <span>{bulkSummary}</span>
          <span>Expiry and view limits control link access; they cannot stop someone from saving a viewed credential.</span>
        </div>
      )}
      {selectedCredentials.length > 1 && form.mode === "bulk" ? (
        <div className="riskSummary">
          <strong>All-active delivery needs one credential</strong>
          <span>Choose one credential for a per-recipient batch. This prevents one action from creating a large credentials-by-people set of links.</span>
        </div>
      ) : null}
      {isCustomText ? (
        <div className="riskSummary">
          <strong>Custom secure text</strong>
          <span>The text is sent directly to the selected provider. WardSen stores only the neutral history label "Custom secure text", not the text itself.</span>
        </div>
      ) : null}
      {useBundleLink ? (
        <div className="riskSummary">
          <strong>One bundle link</strong>
          <span>This link contains {selectedCredentials.length} selected credentials. It uses only title, username and password, and excludes notes, TOTP and URLs.</span>
          <label className="checkboxLine"><input name="confirmBundle" type="checkbox" checked={form.bundleConfirmed} onChange={(event) => setForm((current) => ({ ...current, bundleConfirmed: event.target.checked }))} /> I understand that one recipient link will contain all {selectedCredentials.length} selected credentials.</label>
        </div>
      ) : null}
      {!isCustomText && manualHandoff && selectedCredentials.length > 1 ? (
        <div className="riskSummary">
          <strong>Ente Paste needs one credential</strong>
          <span>Manual handoff writes one credential to the local clipboard. Select one credential before using Ente Paste.</span>
        </div>
      ) : null}
      {manualHandoff && (
        <div className="riskSummary">
          <strong>Ente Paste manual handoff</strong>
          <span>{isCustomText ? "WardSen copies the custom text to the local clipboard, shows an Open Ente Paste action, and records this as handoff pending. Paste into Ente, create the one-time link there, then send Ente's generated link to the recipient." : "WardSen copies only the credential title, username and password to the local clipboard, shows an Open Ente Paste action, and records this as handoff pending. Paste into Ente, create the one-time link there, then send Ente's generated link to the recipient."}</span>
          <span>WardSen cannot verify views, access counts, IP/device details, or revoke Ente Paste links.</span>
        </div>
      )}
      {submit.status === "error" && <ErrorNotice message={submit.message} compact />}
      {submit.status !== "idle" && submit.status !== "error" && (
        <div className="notice compact" role="status" aria-live="polite">
          {submit.message}
          {submit.url && <DeliveryLinkAction
            delivery={submit.delivery}
            url={submit.url}
            label={isCustomText ? "Copy secure text link" : useBundleLink ? "Copy bundle link" : form.mode === "shared" ? "Copy shared link" : "Copy link"}
            method={form.deliveryMethod}
            recipient={form.mode === "individual" ? recipient : undefined}
          />}
        </div>
      )}
      {bulkResults.length > 0 && (
        <BulkHandoffResults
          results={bulkResults}
          personName={personName}
          personFor={(id) => api.people.find((person) => person.id === id)}
          method={form.deliveryMethod}
          onCopy={(url) => copyTextToClipboard(url)}
        />
      )}
      {multiCredentialResults.length > 0 && (
        <MultiCredentialHandoffResults
          results={multiCredentialResults}
          accounts={api.accounts}
          method={form.deliveryMethod}
          recipient={form.mode === "individual" ? recipient : undefined}
        />
      )}
      <button className="primary full" disabled={submit.status === "loading" || (!isCustomText && selectedCredentials.length === 0) || (isCustomText && !form.customText.trim()) || (form.mode === "individual" && !recipient) || (manualHandoff && (form.mode === "bulk" || (!isCustomText && selectedCredentials.length > 1))) || (!isCustomText && form.mode === "bulk" && selectedCredentials.length > 1) || (useBundleLink && !form.bundleConfirmed)}>
        <Send size={16} aria-hidden="true" /> {isCustomText ? "Create secure text link" : useBundleLink ? "Create bundle link" : form.mode === "bulk" || selectedCredentials.length > 1 ? "Create secure links" : "Create secure link"}
      </button>
    </form>
  );
}

function DeliveryTable({ api, confirmDestructiveAction }: { api: ReturnType<typeof useWardSenApi>; confirmDestructiveAction: DestructiveConfirmation }) {
  const [message, setMessage] = useState<{ status: "idle" | "loading" | "ready" | "error"; text?: string; url?: string; delivery?: CreatedDeliveryRecord }>({ status: "idle" });
  const statusRefreshBlockedAccountLabels = blockedLiveStatusRefreshAccountLabels(api.deliveries, api.accounts);

  async function rowAction(delivery: DeliveryRecord, action: DeliveryHistoryAction) {
    setMessage({ status: "loading", text: `${titleStatus(action)} running for ${delivery.credentialName}...` });
    try {
      if (action === "refresh") {
        if (!deliveryProviderSupports(api.deliveryProviders, delivery.deliveryProviderId, "statusLookup")) {
          setMessage({ status: "error", text: `${delivery.deliveryProviderId} does not expose sender-visible status checks through WardSen.` });
          return;
        }
        const summary = await refreshSupportedDeliveryStatuses([delivery], api.deliveryProviders, api.accounts);
        setMessage({ status: summary.failed ? "error" : "ready", text: refreshSummaryText(summary) });
      }
      if (action === "retry") {
        const retried = parseCreatedDeliveryRecord(await apiSend<unknown>(`/api/deliveries/${delivery.id}/retry`));
        setMessage({ status: "ready", text: deliveryMessage(`Retry created for ${delivery.credentialName}.`, retried), url: retried.oneTimeDeliveryUrl, delivery: retried });
      }
      if (action === "revoke") {
        if (!deliveryProviderSupports(api.deliveryProviders, delivery.deliveryProviderId, "revokeLink")) {
          setMessage({ status: "error", text: `${delivery.deliveryProviderId} does not expose sender-side revoke through WardSen.` });
          return;
        }
        const confirm = `REVOKE DELIVERY ${delivery.id}`;
        const confirmed = await confirmDestructivePreview(confirmDestructiveAction, confirm, `/api/deliveries/${encodeURIComponent(delivery.id)}/operation-preview`, `Revoke the provider link for "${delivery.credentialName}"? Recipients may lose access immediately.`);
        if (!confirmed) {
          setMessage({ status: "idle" });
          return;
        }
        const revoked = parseDeliveryRecord(await apiSend<unknown>(`/api/deliveries/${delivery.id}`, { method: "DELETE", body: JSON.stringify({ confirm }) }));
        setMessage({ status: "ready", text: `${delivery.credentialName}: ${titleStatus(revoked.status)}.` });
      }
      await api.refresh();
    } catch (error) {
      setMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  async function refreshAll() {
    setMessage({ status: "loading", text: "Refreshing provider status for live deliveries..." });
    try {
      const summary = await refreshSupportedDeliveryStatuses(api.deliveries, api.deliveryProviders, api.accounts);
      setMessage({ status: summary.failed ? "error" : "ready", text: refreshSummaryText(summary) });
      await api.refresh();
    } catch (error) {
      setMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <div className="grid">
      <LiveStatusUnlockNotice accountLabels={statusRefreshBlockedAccountLabels} />
      {message.status === "error" && <ErrorNotice message={message.text} compact />}
      {message.status !== "idle" && message.status !== "error" && (
        <div className="notice compact" role="status" aria-live="polite">
          {message.text}
          {message.url && <DeliveryLinkAction delivery={message.delivery} url={message.url} label="Copy retry link" copiedLabel="Retry link copied" />}
        </div>
      )}
      <DeliveryHistoryTable
        deliveries={api.deliveries}
        people={api.people}
        canRefresh={(delivery) => deliveryProviderSupports(api.deliveryProviders, delivery.deliveryProviderId, "statusLookup")}
        canRevoke={(delivery) => deliveryProviderSupports(api.deliveryProviders, delivery.deliveryProviderId, "revokeLink")}
        onAction={(delivery, action) => void rowAction(delivery, action)}
        onRefreshActive={() => void refreshAll()}
        statusRefreshBlockedAccountLabels={statusRefreshBlockedAccountLabels}
      />
    </div>
  );
}

function CopyFeedbackButton({
  value,
  label,
  copiedLabel = "Link copied",
  copiedStatus = "Copied to clipboard.",
  onCopy,
  onCopied,
  disabled = false
}: {
  value: string;
  label: string;
  copiedLabel?: string;
  copiedStatus?: string;
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
      {state === "copied" ? <small className="copyFeedbackStatus" role="status" aria-live="polite">{copiedStatus}</small> : null}
      {state === "error" ? <small className="copyFeedbackError" role="alert">Copy was blocked. Try again or copy the link manually.</small> : null}
    </span>
  );
}

function DeliveryLinkAction({
  delivery,
  url,
  label,
  copiedLabel = "Link copied",
  method = delivery?.deliveryMethod ?? "copy",
  recipient
}: {
  delivery?: Pick<CreatedDeliveryRecord, "credentialName" | "deliveryMethod" | "deliveryProviderId" | "status">;
  url: string;
  label: string;
  copiedLabel?: string;
  method?: "copy" | "whatsapp" | "email";
  recipient?: Pick<PersonRecord, "email" | "phone">;
}) {
  const [clipboardState, setClipboardState] = useState<"idle" | "clearing" | "cleared" | "error">("idle");
  const [handoffState, setHandoffState] = useState<"idle" | "ready" | "error">("idle");

  async function clearManualClipboard() {
    const providerId = delivery?.deliveryProviderId;
    if (!providerId) return;
    setClipboardState("clearing");
    try {
      await apiSend(`/api/delivery-providers/${encodeURIComponent(providerId)}/clear-handoff-clipboard`, { body: "{}" });
      setClipboardState("cleared");
    } catch {
      setClipboardState("error");
    }
  }

  async function openHandoff() {
    setHandoffState("idle");
    try {
      await copyAndOpenDeliveryHandoff(method, url, delivery?.credentialName, recipient);
      setHandoffState("ready");
    } catch {
      setHandoffState("error");
    }
  }

  if (isManualHandoffDelivery(delivery)) {
    return (
      <span className="copyFeedback manualHandoffAction">
        <button type="button" disabled={!url} onClick={() => void openExternalUrl(url)}>
          <Send size={15} aria-hidden="true" /> Open Ente Paste
        </button>
        <CopyFeedbackButton value={url} label="Copy Ente page URL" copiedLabel="Ente URL copied" />
        {delivery?.deliveryProviderId ? <button type="button" disabled={clipboardState === "clearing" || clipboardState === "cleared"} onClick={() => void clearManualClipboard()}>
          <Trash2 size={15} aria-hidden="true" /> {clipboardState === "cleared" ? "Clipboard cleared" : "Clear clipboard"}
        </button> : null}
        {clipboardState === "error" ? <small className="copyFeedbackError" role="alert">WardSen could not clear the local clipboard.</small> : null}
        <small className="copyFeedbackStatus" role="status" aria-live="polite">{clipboardState === "cleared" ? "Local clipboard cleared." : "Credential text was copied to the local clipboard. Paste it into Ente, then clear the clipboard before sending Ente's generated one-time link."}</small>
      </span>
    );
  }

  return (
    <span className="copyFeedback deliveryHandoffAction">
      <CopyFeedbackButton value={url} label={label} copiedLabel={copiedLabel} />
      {method !== "copy" ? <button type="button" disabled={!url} onClick={() => void openHandoff()}>
        {method === "email" ? <Mail size={15} aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
        {method === "email" ? "Copy and open email" : "Copy and open WhatsApp"}
      </button> : null}
      {handoffState === "ready" ? <small className="copyFeedbackStatus" role="status" aria-live="polite">{method === "email" ? "Link copied; email draft opened." : "Link copied; WhatsApp opened."}</small> : null}
      {handoffState === "error" ? <small className="copyFeedbackError" role="alert">WardSen could not copy the link or open the selected handoff app.</small> : null}
    </span>
  );
}

function MultiCredentialHandoffResults({
  results,
  accounts,
  method,
  recipient
}: {
  results: MultiCredentialDeliveryResult[];
  accounts: AccountRecord[];
  method: "copy" | "whatsapp" | "email";
  recipient?: Pick<PersonRecord, "email" | "phone">;
}) {
  const createdCount = results.filter((result) => result.delivery).length;
  return (
    <section className="multiCredentialHandoff">
      <div className="riskSummary">
        <strong>Separate credential links</strong>
        <span>{createdCount}/{results.length} links created. Each successful row has its own link and handoff action.</span>
      </div>
      <div className="multiCredentialResultList" aria-label="Separate credential link results">
        {results.map((result) => (
          <article className="multiCredentialResult" key={credentialSelectionKey(result.credential)}>
            {result.delivery ? <DeliveryLinkAction
              delivery={result.delivery}
              url={result.delivery.oneTimeDeliveryUrl}
              label="Copy link"
              method={method}
              recipient={recipient}
            /> : <span className="multiCredentialError">{result.error ?? "Delivery creation failed."}</span>}
            <div>
              <strong>{result.credential.title}</strong>
              <span>{accountLabel(accounts, result.credential.accountId)}</span>
            </div>
            <Status value={result.delivery ? "Created" : "Failed"} />
          </article>
        ))}
      </div>
    </section>
  );
}

function BulkHandoffResults({
  results,
  personName,
  personFor,
  method,
  onCopy
}: {
  results: BulkDeliveryItemResult[];
  personName: (id?: string) => string;
  personFor: (id?: string) => PersonRecord | undefined;
  method: "copy" | "whatsapp" | "email";
  onCopy: (url: string) => Promise<void>;
}) {
  const [handoffStatus, setHandoffStatus] = useState<Record<string, string>>({});

  async function openDraft(result: BulkDeliveryItemResult) {
    const delivery = result.delivery;
    if (!delivery?.oneTimeDeliveryUrl) return;
    try {
      const status = await copyAndOpenDeliveryHandoff(method, delivery.oneTimeDeliveryUrl, delivery.credentialName, personFor(result.recipientId), onCopy);
      setHandoffStatus((current) => ({ ...current, [resultKey(result)]: status }));
    } catch {
      setHandoffStatus((current) => ({ ...current, [resultKey(result)]: "Copy failed or WardSen could not open the selected handoff app" }));
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
                <button type="button" disabled={!url || method === "copy"} onClick={() => void openDraft(result)}>
                  {method === "email" ? <Mail size={15} aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
                  {method === "email" ? "Copy and open email" : "Copy and open WhatsApp"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function resultKey(result: BulkDeliveryItemResult): string {
  return result.recipientId ?? result.delivery?.id ?? result.error ?? "bulk-result";
}

async function copyAndOpenDeliveryHandoff(
  method: "copy" | "whatsapp" | "email",
  url: string,
  credentialName?: string,
  recipient?: Pick<PersonRecord, "email" | "phone">,
  copy: (value: string) => Promise<void> = copyTextToClipboard
): Promise<string> {
  await copy(url);
  if (method === "email") {
    await openMailDraft(deliveryHandoffMailtoHref(credentialName, recipient?.email));
    return "Link copied; email draft opened";
  }
  if (method === "whatsapp") {
    await openExternalUrl(deliveryWhatsAppHref(recipient?.phone));
    return "Link copied; WhatsApp opened";
  }
  return "Link copied";
}

function deliveryHandoffMailtoHref(credentialName?: string, recipientEmail?: string): string {
  const recipient = recipientEmail ? encodeURIComponent(recipientEmail) : "";
  const subject = encodeURIComponent(`WardSen delivery: ${credentialName ?? "secure link"}`);
  const body = encodeURIComponent("Paste the WardSen delivery link copied to your clipboard. Do not forward this message after the recipient opens it.");
  return `mailto:${recipient}?subject=${subject}&body=${body}`;
}

function deliveryWhatsAppHref(recipientPhone?: string): string {
  const phone = recipientPhone?.replace(/\D/g, "") ?? "";
  return phone ? `https://wa.me/${phone}` : "https://wa.me/";
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

function PanelTitle({ icon: Icon, title, action, onAction }: { icon: React.ElementType; title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="panelTitle">
      <h2><Icon size={18} aria-hidden="true" /> {title}</h2>
      {action && onAction ? <button type="button" onClick={onAction}>{action}</button> : null}
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
                ? "Terminal command copied. Paste it into Terminal or PowerShell, run it, then WardSen will update the account automatically."
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

async function confirmDestructivePreview(confirm: DestructiveConfirmation, phrase: string, previewPath: string, fallback: string): Promise<boolean> {
  const preview = await apiGet<OperationImpactPreview>(previewPath);
  return confirm(phrase, formatOperationImpactPreview(preview, fallback));
}

function formatOperationImpactPreview(preview: OperationImpactPreview, fallback: string): string {
  const { impact } = preview;
  const lines = [
    "Impact preview",
    fallback,
    `Delivery links: ${impact.activeDeliveryCount}/${impact.deliveryCount} still active or pending.`,
    previewList("Affected people", impact.affectedPeople),
    previewList("Resources", impact.resources),
    previewList("Providers", impact.providers)
  ];
  if (impact.batch) {
    lines.push(`Batch: ${impact.batch.completedCount}/${impact.batch.requestedCount} created; ${impact.batch.failedCount} failed${impact.batch.cancelled ? "; already cancelled" : ""}.`);
  }
  return lines.join("\n\n");
}

function previewList(label: string, values: string[]): string {
  if (values.length === 0) return `${label}: none.`;
  const visible = values.slice(0, 8);
  return `${label}: ${visible.join(", ")}${values.length > visible.length ? ` and ${values.length - visible.length} more` : ""}.`;
}

function useDestructiveConfirmation() {
  const [request, setRequest] = useState<{ phrase: string; message: string; resolve: (confirmed: boolean) => void }>();

  function confirm(phrase: string, message: string): Promise<boolean> {
    return new Promise((resolve) => setRequest({ phrase, message, resolve }));
  }

  function finish(confirmed: boolean) {
    const current = request;
    setRequest(undefined);
    current?.resolve(confirmed);
  }

  return {
    confirm,
    dialog: request ? (
      <DestructiveConfirmationDialog
        phrase={request.phrase}
        message={request.message}
        onCancel={() => finish(false)}
        onConfirm={() => finish(true)}
      />
    ) : null
  };
}

function DestructiveConfirmationDialog({ phrase, message, onCancel, onConfirm }: { phrase: string; message: string; onCancel: () => void; onConfirm: () => void }) {
  const [typedPhrase, setTypedPhrase] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const isConfirmed = typedPhrase === phrase;

  useEffect(() => {
    inputRef.current?.focus();
  }, [phrase]);

  return (
    <div className="confirmationBackdrop" role="presentation">
      <form className="confirmationDialog" role="dialog" aria-modal="true" aria-labelledby="destructive-confirmation-title" onSubmit={(event) => {
        event.preventDefault();
        if (isConfirmed) onConfirm();
      }}>
        <h2 id="destructive-confirmation-title">Confirm exact action</h2>
        <p>{message}</p>
        <label>
          Type the confirmation phrase to continue
          <code>{phrase}</code>
          <input ref={inputRef} value={typedPhrase} onChange={(event) => setTypedPhrase(event.target.value)} autoComplete="off" spellCheck="false" aria-describedby="destructive-confirmation-help" />
        </label>
        <small id="destructive-confirmation-help">The local service will reject this action unless the phrase matches exactly.</small>
        <div className="buttonRow confirmationActions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="dangerAction" disabled={!isConfirmed}>Confirm</button>
        </div>
      </form>
    </div>
  );
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
    `Port ${status.port}: ${status.portOpen ? "open" : "not reachable"}`,
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

function breakGlassRequestPayload(form: { breakGlass: boolean; breakGlassJustification: string }, catalogEntryId: string) {
  if (!form.breakGlass) return {};
  return {
    breakGlass: true,
    breakGlassJustification: form.breakGlassJustification.trim(),
    confirmRiskSummary: true,
    confirm: `BREAK GLASS ${catalogEntryId}`
  };
}

function confirmBreakGlassSubmission(credentialName: string, assignedEmail: string): boolean {
  return window.confirm(`Submit emergency break-glass request for ${credentialName} and ${assignedEmail}?\n\nWardSen will mark this as emergency access, record the justification in the audit trail, and still require admin fulfillment before any delivery link is created.`);
}

function deliveryOptionsForProvider(provider: ProviderInfo | undefined, form: { expiryHours: string; viewLimit: string; viewOnce: boolean }) {
  const capabilities = provider?.capabilities ?? {};
  const expiryHours = capabilities.customExpiry === false ? 24 : Number(form.expiryHours) || 24;
  return {
    expiresAt: new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString(),
    viewLimit: capabilities.arbitraryViewLimit ? form.viewLimit || undefined : undefined,
    viewOnce: capabilities.viewOnce ? (isManualHandoffProvider(provider) ? true : form.viewOnce) : undefined
  };
}

function approvalConfirmationMessage(action: string, accessRequest: CredentialAccessRequestRecord, provider?: ProviderInfo): string {
  if (isManualHandoffProvider(provider)) {
    return `${action} ${accessRequest.credentialName} for ${accessRequest.assignedEmail}?\n\nWardSen will copy the credential text to the local clipboard and mark the delivery handoff pending. You must create the one-time Ente Paste link in the browser and send that generated link to the assigned employee email.`;
  }
  return `${action} ${accessRequest.credentialName} for ${accessRequest.assignedEmail}?\n\nWardSen will create a one-access email delivery link for this assigned employee email.`;
}

function replacementConfirmationMessage(accessRequest: CredentialAccessRequestRecord, provider?: ProviderInfo): string {
  if (isManualHandoffProvider(provider)) {
    return `Replace the delivery link for ${accessRequest.credentialName} and ${accessRequest.assignedEmail}?\n\nWardSen will revoke the previous provider link when supported, then copy the credential text to the local clipboard for a new manual Ente Paste handoff.`;
  }
  return `Replace the delivery link for ${accessRequest.credentialName} and ${accessRequest.assignedEmail}?\n\nWardSen will revoke the previous link before creating a fresh one-access email delivery.`;
}

function employeeSignInMailtoHref(draft: { to: string; subject: string }): string {
  return `mailto:${encodeURIComponent(draft.to)}?subject=${encodeURIComponent(draft.subject)}`;
}

function providerLabel(providers: ProviderInfo[], providerId: string) {
  return providers.find((provider) => provider.id === providerId)?.displayName ?? providerId;
}

function providerTelemetryLabel(readiness: DeliveryReadiness): string {
  return [
    `Status ${titleStatus(readiness.statusLookup)}`,
    `access ${titleStatus(readiness.accessCount)}`,
    `viewer ${titleStatus(readiness.viewerIdentity)}`
  ].join(" / ");
}

function isManualHandoffProvider(provider?: ProviderInfo): boolean {
  return provider?.delivery?.secureLinkCreation === "manual";
}

function isManualHandoffDelivery(delivery?: Pick<CreatedDeliveryRecord, "deliveryProviderId" | "status">): boolean {
  return delivery?.deliveryProviderId === "ente-paste" || delivery?.status === "handoff_pending";
}

function deliveryProviderSupports(providers: ProviderInfo[], providerId: string, capability: string): boolean {
  return providers.find((provider) => provider.id === providerId)?.capabilities?.[capability] === true;
}

interface DeliveryRefreshSummary {
  total: number;
  refreshed: number;
  blocked: number;
  blockedAccountLabels: string[];
  failed: number;
  failureDetail?: string;
}

function isBitwardenStatusRefreshBlocked(delivery: DeliveryRecord, accounts: AccountRecord[]): boolean {
  if (delivery.deliveryProviderId !== "bitwarden-send") return false;
  return accounts.find((account) => account.id === delivery.deliveryAccountId)?.status !== "unlocked";
}

function isLiveStatusRefreshCandidate(delivery: DeliveryRecord): boolean {
  return delivery.status === "active" || delivery.status === "viewed";
}

function blockedLiveStatusRefreshAccountLabels(deliveries: DeliveryRecord[], accounts: AccountRecord[]): string[] {
  return [...new Set(deliveries
    .filter(isLiveStatusRefreshCandidate)
    .filter((delivery) => isBitwardenStatusRefreshBlocked(delivery, accounts))
    .map((delivery) => accounts.find((account) => account.id === delivery.deliveryAccountId)?.label ?? "the selected Bitwarden vault"))];
}

function LiveStatusUnlockNotice({ accountLabels, wide = false }: { accountLabels: string[]; wide?: boolean }) {
  if (accountLabels.length === 0) return null;
  return (
    <div className={`notice compact liveStatusUnlockNotice${wide ? " wide" : ""}`} role="status">
      <strong>Unlock a vault to refresh view counts</strong>
      <span>Unlock {accountLabels.join(", ")} in Vaults, then select Refresh live status. WardSen needs that Bitwarden session to query Bitwarden Send; Reload history only shows locally saved results.</span>
    </div>
  );
}

async function refreshSupportedDeliveryStatuses(deliveries: DeliveryRecord[], providers: ProviderInfo[], accounts: AccountRecord[]): Promise<DeliveryRefreshSummary> {
  const live = deliveries.filter((delivery) => isLiveStatusRefreshCandidate(delivery) && deliveryProviderSupports(providers, delivery.deliveryProviderId, "statusLookup"));
  if (live.length === 0) return { total: 0, refreshed: 0, blocked: 0, blockedAccountLabels: [], failed: 0 };
  const blocked = live.filter((delivery) => isBitwardenStatusRefreshBlocked(delivery, accounts));
  const refreshable = live.filter((delivery) => !isBitwardenStatusRefreshBlocked(delivery, accounts));
  const results = await Promise.allSettled(refreshable.map(async (delivery) => parseDeliveryRecord(await apiSend<unknown>(`/api/deliveries/${delivery.id}/refresh`))));
  const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  return {
    total: live.length,
    refreshed: results.length - rejected.length,
    blocked: blocked.length,
    blockedAccountLabels: [...new Set(blocked.map((delivery) => accounts.find((account) => account.id === delivery.deliveryAccountId)?.label ?? "the selected Bitwarden vault"))],
    failed: rejected.length,
    failureDetail: rejected[0]?.reason instanceof Error ? rejected[0].reason.message : rejected[0] ? String(rejected[0].reason) : undefined
  };
}

function refreshSummaryText(summary: DeliveryRefreshSummary): string {
  if (summary.total === 0) return "No live links support a provider status refresh. Expired and historical deliveries remain visible below.";
  const detail = [
    summary.blocked ? `${summary.blocked} waiting for ${summary.blockedAccountLabels.join(", ")} to be unlocked` : undefined,
    summary.failed ? `${summary.failed} failed${summary.failureDetail ? `: ${summary.failureDetail}` : ""}` : undefined
  ].filter(Boolean);
  return `Refreshed ${summary.refreshed}/${summary.total} live deliveries${detail.length ? `; ${detail.join("; ")}.` : "."}`;
}

function deliveryMessage(message: string, delivery?: Pick<CreatedDeliveryRecord, "deliveryProviderId" | "status">): string {
  return isManualHandoffDelivery(delivery)
    ? `${message} Ente Paste handoff is pending; create the Ente link in the browser before sending anything to the recipient.`
    : message;
}

function newOperationId(prefix: "delivery" | "bulk" | "bundle" | "custom-text"): string {
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
