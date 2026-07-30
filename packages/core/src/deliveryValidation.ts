import type { DeliveryProviderCapabilities } from "./types";

export const DEFAULT_MAX_VIEW_LIMIT = 1000;

export function parseViewLimit(input: unknown, max = DEFAULT_MAX_VIEW_LIMIT): number | undefined {
  if (input === undefined || input === null || input === "") return undefined;
  if (typeof input === "number") {
    if (!Number.isInteger(input) || input <= 0 || input > max) {
      throw new Error(`View limit must be a positive integer no greater than ${max}`);
    }
    return input;
  }
  if (typeof input !== "string" || !/^[1-9]\d*$/.test(input)) {
    throw new Error("View limit must be blank or a positive integer");
  }
  const parsed = Number(input);
  if (parsed > max) throw new Error(`View limit must be no greater than ${max}`);
  return parsed;
}

export function assertDeliveryOptionsSupported(
  capabilities: DeliveryProviderCapabilities,
  options: { viewLimit?: number; viewOnce?: boolean; accessPassword?: string; hideText?: boolean }
): void {
  if (options.viewLimit !== undefined && !capabilities.arbitraryViewLimit) {
    throw new Error("The selected delivery provider does not support arbitrary view limits");
  }
  if (options.viewOnce && !capabilities.viewOnce) {
    throw new Error("The selected delivery provider does not support view-once links");
  }
  if (options.accessPassword && !capabilities.accessPassword) {
    throw new Error("The selected delivery provider does not support access passwords");
  }
  if (options.hideText && !capabilities.hideText) {
    throw new Error("The selected delivery provider does not support hidden text");
  }
}

export function assertFutureExpiry(expiresAt: Date, now = new Date()): void {
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
    throw new Error("Expiry must be in the future");
  }
}
