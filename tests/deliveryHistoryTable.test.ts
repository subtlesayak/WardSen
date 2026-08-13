import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mainSource = readFileSync("apps/web/src/main.tsx", "utf8");
const historySource = readFileSync("apps/web/src/deliveryHistoryTable.tsx", "utf8");

describe("delivery history table boundary", () => {
  it("keeps delivery history rendering outside the main application screen", () => {
    expect(mainSource).toContain('import { DeliveryHistoryTable, type DeliveryHistoryAction } from "./deliveryHistoryTable";');
    expect(mainSource).not.toContain("function DeliveryHistoryTable(");
    expect(historySource).toContain("export function DeliveryHistoryTable");
  });

  it("keeps API actions and destructive confirmation in the parent while providing copy feedback", () => {
    expect(historySource).toContain("onAction(delivery, \"revoke\")");
    expect(historySource).toContain("copyTextToClipboard");
    expect(historySource).toContain("Delivery ID copied.");
    expect(historySource).toContain("openMailDraft");
    expect(mainSource).toContain("REVOKE DELIVERY ${delivery.id}");
    expect(mainSource).toContain("parseDeliveryRecord(await apiSend<unknown>");
  });
});
