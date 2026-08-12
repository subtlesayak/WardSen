import { useEffect, useState, type ReactNode } from "react";
import { Archive, Lock, LogOut, RefreshCcw } from "lucide-react";
import {
  parseCredentialAccessRequestCreateResponse,
  parseCredentialAccessRequestList,
  parseCredentialCatalogList,
  parseEmployeePortalSession,
  type CredentialAccessRequestRecordContract,
  type CredentialCatalogEntryContract,
  type EmployeePortalSessionContract
} from "@wardsen/contracts";
import { apiSend } from "./api";

interface EmployeePortalProps {
  defaultAssignedEmail?: string;
  onRequestSubmitted?: () => Promise<void> | void;
}

type PortalMessage = { status: "idle" | "loading" | "ready" | "error"; text?: string };

export function EmployeePortal({ defaultAssignedEmail, onRequestSubmitted }: EmployeePortalProps) {
  const [signIn, setSignIn] = useState({ assignedEmail: defaultAssignedEmail ?? "", code: "" });
  const [session, setSession] = useState<EmployeePortalSessionContract | undefined>();
  const [catalog, setCatalog] = useState<CredentialCatalogEntryContract[]>([]);
  const [requests, setRequests] = useState<CredentialAccessRequestRecordContract[]>([]);
  const [requestForm, setRequestForm] = useState({
    catalogEntryId: "",
    reason: "",
    ticketRef: "",
    expectedDurationMinutes: "60",
    breakGlass: false,
    breakGlassJustification: ""
  });
  const [message, setMessage] = useState<PortalMessage>({ status: "idle" });

  useEffect(() => {
    if (!session && defaultAssignedEmail) {
      setSignIn((current) => ({ ...current, assignedEmail: current.assignedEmail || defaultAssignedEmail }));
    }
  }, [defaultAssignedEmail, session]);

  const selectedEntry = catalog.find((entry) => entry.id === requestForm.catalogEntryId);

  async function loadPortal(sessionToken = session?.sessionToken) {
    if (!sessionToken) return;
    const headers = employeeSessionHeaders(sessionToken);
    const [catalogResponse, requestResponse] = await Promise.all([
      apiSend<unknown>("/api/employee-portal/catalog?page=1&pageSize=100", { method: "GET", headers }),
      apiSend<unknown>("/api/employee-portal/credential-requests?page=1&pageSize=100", { method: "GET", headers })
    ]);
    const nextCatalog = parseCredentialCatalogList(catalogResponse).items;
    const nextRequests = parseCredentialAccessRequestList(requestResponse).items;
    setCatalog(nextCatalog);
    setRequests(nextRequests);
    setRequestForm((current) => ({
      ...current,
      catalogEntryId: current.catalogEntryId && nextCatalog.some((entry) => entry.id === current.catalogEntryId)
        ? current.catalogEntryId
        : nextCatalog[0]?.id ?? ""
    }));
  }

  async function signInEmployee(event: React.FormEvent) {
    event.preventDefault();
    setMessage({ status: "loading", text: "Signing in..." });
    try {
      const response = await apiSend<unknown>("/api/employee-sessions", {
        body: JSON.stringify({ assignedEmail: signIn.assignedEmail, code: signIn.code })
      });
      const nextSession = parseEmployeePortalSession(response);
      setSession(nextSession);
      setSignIn({ assignedEmail: nextSession.employee.assignedEmail, code: "" });
      await loadPortal(nextSession.sessionToken);
      setMessage({ status: "ready", text: `Signed in as ${nextSession.employee.name}.` });
    } catch (error) {
      setMessage({ status: "error", text: errorMessage(error) });
    }
  }

  async function submitRequest(event: React.FormEvent) {
    event.preventDefault();
    if (!session) return;
    if (requestForm.breakGlass) {
      if (!requestForm.breakGlassJustification.trim()) {
        setMessage({ status: "error", text: "Break-glass requests require an emergency justification." });
        return;
      }
      const credentialName = selectedEntry?.credentialName ?? "selected credential";
      if (!window.confirm(`Submit emergency break-glass request for ${credentialName} and ${session.employee.assignedEmail}?\n\nWardSen will record the justification and still require admin fulfillment before any delivery link is created.`)) return;
    }
    setMessage({ status: "loading", text: "Submitting request..." });
    try {
      const response = await apiSend<unknown>("/api/employee-portal/credential-requests", {
        headers: employeeSessionHeaders(session.sessionToken),
        body: JSON.stringify({
          catalogEntryId: requestForm.catalogEntryId,
          reason: requestForm.reason,
          ticketRef: requestForm.ticketRef || undefined,
          expectedDurationMinutes: Number(requestForm.expectedDurationMinutes) || undefined,
          breakGlass: requestForm.breakGlass || undefined,
          breakGlassJustification: requestForm.breakGlass ? requestForm.breakGlassJustification : undefined
        })
      });
      const parsed = parseCredentialAccessRequestCreateResponse(response);
      const request = "request" in parsed ? parsed.request : parsed;
      const autoApproved = "request" in parsed && parsed.autoApproved === true;
      setRequestForm((current) => ({ ...current, reason: "", ticketRef: "", breakGlass: false, breakGlassJustification: "" }));
      setMessage({
        status: "ready",
        text: request.breakGlass
          ? `Emergency request queued for ${request.credentialName}.`
          : autoApproved
            ? `Policy approved ${request.credentialName}; an admin must still fulfill delivery.`
            : `Request queued for ${request.credentialName}.`
      });
      await loadPortal(session.sessionToken);
      await onRequestSubmitted?.();
    } catch (error) {
      setMessage({ status: "error", text: errorMessage(error) });
    }
  }

  async function signOut() {
    if (!session) return;
    setMessage({ status: "loading", text: "Signing out..." });
    try {
      await apiSend("/api/employee-sessions/current/logout", {
        headers: employeeSessionHeaders(session.sessionToken)
      });
      setSession(undefined);
      setCatalog([]);
      setRequests([]);
      setRequestForm({ catalogEntryId: "", reason: "", ticketRef: "", expectedDurationMinutes: "60", breakGlass: false, breakGlassJustification: "" });
      setMessage({ status: "ready", text: "Signed out." });
    } catch (error) {
      setMessage({ status: "error", text: errorMessage(error) });
    }
  }

  async function refresh() {
    if (!session) return;
    setMessage({ status: "loading", text: "Refreshing requests..." });
    try {
      await loadPortal();
      setMessage({ status: "ready", text: "Requests refreshed." });
    } catch (error) {
      setMessage({ status: "error", text: errorMessage(error) });
    }
  }

  if (!session) {
    return (
      <section className="panel formGrid employeePortal">
        <PortalTitle title="Employee Portal" />
        <PortalMessage message={message} />
        <form className="contents" onSubmit={signInEmployee}>
          <label>Assigned email<input required type="email" autoComplete="email" value={signIn.assignedEmail} onChange={(event) => setSignIn((current) => ({ ...current, assignedEmail: event.target.value }))} /></label>
          <label>One-time code<input required autoComplete="one-time-code" inputMode="numeric" value={signIn.code} onChange={(event) => setSignIn((current) => ({ ...current, code: event.target.value }))} /></label>
          <button className="primary full" disabled={message.status === "loading"}><Lock size={16} aria-hidden="true" /> Sign in</button>
        </form>
      </section>
    );
  }

  return (
    <section className="panel formGrid employeePortal">
      <PortalTitle title="Employee Portal" action={<button type="button" onClick={() => void signOut()} disabled={message.status === "loading"}><LogOut size={15} aria-hidden="true" /> Sign out</button>} />
      <PortalMessage message={message} />
      <label>Employee<input readOnly aria-readonly="true" value={`${session.employee.name} / ${session.employee.assignedEmail}`} /></label>
      <label>Credential<select required value={requestForm.catalogEntryId} onChange={(event) => setRequestForm((current) => ({ ...current, catalogEntryId: event.target.value }))}>
        {catalog.map((entry) => <option key={entry.id} value={entry.id}>{entry.credentialName} / {titleStatus(entry.riskTier)}</option>)}
      </select></label>
      <label>Expected minutes<input inputMode="numeric" value={requestForm.expectedDurationMinutes} onChange={(event) => setRequestForm((current) => ({ ...current, expectedDurationMinutes: event.target.value }))} /></label>
      <label>Ticket<input value={requestForm.ticketRef} onChange={(event) => setRequestForm((current) => ({ ...current, ticketRef: event.target.value }))} placeholder="Optional ticket" /></label>
      <form className="contents" onSubmit={submitRequest}>
        <label className="spanAll">Reason<textarea required value={requestForm.reason} onChange={(event) => setRequestForm((current) => ({ ...current, reason: event.target.value }))} placeholder="Emergency deploy rollback" /></label>
        <label className="inlineCheck spanAll"><input type="checkbox" checked={requestForm.breakGlass} onChange={(event) => setRequestForm((current) => ({ ...current, breakGlass: event.target.checked }))} /> Emergency break-glass request</label>
        {requestForm.breakGlass ? <label className="spanAll attentionField">Emergency justification<textarea required value={requestForm.breakGlassJustification} onChange={(event) => setRequestForm((current) => ({ ...current, breakGlassJustification: event.target.value }))} /></label> : null}
        <button className="primary full" disabled={!requestForm.catalogEntryId || message.status === "loading"}><Archive size={16} aria-hidden="true" /> Submit request</button>
      </form>
      <div className="table spanAll">
        <div className="tableHead requests">
          <span>Credential</span><span>Employee</span><span>Assigned email</span><span>Reason</span><span>Status</span><span>Requested</span>
        </div>
        {requests.map((request) => (
          <div className="tableRow requests" key={request.id}>
            <div><strong>{request.credentialName}</strong>{request.breakGlass ? <span>Emergency break-glass</span> : null}</div>
            <span>{session.employee.name}</span>
            <span>{request.assignedEmail}</span>
            <span>{request.breakGlassJustification ?? request.reason}</span>
            <span className={`status ${request.status.replaceAll("_", "-")}`}>{titleStatus(request.status)}</span>
            <span>{request.ticketRef ?? formatDate(request.requestedAt)}</span>
          </div>
        ))}
        {requests.length === 0 ? <div className="empty">No requests yet.</div> : null}
      </div>
      <button type="button" className="secondary" onClick={() => void refresh()} disabled={message.status === "loading"}><RefreshCcw size={15} aria-hidden="true" /> Refresh</button>
    </section>
  );
}

export function EmployeePortalPage() {
  return (
    <div className="employeePortalShell">
      <a className="skipLink" href="#employee-portal-main">Skip to content</a>
      <header className="employeePortalBrand"><Lock size={22} aria-hidden="true" /><strong>WardSen Employee Portal</strong></header>
      <main id="employee-portal-main"><EmployeePortal /></main>
    </div>
  );
}

export function isEmployeePortalView(): boolean {
  return new URLSearchParams(window.location.search).get("view") === "employee";
}

function PortalTitle({ title, action }: { title: string; action?: ReactNode }) {
  return <div className="panelTitle"><h2><Lock size={21} aria-hidden="true" /> {title}</h2>{action}</div>;
}

function PortalMessage({ message }: { message: PortalMessage }) {
  if (!message.text) return null;
  const className = message.status === "error" ? "error" : message.status === "loading" ? "notice" : "success";
  return <div className={className} role={message.status === "error" ? "alert" : "status"} aria-live="polite">{message.text}</div>;
}

function employeeSessionHeaders(sessionToken: string): HeadersInit {
  return { "x-wardsen-employee-session": sessionToken };
}

function titleStatus(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
