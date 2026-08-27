import { describe, expect, it } from "vitest";
import { fuzzyFilterCredentials } from "../apps/server/src/credentialSearch";

const credentials = [
  { id: "github", accountId: "work", providerId: "bitwarden", title: "GitHub Production", username: "deploy", domain: "github.com", itemType: "login" as const },
  { id: "proton", accountId: "work", providerId: "bitwarden", title: "Proton VPN", username: "ops", domain: "account.protonvpn.com", itemType: "login" as const },
  { id: "mail", accountId: "work", providerId: "bitwarden", title: "Mailbox", username: "team@example.com", domain: "mail.example.com", itemType: "login" as const }
];

describe("fuzzyFilterCredentials", () => {
  it("matches small typos across credential titles, usernames, and domains", () => {
    expect(fuzzyFilterCredentials(credentials, "githb", { page: 1, pageSize: 10 }).map((item) => item.id)).toEqual(["github"]);
    expect(fuzzyFilterCredentials(credentials, "protonvpm", { page: 1, pageSize: 10 }).map((item) => item.id)).toEqual(["proton"]);
    expect(fuzzyFilterCredentials(credentials, "t3am", { page: 1, pageSize: 10 }).map((item) => item.id)).toEqual(["mail"]);
  });

  it("keeps the best fuzzy matches first and applies the requested page", () => {
    expect(fuzzyFilterCredentials(credentials, "pro", { page: 1, pageSize: 1 }).map((item) => item.id)).toEqual(["proton"]);
  });
});
