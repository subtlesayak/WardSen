import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountSessionManager } from "@wardsen/core";

describe("AccountSessionManager", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("isolates sessions by account and provider", () => {
    const sessions = new AccountSessionManager();
    sessions.ensure("a", "bitwarden");
    sessions.ensure("b", "bitwarden");
    sessions.markUnlocked("a", "bitwarden", "token-a");
    sessions.markUnlocked("b", "bitwarden", "token-b");

    expect(sessions.getSessionToken("a", "bitwarden")).toBe("token-a");
    expect(sessions.getSessionToken("b", "bitwarden")).toBe("token-b");
    expect(() => sessions.getSessionToken("a", "keepassxc")).toThrow();
  });

  it("redacts tokens from snapshots and locks all accounts", () => {
    const sessions = new AccountSessionManager();
    sessions.ensure("a", "bitwarden");
    sessions.markUnlocked("a", "bitwarden", "token-a");

    expect(sessions.snapshot()[0].sessionToken).toBeUndefined();
    sessions.lockAll();
    expect(() => sessions.getSessionToken("a", "bitwarden")).toThrow();
  });

  it("serializes operations for the same account", async () => {
    const sessions = new AccountSessionManager();
    sessions.ensure("a", "bitwarden");
    sessions.markUnlocked("a", "bitwarden", "token-a");
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = sessions.withOperation("a", "bitwarden", async () => {
      events.push("first:start");
      await firstRelease;
      events.push("first:end");
    });
    const second = sessions.withOperation("a", "bitwarden", async () => {
      events.push("second:start");
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("allows independent accounts to operate concurrently", async () => {
    const sessions = new AccountSessionManager();
    sessions.ensure("a", "bitwarden");
    sessions.ensure("b", "bitwarden");
    sessions.markUnlocked("a", "bitwarden", "token-a");
    sessions.markUnlocked("b", "bitwarden", "token-b");
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstRelease = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = sessions.withOperation("a", "bitwarden", async () => {
      events.push("a:start");
      await firstRelease;
      events.push("a:end");
    });
    const second = sessions.withOperation("b", "bitwarden", async () => {
      events.push("b:start");
    });

    await second;
    expect(events).toEqual(["a:start", "b:start"]);
    releaseFirst();
    await first;
  });

  it("locks inactive sessions using account-specific timeouts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const sessions = new AccountSessionManager();
    sessions.markUnlocked("short", "bitwarden", "token-short");
    sessions.markUnlocked("long", "bitwarden", "token-long");

    const locked = sessions.lockInactive(new Date("2026-01-01T00:02:00.000Z"), (accountId) => (accountId === "short" ? 1 : 15));

    expect(locked).toEqual(["short"]);
    expect(() => sessions.getSessionToken("short", "bitwarden")).toThrow();
    expect(sessions.getSessionToken("long", "bitwarden")).toBe("token-long");
  });

  it("can report inactive sessions without locking them", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const sessions = new AccountSessionManager();
    sessions.markUnlocked("short", "bitwarden", "token-short");
    sessions.markUnlocked("long", "bitwarden", "token-long");

    const inactive = sessions.inactiveAccountIds(new Date("2026-01-01T00:02:00.000Z"), (accountId) => (accountId === "short" ? 1 : 15));

    expect(inactive).toEqual(["short"]);
    expect(sessions.getSessionToken("short", "bitwarden")).toBe("token-short");
    expect(sessions.getSessionToken("long", "bitwarden")).toBe("token-long");
  });
});
