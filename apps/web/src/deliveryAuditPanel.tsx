import { Trash2 } from "lucide-react";
import type { DeliveryRecordContract } from "@wardsen/contracts";
import { accessEvidenceLabel, accessLabel, attributionLabel, firstObservedLabel, leakSignal, leakSignalRank } from "./deliveryAudit";

type AuditPerson = Pick<{ id: string; name: string }, "id" | "name">;
type AuditProvider = Pick<{ id: string; displayName: string; capabilities?: Record<string, boolean> }, "id" | "displayName" | "capabilities">;

interface DeliveryAuditPanelProps {
  deliveries: DeliveryRecordContract[];
  people: AuditPerson[];
  providers: AuditProvider[];
  canRevoke?: (delivery: DeliveryRecordContract) => boolean;
  onRevoke?: (delivery: DeliveryRecordContract) => void;
  canContainBatch?: (delivery: DeliveryRecordContract) => boolean;
  onContainBatch?: (delivery: DeliveryRecordContract) => void;
}

export function DeliveryAuditPanel({ deliveries, people, providers, canRevoke, onRevoke, canContainBatch, onContainBatch }: DeliveryAuditPanelProps) {
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
        const provider = providers.find((candidate) => candidate.id === delivery.deliveryProviderId);
        const providerName = provider?.displayName ?? titleStatus(delivery.deliveryProviderId);
        const reportsAccessCount = provider?.capabilities?.accessCount === true;
        const auditLabel = reportsAccessCount ? signal.label : "No access telemetry";
        const auditDetail = reportsAccessCount
          ? signal.detail
          : `${providerName} does not report sender-visible link opens. WardSen cannot confirm whether this link was viewed.`;
        const revokeAvailable = signal.level === "high" && delivery.status !== "revoked" && canRevoke?.(delivery) === true;
        const batchContainmentAvailable = revokeAvailable && Boolean(delivery.batchId) && canContainBatch?.(delivery) === true;
        return (
          <article className={`auditItem ${signal.level}`} key={delivery.id}>
            <div>
              <strong>{attributionLabel(delivery, personName)}</strong>
              <span>{delivery.credentialName}</span>
            </div>
            <StatusPill value={auditLabel} />
            <dl>
              <div><dt>Provider</dt><dd>{providerName}</dd></div>
              <div><dt>Access</dt><dd>{reportsAccessCount ? accessLabel(delivery) : "Not reported"}</dd></div>
              <div><dt>First view observed</dt><dd>{reportsAccessCount ? firstObservedLabel(delivery) : "Not reported"}</dd></div>
              <div><dt>Evidence</dt><dd>{reportsAccessCount ? accessEvidenceLabel(delivery) : "No sender-visible access count"}</dd></div>
              <div><dt>Last checked</dt><dd>{delivery.lastCheckedAt ? formatDate(delivery.lastCheckedAt) : "Not checked"}</dd></div>
              <div><dt>State</dt><dd>{titleStatus(delivery.status)}</dd></div>
            </dl>
            <p>{auditDetail}</p>
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
