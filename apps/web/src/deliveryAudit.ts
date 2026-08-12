import { parseDeliveryAccessEvent, type DeliveryAccessEventContract, type DeliveryRecordContract } from "@wardsen/contracts";

type AuditedDelivery = Pick<DeliveryRecordContract, "accessCount" | "createdAt" | "firstViewedAt" | "id" | "lastCheckedAt" | "personId" | "status" | "viewLimit">;

export interface LeakSignal {
  label: string;
  detail: string;
  level: "low" | "watch" | "high";
}

export function attributionLabel(delivery: AuditedDelivery, personName: (id?: string) => string): string {
  const label = delivery.personId ? `${personName(delivery.personId)}'s link` : "Shared link";
  if (accessObserved(delivery)) return `${label} was viewed`;
  if (delivery.status === "revoked") return `${label} was revoked`;
  if (delivery.status === "expired") return `${label} expired`;
  return `${label} has no observed access`;
}

export function accessLabel(delivery: AuditedDelivery): string {
  const count = delivery.accessCount ?? 0;
  return delivery.viewLimit ? `${count} / ${delivery.viewLimit}` : String(count);
}

export function firstObservedLabel(delivery: AuditedDelivery): string {
  if (!accessObserved(delivery)) return "No access observed";
  if (!delivery.firstViewedAt) return "Observed before WardSen recorded first-view time";
  return formatAuditDate(delivery.firstViewedAt);
}

export function accessEvent(delivery: AuditedDelivery): DeliveryAccessEventContract | undefined {
  if (!accessObserved(delivery)) return undefined;
  return parseDeliveryAccessEvent({
    deliveryId: delivery.id,
    recipientId: delivery.personId,
    observedAt: delivery.firstViewedAt ?? delivery.lastCheckedAt ?? delivery.createdAt,
    accessCount: delivery.accessCount ?? 0,
    source: "provider",
    confidence: "recipient_link"
  });
}

export function accessEvidenceLabel(delivery: AuditedDelivery): string {
  const event = accessEvent(delivery);
  if (!event) return "No provider-reported access event";
  return "Provider reported access to this assigned link; viewer identity and device are not verified.";
}

export function leakSignal(delivery: AuditedDelivery): LeakSignal {
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
  if (accessObserved(delivery)) {
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

export function leakSignalRank(delivery: AuditedDelivery): number {
  const signal = leakSignal(delivery);
  if (signal.level === "high") return 3;
  if (signal.level === "watch") return 2;
  return 1;
}

function accessObserved(delivery: AuditedDelivery): boolean {
  return (delivery.accessCount ?? 0) > 0 || delivery.status === "viewed" || delivery.status === "limit_reached";
}

function formatAuditDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function titleStatus(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
