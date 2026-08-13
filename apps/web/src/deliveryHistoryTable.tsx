import { useState } from "react";
import { CheckCircle2, Copy, Mail, RefreshCcw, RotateCcw, Trash2 } from "lucide-react";
import type { DeliveryRecordContract } from "@wardsen/contracts";
import { copyTextToClipboard, openMailDraft } from "./api";

export type DeliveryHistoryAction = "refresh" | "retry" | "revoke";

interface DeliveryHistoryTableProps {
  deliveries: DeliveryRecordContract[];
  people: Array<{ id: string; name: string }>;
  canRefresh: (delivery: DeliveryRecordContract) => boolean;
  canRevoke: (delivery: DeliveryRecordContract) => boolean;
  onAction: (delivery: DeliveryRecordContract, action: DeliveryHistoryAction) => void;
  onRefreshActive: () => void;
}

export function DeliveryHistoryTable({ deliveries, people, canRefresh, canRevoke, onAction, onRefreshActive }: DeliveryHistoryTableProps) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [copyState, setCopyState] = useState<{ deliveryId: string; status: "copied" | "error" }>();
  const personName = (id?: string) => people.find((person) => person.id === id)?.name ?? "Shared link";
  const visibleDeliveries = deliveries.filter((delivery) => statusFilter === "all" || delivery.status === statusFilter);
  const statuses = [...new Set(deliveries.map((delivery) => delivery.status))].sort();

  async function copyDeliveryId(delivery: DeliveryRecordContract) {
    try {
      await copyTextToClipboard(delivery.providerDeliveryId ?? delivery.id);
      setCopyState({ deliveryId: delivery.id, status: "copied" });
    } catch {
      setCopyState({ deliveryId: delivery.id, status: "error" });
    }
  }

  async function createEmailDraft(delivery: DeliveryRecordContract) {
    const subject = encodeURIComponent(`WardSen delivery: ${delivery.credentialName}`);
    const body = encodeURIComponent(`Delivery record ${delivery.providerDeliveryId ?? delivery.id}`);
    await openMailDraft(`mailto:?subject=${subject}&body=${body}`);
  }

  if (deliveries.length === 0) return <div className="empty">No deliveries yet. Create links after unlocking a vault.</div>;
  return (
    <div className="grid">
      <div className="filters">
        <select aria-label="Delivery status filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
          <option value="all">All statuses</option>
          {statuses.map((status) => <option key={status} value={status}>{titleStatus(status)}</option>)}
        </select>
        <button type="button" onClick={onRefreshActive}><RefreshCcw size={16} aria-hidden="true" /> Refresh active</button>
      </div>
      <div className="table">
        <div className="tableHead">
          <span>Credential</span><span>Person</span><span>Provider</span><span>Expiry</span><span>Access</span><span>Status</span><span>Actions</span>
        </div>
        {visibleDeliveries.map((delivery) => {
          const copyStatus = copyState?.deliveryId === delivery.id ? copyState.status : undefined;
          const CopyIcon = copyStatus === "copied" ? CheckCircle2 : Copy;
          return (
            <div className="tableRow" key={delivery.id}>
              <div>
                <strong>{delivery.credentialName}</strong>
                <span>{delivery.deliveryMethod ? titleStatus(delivery.deliveryMethod) : "Copy"} / {delivery.lastCheckedAt ? `Checked ${formatDate(delivery.lastCheckedAt)}` : "Not checked"}</span>
              </div>
              <span>{personName(delivery.personId)}</span>
              <span>{delivery.deliveryProviderId}</span>
              <span>{formatDate(delivery.expiresAt)}</span>
              <span>{delivery.accessCount ?? 0}{delivery.viewLimit ? ` / ${delivery.viewLimit}` : ""}</span>
              <StatusPill value={titleStatus(delivery.status)} />
              <div className="actions">
                <button type="button" aria-label={copyStatus === "copied" ? `Delivery ID copied for ${delivery.credentialName}` : `Copy delivery ID for ${delivery.credentialName}`} title={copyStatus === "copied" ? "Delivery ID copied" : "Copy delivery ID"} className={copyStatus === "copied" ? "copySuccess" : undefined} onClick={() => void copyDeliveryId(delivery)}><CopyIcon size={15} aria-hidden="true" /></button>
                <button type="button" aria-label={`Create email draft for ${delivery.credentialName}`} title="Create email draft" disabled={delivery.deliveryMethod !== "email"} onClick={() => void createEmailDraft(delivery)}><Mail size={15} aria-hidden="true" /></button>
                <button type="button" aria-label={`Refresh ${delivery.credentialName}`} title="Refresh" disabled={!canRefresh(delivery)} onClick={() => onAction(delivery, "refresh")}><RefreshCcw size={15} aria-hidden="true" /></button>
                <button type="button" aria-label={`Retry ${delivery.credentialName}`} title="Retry" onClick={() => onAction(delivery, "retry")}><RotateCcw size={15} aria-hidden="true" /></button>
                <button type="button" aria-label={`Revoke ${delivery.credentialName}`} title="Revoke" disabled={delivery.status === "revoked" || !canRevoke(delivery)} onClick={() => onAction(delivery, "revoke")}><Trash2 size={15} aria-hidden="true" /></button>
                {copyStatus === "copied" ? <small className="historyCopyStatus" role="status" aria-live="polite">Delivery ID copied.</small> : null}
                {copyStatus === "error" ? <small className="historyCopyError" role="alert">Copy was blocked. Try again.</small> : null}
              </div>
            </div>
          );
        })}
        {visibleDeliveries.length === 0 ? <div className="empty">No deliveries match this status filter.</div> : null}
      </div>
    </div>
  );
}

function StatusPill({ value }: { value: string }) {
  return <span className={`status ${value.toLowerCase().replaceAll(" ", "-")}`}>{value}</span>;
}

function titleStatus(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}
