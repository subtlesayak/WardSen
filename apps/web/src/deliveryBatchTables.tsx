import { Copy, Search, Trash2 } from "lucide-react";
import type { DeliveryRecordContract } from "@wardsen/contracts";

export interface DeliveryBatchTableRecord {
  id: string;
  requestedCount: number;
  completedCount: number;
  failedCount: number;
  cancelled: boolean;
  createdAt: string;
  completedAt?: string;
}

interface BatchTableProps {
  batches: DeliveryBatchTableRecord[];
  selectedBatchId?: string;
  onSelectBatch: (batchId: string) => void | Promise<void>;
  onCancelBatch: (batch: DeliveryBatchTableRecord) => void;
}

export function BatchTable({ batches, selectedBatchId, onSelectBatch, onCancelBatch }: BatchTableProps) {
  if (batches.length === 0) return <div className="empty">No bulk batches yet. Create one from the credential delivery form.</div>;
  return (
    <div className="table">
      <div className="tableHead batch">
        <span>Batch</span><span>Requested</span><span>Completed</span><span>Failed</span><span>Status</span><span>Created</span><span>Actions</span>
      </div>
      {batches.map((batch) => (
        <div className={selectedBatchId === batch.id ? "tableRow batch selected" : "tableRow batch"} key={batch.id}>
          <strong>{batch.id}</strong>
          <span>{batch.requestedCount}</span>
          <span>{batch.completedCount}</span>
          <span>{batch.failedCount}</span>
          <StatusPill value={batch.cancelled ? "Cancelled" : batch.completedAt ? "Complete" : "Queued"} />
          <span>{formatDate(batch.createdAt)}</span>
          <div className="actions">
            <button type="button" aria-label={`View deliveries for batch ${batch.id}`} title="View batch deliveries" onClick={() => void onSelectBatch(batch.id)}><Search size={15} aria-hidden="true" /></button>
            <button type="button" aria-label={`Copy batch ID ${batch.id}`} title="Copy batch ID" onClick={() => navigator.clipboard?.writeText(batch.id)}><Copy size={15} aria-hidden="true" /></button>
            <button type="button" aria-label={`Cancel batch ${batch.id}`} title="Cancel batch" disabled={batch.cancelled || Boolean(batch.completedAt)} onClick={() => onCancelBatch(batch)}><Trash2 size={15} aria-hidden="true" /></button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function BatchDeliveryTable({ deliveries, people }: { deliveries: DeliveryRecordContract[]; people: Array<{ id: string; name: string }> }) {
  const personName = (id?: string) => people.find((person) => person.id === id)?.name ?? "Shared link";
  if (deliveries.length === 0) return <div className="empty">This batch has no delivery rows yet.</div>;
  return (
    <div className="table">
      <div className="tableHead batchDeliveries">
        <span>Credential</span><span>Person</span><span>Status</span><span>Access</span><span>Expiry</span><span>Provider ID</span>
      </div>
      {deliveries.map((delivery) => (
        <div className="tableRow batchDeliveries" key={delivery.id}>
          <strong>{delivery.credentialName}</strong>
          <span>{personName(delivery.personId)}</span>
          <StatusPill value={titleStatus(delivery.status)} />
          <span>{delivery.accessCount ?? 0}{delivery.viewLimit ? ` / ${delivery.viewLimit}` : ""}</span>
          <span>{formatDate(delivery.expiresAt)}</span>
          <span>{delivery.providerDeliveryId ?? delivery.id}</span>
        </div>
      ))}
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
