import { Trash2 } from "lucide-react";
import type { DeliveryRecordContract } from "@wardsen/contracts";
import { accessEvidenceLabel, accessLabel, attributionLabel, firstObservedLabel, leakSignal, leakSignalRank } from "./deliveryAudit";

type AuditPerson = Pick<{ id: string; name: string }, "id" | "name">;

interface DeliveryAuditPanelProps {
  deliveries: DeliveryRecordContract[];
  people: AuditPerson[];
  canRevoke?: (delivery: DeliveryRecordContract) => boolean;
  onRevoke?: (delivery: DeliveryRecordContract) => void;
  canContainBatch?: (delivery: DeliveryRecordContract) => boolean;
  onContainBatch?: (delivery: DeliveryRecordContract) => void;
}

export function DeliveryAuditPanel({ deliveries, people, canRevoke, onRevoke, canContainBatch, onContainBatch }: DeliveryAuditPanelProps) {
  const personName = (id?: string) => people.find((person) => person.id === id)?.name ?? "Shared link";
  const watched = [...deliveries]
    .filter((delivery) => ["active", "viewed", "limit_reached", "expired", "revoked"].includes(delivery.status))
    .sort((a, b) => leakSignalRank(b) - leakSignalRank(a) || (b.lastCheckedAt ?? b.createdAt).localeCompare(a.lastCheckedAt ?? a.createdAt))
    .slice(0, 6);

  if (watched.length === 0) {
    return <div className="empty">No provider access signals yet. Refresh deliveries after creating links to check provider status.</div>;
  }

  return (
    <div className="auditGrid">
      {watched.map((delivery) => {
        const signal = leakSignal(delivery);
        const revokeAvailable = signal.level === "high" && delivery.status !== "revoked" && canRevoke?.(delivery) === true;
        const batchContainmentAvailable = revokeAvailable && Boolean(delivery.batchId) && canContainBatch?.(delivery) === true;
        return (
          <article className={`auditItem ${signal.level}`} key={delivery.id}>
            <div>
              <strong>{attributionLabel(delivery, personName)}</strong>
              <span>{delivery.credentialName}</span>
            </div>
            <StatusPill value={signal.label} />
            <dl>
              <div><dt>Access</dt><dd>{accessLabel(delivery)}</dd></div>
              <div><dt>First view observed</dt><dd>{firstObservedLabel(delivery)}</dd></div>
              <div><dt>Evidence</dt><dd>{accessEvidenceLabel(delivery)}</dd></div>
              <div><dt>Last checked</dt><dd>{delivery.lastCheckedAt ? formatDate(delivery.lastCheckedAt) : "Not checked"}</dd></div>
              <div><dt>State</dt><dd>{titleStatus(delivery.status)}</dd></div>
            </dl>
            <p>{signal.detail}</p>
            {revokeAvailable ? (
              <button type="button" className="dangerAction" onClick={() => onRevoke?.(delivery)}>
                <Trash2 size={15} aria-hidden="true" /> Revoke link
              </button>
            ) : null}
            {batchContainmentAvailable ? (
              <button type="button" className="dangerAction" onClick={() => onContainBatch?.(delivery)}>
                <Trash2 size={15} aria-hidden="true" /> Revoke batch links
              </button>
            ) : null}
          </article>
        );
      })}
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
