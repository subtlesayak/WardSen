import React, { useEffect, useMemo, useState } from "react";
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
  Vault
} from "lucide-react";
import { apiGet, apiSend, apiUrl } from "./api";
import { describeError } from "./errorHelp";
import "./styles.css";

type NavItem = "Overview" | "Vaults" | "Credentials" | "People" | "Deliveries" | "Settings";
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

interface CreatedDeliveryRecord extends DeliveryRecord {
  oneTimeDeliveryUrl: string;
}

interface BulkDeliveryResult {
  batchId: string;
  requestedCount: number;
  completedCount: number;
  failedCount: number;
}

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
  credentialProviders: ProviderInfo[];
  deliveryProviders: ProviderInfo[];
  accounts: AccountRecord[];
  people: PersonRecord[];
  deliveries: DeliveryRecord[];
  batches: DeliveryBatchRecord[];
}

const navItems: Array<{ id: NavItem; icon: React.ElementType }> = [
  { id: "Overview", icon: ShieldCheck },
  { id: "Vaults", icon: Vault },
  { id: "Credentials", icon: KeyRound },
  { id: "People", icon: UsersRound },
  { id: "Deliveries", icon: Send },
  { id: "Settings", icon: Settings }
];

function App() {
  const [active, setActive] = useState<NavItem>("Overview");
  const api = useWardSenApi();
  const deliveryProviderId = api.deliveryProviders[0]?.id ?? "bitwarden-send";
  const deliveryCapabilities = api.deliveryProviders.find((provider) => provider.id === deliveryProviderId)?.capabilities ?? {};

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark"><ShieldCheck size={22} /></div>
          <div>
            <strong>WardSen</strong>
            <span>Local dispatch hub</span>
          </div>
        </div>
        <nav>
          {navItems.map(({ id, icon: Icon }) => (
            <button key={id} className={active === id ? "nav active" : "nav"} onClick={() => setActive(id)}>
              <Icon size={18} />
              {id}
            </button>
          ))}
        </nav>
        <p className="disclaimer">
          Independent open-source project. Not affiliated with, endorsed by or sponsored by Bitwarden, 1Password,
          Proton, KeePassXC, Keeper or their respective companies.
        </p>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>{active}</h1>
            <p>WardSen is a local-first credential dispatch hub for password managers and secure-sharing providers.</p>
          </div>
          <button className="primary" onClick={() => api.refresh()}><RefreshCcw size={16} /> Refresh</button>
        </header>

        <ApiBanner api={api} />
        {active === "Overview" && <Overview api={api} />}
        {active === "Vaults" && <Vaults api={api} />}
        {active === "Credentials" && <Credentials api={api} />}
        {active === "People" && <People api={api} />}
        {active === "Deliveries" && <Deliveries api={api} />}
        {active === "Settings" && <SettingsView providers={api.deliveryProviders} capabilities={deliveryCapabilities} />}
      </section>
    </main>
  );
}

function useWardSenApi() {
  const [state, setState] = useState<ApiState>({
    status: "loading",
    credentialProviders: [],
    deliveryProviders: [],
    accounts: [],
    people: [],
    deliveries: [],
    batches: []
  });

  async function refresh() {
    setState((current) => ({ ...current, status: "loading", error: undefined }));
    try {
      const [providers, accounts, people, deliveries, batches] = await Promise.all([
        apiGet<{ credentialProviders: ProviderInfo[]; deliveryProviders: ProviderInfo[] }>("/api/providers"),
        apiGet<AccountRecord[]>("/api/accounts"),
        apiGet<{ items: PersonRecord[] }>("/api/people?page=1&pageSize=50"),
        apiGet<{ items: DeliveryRecord[] }>("/api/deliveries?page=1&pageSize=50"),
        apiGet<{ items: DeliveryBatchRecord[] }>("/api/batches?page=1&pageSize=10")
      ]);
      setState({
        status: "ready",
        credentialProviders: providers.credentialProviders,
        deliveryProviders: providers.deliveryProviders,
        accounts,
        people: people.items,
        deliveries: deliveries.items,
        batches: batches.items
      });
    } catch (error) {
      setState((current) => ({ ...current, status: "error", error: error instanceof Error ? error.message : String(error) }));
    }
  }

  async function action(path: string, init: RequestInit = {}) {
    await apiSend(path, init);
    await refresh();
  }

  useEffect(() => {
    void refresh();
  }, []);

  return { ...state, refresh, action };
}

function ApiBanner({ api }: { api: ReturnType<typeof useWardSenApi> }) {
  if (api.status === "ready") return null;
  return (
    api.status === "loading" ? <div className="notice">Loading local WardSen data...</div> : <ErrorNotice message={api.error} />
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
    profileDirectory: "",
    autoLockMinutes: "15"
  });
  const [accessForm, setAccessForm] = useState({
    accountId: "",
    password: "",
    databasePath: "",
    keyFilePath: "",
    sso: false
  });
  const [message, setMessage] = useState<{ status: "idle" | "loading" | "ready" | "error"; text?: string }>({ status: "idle" });
  const providerLabel = (id: string) => api.credentialProviders.find((provider) => provider.id === id)?.displayName ?? id;
  const selectedAccount = api.accounts.find((account) => account.id === accessForm.accountId) ?? api.accounts[0];
  const providerId = accountForm.providerId || api.credentialProviders[0]?.id || "bitwarden";

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
          profileDirectory: accountForm.profileDirectory || undefined,
          autoLockMinutes: Number(accountForm.autoLockMinutes) || 15
        })
      });
      setAccessForm((current) => ({ ...current, accountId: account.id }));
      setAccountForm((current) => ({ ...current, label: "", username: "", serverUrl: "", profileDirectory: "" }));
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
          databasePath: accessForm.databasePath || undefined,
          keyFilePath: accessForm.keyFilePath || undefined,
          sso: accessForm.sso
        })
      });
      setMessage({ status: "ready", text: `${titleStatus(action)} completed for ${account.label}.` });
      await api.refresh();
    } catch (error) {
      setMessage({ status: "error", text: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <div className="grid">
      {message.status === "error" && <ErrorNotice message={message.text} />}
      {message.status !== "idle" && message.status !== "error" && <div className="notice">{message.text}</div>}
      <form className="panel formGrid" onSubmit={createAccount}>
        <PanelTitle icon={Vault} title="Add Vault Account" action="Refresh" onAction={api.refresh} />
        <label>Provider<select value={providerId} onChange={(event) => setAccountForm((current) => ({ ...current, providerId: event.target.value }))}>
          {api.credentialProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.displayName}</option>)}
        </select></label>
        <label>Label<input required value={accountForm.label} onChange={(event) => setAccountForm((current) => ({ ...current, label: event.target.value }))} placeholder="Work Bitwarden" /></label>
        <label>Username<input value={accountForm.username} onChange={(event) => setAccountForm((current) => ({ ...current, username: event.target.value }))} placeholder="name@example.com" /></label>
        <label>Server URL<input value={accountForm.serverUrl} onChange={(event) => setAccountForm((current) => ({ ...current, serverUrl: event.target.value }))} placeholder="Optional custom server" /></label>
        <label>Profile directory<input value={accountForm.profileDirectory} onChange={(event) => setAccountForm((current) => ({ ...current, profileDirectory: event.target.value }))} placeholder="Optional isolated profile path" /></label>
        <label>Auto-lock minutes<input value={accountForm.autoLockMinutes} onChange={(event) => setAccountForm((current) => ({ ...current, autoLockMinutes: event.target.value }))} inputMode="numeric" /></label>
        <button className="primary full"><Vault size={16} /> Add account</button>
      </form>
      <section className="panel formGrid">
        <PanelTitle icon={KeyRound} title="Account Access" action="Status" onAction={() => void accountAccess("status")} />
        <label>Account<select value={selectedAccount?.id ?? ""} onChange={(event) => setAccessForm((current) => ({ ...current, accountId: event.target.value }))}>
          {api.accounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
        </select></label>
        <label>Password<input value={accessForm.password} onChange={(event) => setAccessForm((current) => ({ ...current, password: event.target.value }))} placeholder="Master password or database password" type="password" /></label>
        <label>Database path<input value={accessForm.databasePath} onChange={(event) => setAccessForm((current) => ({ ...current, databasePath: event.target.value }))} placeholder="KeePassXC .kdbx path" /></label>
        <label>Key file path<input value={accessForm.keyFilePath} onChange={(event) => setAccessForm((current) => ({ ...current, keyFilePath: event.target.value }))} placeholder="Optional KeePassXC key file" /></label>
        <label className="check"><input checked={accessForm.sso} type="checkbox" onChange={(event) => setAccessForm((current) => ({ ...current, sso: event.target.checked }))} /> Login with SSO</label>
        <div className="buttonRow">
          <button type="button" onClick={() => void accountAccess("login")}><ShieldCheck size={16} /> Login</button>
          <button type="button" className="primary" onClick={() => void accountAccess("unlock")}><KeyRound size={16} /> Unlock</button>
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
                  <button title="Select" onClick={() => setAccessForm((current) => ({ ...current, accountId: vault.id }))}><KeyRound size={16} /></button>
                  <button title="Sync" onClick={() => api.action(`/api/accounts/${vault.id}/sync`)}><RefreshCcw size={16} /></button>
                  <button title="Lock" onClick={() => api.action(`/api/accounts/${vault.id}/lock`)}><Lock size={16} /></button>
                  <button title="Delete" onClick={() => api.action(`/api/accounts/${vault.id}`, { method: "DELETE" })}><Trash2 size={16} /></button>
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
          <select value={search.accountId} onChange={(event) => setSearch((current) => ({ ...current, accountId: event.target.value, page: 1 }))}>
            <option value="">All unlocked vaults</option>
            {api.accounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
          </select>
          <select value={search.providerId} onChange={(event) => setSearch((current) => ({ ...current, providerId: event.target.value, page: 1 }))}>
            <option value="">All providers</option>
            {api.credentialProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.displayName}</option>)}
          </select>
          <input value={search.query} onChange={(event) => setSearch((current) => ({ ...current, query: event.target.value, page: 1 }))} placeholder="Search credential names, usernames or domains" />
          <button className="primary"><Search size={16} /> Search</button>
        </form>
        {search.status === "error" && <ErrorNotice message={search.error} />}
        {search.errors.length > 0 && (
          <div className="notice">
            {search.errors.length} account search issue{search.errors.length === 1 ? "" : "s"}: {search.errors.map((error) => `${accountLabel(api.accounts, error.accountId)} (${error.providerId})`).join(", ")}.
          </div>
        )}
        {search.status === "ready" && (
          <div className="pager">
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
          {search.status === "ready" && search.items.length === 0 && <EmptyState text="No credential summaries matched this search." />}
          {search.items.map((item) => (
            <button
              className={search.selected?.id === item.id && search.selected.accountId === item.accountId ? "result selected" : "result"}
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

  return (
    <div className="grid">
      {message.status === "error" && <ErrorNotice message={message.text} />}
      {message.status !== "idle" && message.status !== "error" && <div className="notice">{message.text}</div>}
      <form className="panel formGrid" onSubmit={savePerson}>
        <PanelTitle icon={UsersRound} title="Add Person" action="Refresh" onAction={api.refresh} />
        <label>Name<input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Mira Patel" /></label>
        <label>Phone<input value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} placeholder="+1..." /></label>
        <label>Email<input value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} placeholder="mira@example.com" /></label>
        <label>Group<input value={form.groupName} onChange={(event) => setForm((current) => ({ ...current, groupName: event.target.value }))} placeholder="Ops" /></label>
        <label>Role<input value={form.role} onChange={(event) => setForm((current) => ({ ...current, role: event.target.value }))} placeholder="Admin" /></label>
        <button className="primary full"><UsersRound size={16} /> Save person</button>
      </form>
      <form className="panel formGrid" onSubmit={importPeople}>
        <PanelTitle icon={Archive} title="CSV Import" action="Export" onAction={() => window.open(apiUrl("/api/people/export"), "_blank", "noopener,noreferrer")} />
        <label className="spanAll">CSV<textarea value={csv} onChange={(event) => setCsv(event.target.value)} placeholder="name,email,phone,groupName,role&#10;Mira,mira@example.com,+1,Ops,Admin" /></label>
        <button className="primary full"><Archive size={16} /> Import CSV</button>
      </form>
      <section className="panel">
        <PanelTitle icon={UsersRound} title="People Directory" action="Export CSV" onAction={() => window.open(apiUrl("/api/people/export"), "_blank", "noopener,noreferrer")} />
        <div className="filters">
          <input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="Search people, groups, phone or email" />
          <select value={filters.groupName} onChange={(event) => setFilters((current) => ({ ...current, groupName: event.target.value }))}>
            <option value="">All groups</option>
            {groups.map((group) => <option key={group} value={group}>{group}</option>)}
          </select>
          <select value={filters.active} onChange={(event) => setFilters((current) => ({ ...current, active: event.target.value }))}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </select>
          <button onClick={() => window.open(apiUrl("/api/people/export"), "_blank", "noopener,noreferrer")}><Archive size={16} /> Export CSV</button>
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
                  <button title="Copy contact" onClick={() => navigator.clipboard?.writeText(person.email ?? person.phone ?? person.name)}><Copy size={15} /></button>
                  {person.active ? (
                    <button title="Archive" onClick={() => api.action(`/api/people/${person.id}`, { method: "DELETE" })}><Archive size={15} /></button>
                  ) : (
                    <button title="Restore" onClick={() => api.action(`/api/people/${person.id}/restore`)}><RotateCcw size={15} /></button>
                  )}
                  <button title="Delete permanently" onClick={() => api.action(`/api/people/${person.id}?hard=true`, { method: "DELETE" })}><Trash2 size={15} /></button>
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
  const deliveryProviderId = form.deliveryProviderId || api.deliveryProviders[0]?.id || "";
  const deliveryAccountId = form.deliveryAccountId || selectedCredential?.accountId || api.accounts[0]?.id || "";
  const activePeople = api.people.filter((person) => person.active);
  const recipient = activePeople.find((person) => person.id === form.personId);
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
    try {
      const payload = {
        sourceProviderId: selectedCredential.providerId,
        sourceAccountId: selectedCredential.accountId,
        sourceItemId: selectedCredential.id,
        deliveryProviderId,
        deliveryAccountId,
        expiresAt,
        viewLimit: form.viewLimit || undefined,
        viewOnce: form.viewOnce,
        hideText: form.hideText,
        accessPassword: form.accessPassword || undefined,
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
        const batch = await apiSend<BulkDeliveryResult>("/api/deliveries/bulk", {
          body: JSON.stringify({
            ...payload,
            recipients: activePeople.map((person) => ({ id: person.id, name: person.name, email: person.email, phone: person.phone })),
            concurrency: 2,
            confirmRiskSummary: true,
            largeBatchConfirmation
          })
        });
        setSubmit({
          status: batch.failedCount > 0 ? "error" : "ready",
          message: `Batch ${batch.batchId}: ${batch.completedCount}/${batch.requestedCount} links created, ${batch.failedCount} failed.`
        });
      } else {
        const created = await apiSend<CreatedDeliveryRecord>("/api/deliveries", {
          body: JSON.stringify({
            ...payload,
            recipient: form.mode === "individual" && recipient ? { id: recipient.id, name: recipient.name, email: recipient.email, phone: recipient.phone } : undefined
          })
        });
        setSubmit({ status: "ready", message: "Delivery created.", url: created.oneTimeDeliveryUrl });
      }
      await api.refresh();
    } catch (error) {
      setSubmit({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <form className="panel composer" onSubmit={createDelivery}>
      <PanelTitle icon={Send} title="Delivery Form" action="Create" />
      <label>Source vault<input value={selectedCredential ? accountLabel(api.accounts, selectedCredential.accountId) : "Select from credential search"} readOnly /></label>
      <label>Selected credential<input value={selectedCredential ? `${selectedCredential.title} (${accountLabel(api.accounts, selectedCredential.accountId)})` : "Select from credential search"} readOnly /></label>
      <label>Recipient<select value={form.personId} disabled={form.mode !== "individual"} onChange={(event) => setForm((current) => ({ ...current, personId: event.target.value }))}>
        <option value="">Shared link</option>
        {activePeople.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
      </select></label>
      <label>Delivery provider<select value={deliveryProviderId} onChange={(event) => setForm((current) => ({ ...current, deliveryProviderId: event.target.value }))}>
        {api.deliveryProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.displayName}</option>)}
      </select></label>
      <label>Delivery account<select value={deliveryAccountId} onChange={(event) => setForm((current) => ({ ...current, deliveryAccountId: event.target.value }))}>
        {api.accounts.map((account) => <option key={account.id} value={account.id}>{account.label}</option>)}
      </select></label>
      <div className="segmented">
        <button type="button" className={form.mode === "shared" ? "selected" : ""} onClick={() => setForm((current) => ({ ...current, mode: "shared", personId: "" }))}>Shared</button>
        <button type="button" className={form.mode === "individual" ? "selected" : ""} onClick={() => setForm((current) => ({ ...current, mode: "individual" }))}>Individual</button>
        <button type="button" className={form.mode === "bulk" ? "selected" : ""} onClick={() => setForm((current) => ({ ...current, mode: "bulk", personId: "" }))}>All active</button>
      </div>
      <label>Expiry<select value={form.expiryHours} onChange={(event) => setForm((current) => ({ ...current, expiryHours: event.target.value }))}>
        <option value="24">24 hours</option>
        <option value="72">3 days</option>
        <option value="168">7 days</option>
      </select></label>
      <label>View limit<input value={form.viewLimit} onChange={(event) => setForm((current) => ({ ...current, viewLimit: event.target.value }))} placeholder="Blank for unlimited" /></label>
      <label>Method<select value={form.deliveryMethod} onChange={(event) => setForm((current) => ({ ...current, deliveryMethod: event.target.value as "copy" | "whatsapp" | "email" }))}>
        <option value="copy">Copy link</option>
        <option value="email">Email</option>
        <option value="whatsapp">WhatsApp</option>
      </select></label>
      <label className="check"><input checked={form.viewOnce} type="checkbox" onChange={(event) => setForm((current) => ({ ...current, viewOnce: event.target.checked }))} /> View once</label>
      <label className="check"><input checked={form.hideText} type="checkbox" onChange={(event) => setForm((current) => ({ ...current, hideText: event.target.checked }))} /> Hide text in provider link</label>
      <label>Access password<input value={form.accessPassword} onChange={(event) => setForm((current) => ({ ...current, accessPassword: event.target.value }))} placeholder="Optional provider password" type="password" /></label>
      {form.mode === "bulk" && selectedCredential && (
        <div className="riskSummary">
          <strong>Bulk confirmation summary</strong>
          <span>{bulkSummary}</span>
          <span>Expiry and view limits control link access; they cannot stop someone from saving a viewed credential.</span>
        </div>
      )}
      {submit.status === "error" && <ErrorNotice message={submit.message} compact />}
      {submit.status !== "idle" && submit.status !== "error" && (
        <div className="notice compact">
          {submit.message}
          {submit.url && <button type="button" onClick={() => navigator.clipboard?.writeText(submit.url ?? "")}><Copy size={15} /> Copy link</button>}
        </div>
      )}
      <button className="primary full" disabled={submit.status === "loading" || !selectedCredential || (form.mode === "individual" && !recipient)}>
        <Send size={16} /> {form.mode === "bulk" ? "Create secure links" : "Create secure link"}
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
        const retried = await apiSend<CreatedDeliveryRecord>(`/api/deliveries/${delivery.id}/retry`);
        setMessage({ status: "ready", text: `Retry created for ${delivery.credentialName}.`, url: retried.oneTimeDeliveryUrl });
      }
      if (action === "revoke") {
        const revoked = await apiSend<DeliveryRecord>(`/api/deliveries/${delivery.id}`, { method: "DELETE" });
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
        <div className="notice compact">
          {message.text}
          {message.url && <button type="button" onClick={() => navigator.clipboard?.writeText(message.url ?? "")}><Copy size={15} /> Copy retry link</button>}
        </div>
      )}
      <div className="filters">
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">All statuses</option>
          {statuses.map((status) => <option key={status} value={status}>{titleStatus(status)}</option>)}
        </select>
        <button onClick={() => void refreshAll()}><RefreshCcw size={16} /> Refresh active</button>
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
              <button title="Copy provider ID" onClick={() => navigator.clipboard?.writeText(delivery.providerDeliveryId ?? delivery.id)}><Copy size={15} /></button>
              <button title="Create email draft" disabled={delivery.deliveryMethod !== "email"} onClick={() => window.open(`mailto:?subject=${encodeURIComponent(`WardSen delivery: ${delivery.credentialName}`)}&body=${encodeURIComponent(`Delivery record ${delivery.providerDeliveryId ?? delivery.id}`)}`, "_blank", "noopener,noreferrer")}><Mail size={15} /></button>
              <button title="Refresh" onClick={() => void rowAction(delivery, "refresh")}><RefreshCcw size={15} /></button>
              <button title="Retry" onClick={() => void rowAction(delivery, "retry")}><RotateCcw size={15} /></button>
              <button title="Revoke" disabled={delivery.status === "revoked"} onClick={() => void rowAction(delivery, "revoke")}><Trash2 size={15} /></button>
            </div>
          </div>
        ))}
        {visibleDeliveries.length === 0 && <EmptyState text="No deliveries match this status filter." />}
      </div>
    </div>
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
            <button title="View batch deliveries" onClick={() => void onSelectBatch(batch.id)}><Search size={15} /></button>
            <button title="Copy batch ID" onClick={() => navigator.clipboard?.writeText(batch.id)}><Copy size={15} /></button>
            <button title="Cancel batch" disabled={batch.cancelled || Boolean(batch.completedAt)} onClick={() => api.action(`/api/batches/${batch.id}/cancel`)}><Trash2 size={15} /></button>
          </div>
        </div>
      ))}
    </div>
  );
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
      <h2><Icon size={18} /> {title}</h2>
      <button type="button" onClick={onAction}>{action}</button>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

function ErrorNotice({ message, compact = false }: { message?: string; compact?: boolean }) {
  const help = describeError(message);
  return (
    <div className={compact ? "notice error compact errorHelp" : "notice error errorHelp"} role="alert">
      <strong>{help.title}</strong>
      <span>{help.detail}</span>
      <small>{help.guidance}</small>
    </div>
  );
}

function Status({ value }: { value: string }) {
  return <span className={`status ${value.toLowerCase().replaceAll(" ", "-")}`}>{value}</span>;
}

function titleStatus(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function accountLabel(accounts: AccountRecord[], accountId: string) {
  return accounts.find((account) => account.id === accountId)?.label ?? accountId;
}

function providerLabel(providers: ProviderInfo[], providerId: string) {
  return providers.find((provider) => provider.id === providerId)?.displayName ?? providerId;
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
