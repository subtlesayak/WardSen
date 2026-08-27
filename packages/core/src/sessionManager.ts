import type { AccountStatus } from "./types";

export interface AccountSession {
  accountId: string;
  providerId: string;
  sessionToken?: string;
  unlockedAt?: Date;
  lastActivityAt?: Date;
  activeOperations: number;
  status: AccountStatus;
}

export class AccountSessionManager {
  private readonly sessions = new Map<string, AccountSession>();
  private readonly operationTails = new Map<string, Promise<void>>();
  private readonly deletingAccountIds = new Set<string>();

  ensure(accountId: string, providerId: string): AccountSession {
    const existing = this.sessions.get(accountId);
    if (existing) {
      if (existing.providerId !== providerId) {
        throw new Error("Account session provider mismatch");
      }
      return existing;
    }
    const session: AccountSession = {
      accountId,
      providerId,
      activeOperations: 0,
      status: "locked"
    };
    this.sessions.set(accountId, session);
    return session;
  }

  markUnlocked(accountId: string, providerId: string, sessionToken?: string): void {
    this.assertAccountNotDeleting(accountId);
    const session = this.ensure(accountId, providerId);
    session.sessionToken = sessionToken;
    session.unlockedAt = new Date();
    session.lastActivityAt = new Date();
    session.status = "unlocked";
  }

  markLocked(accountId: string): void {
    const session = this.sessions.get(accountId);
    if (!session) return;
    delete session.sessionToken;
    delete session.unlockedAt;
    delete session.lastActivityAt;
    session.status = "locked";
  }

  markLoggedOut(accountId: string): void {
    const session = this.sessions.get(accountId);
    if (!session) return;
    delete session.sessionToken;
    delete session.unlockedAt;
    delete session.lastActivityAt;
    session.status = "logged_out";
  }

  getSessionToken(accountId: string, expectedProviderId: string): string {
    this.assertAccountNotDeleting(accountId);
    const session = this.sessions.get(accountId);
    if (!session || session.providerId !== expectedProviderId || !session.sessionToken) {
      throw new Error("Account is not unlocked for the requested provider");
    }
    session.lastActivityAt = new Date();
    return session.sessionToken;
  }

  async withOperation<T>(accountId: string, expectedProviderId: string, operation: () => Promise<T>): Promise<T> {
    this.assertAccountNotDeleting(accountId);
    const session = this.sessions.get(accountId);
    if (!session || session.providerId !== expectedProviderId || session.status !== "unlocked") {
      throw new Error("Account session is not initialized");
    }
    const previous = this.operationTails.get(accountId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.operationTails.set(accountId, tail);
    await previous.catch(() => undefined);
    session.activeOperations += 1;
    try {
      return await operation();
    } finally {
      session.activeOperations -= 1;
      session.lastActivityAt = new Date();
      release();
      if (this.operationTails.get(accountId) === tail) {
        this.operationTails.delete(accountId);
      }
    }
  }

  isDeletionInProgress(accountId: string): boolean {
    return this.deletingAccountIds.has(accountId);
  }

  clearAccount(accountId: string): void {
    this.sessions.delete(accountId);
  }

  async withDeletionLock<T>(accountId: string, expectedProviderId: string, operation: () => Promise<T>): Promise<T> {
    const session = this.ensure(accountId, expectedProviderId);
    if (this.deletingAccountIds.has(accountId)) {
      throw new Error("Account deletion is already in progress");
    }
    this.deletingAccountIds.add(accountId);

    const previous = this.operationTails.get(accountId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.operationTails.set(accountId, tail);

    try {
      await previous.catch(() => undefined);
      session.activeOperations += 1;
      return await operation();
    } finally {
      session.activeOperations -= 1;
      session.lastActivityAt = new Date();
      release();
      if (this.operationTails.get(accountId) === tail) {
        this.operationTails.delete(accountId);
      }
      this.deletingAccountIds.delete(accountId);
    }
  }

  lockInactive(now = new Date(), autoLockMinutesFor: (accountId: string) => number = () => 10): string[] {
    const locked: string[] = [];
    for (const accountId of this.inactiveAccountIds(now, autoLockMinutesFor)) {
      this.markLocked(accountId);
      locked.push(accountId);
    }
    return locked;
  }

  inactiveAccountIds(now = new Date(), autoLockMinutesFor: (accountId: string) => number = () => 10): string[] {
    const inactive: string[] = [];
    for (const session of this.sessions.values()) {
      if (session.status !== "unlocked" || !session.lastActivityAt) continue;
      if (session.activeOperations > 0) continue;
      const inactiveMs = now.getTime() - session.lastActivityAt.getTime();
      const autoLockMinutes = Math.max(1, autoLockMinutesFor(session.accountId));
      if (inactiveMs >= autoLockMinutes * 60 * 1000) {
        inactive.push(session.accountId);
      }
    }
    return inactive;
  }

  lockAll(): void {
    for (const accountId of this.sessions.keys()) {
      this.markLocked(accountId);
    }
  }

  snapshot(): AccountSession[] {
    return [...this.sessions.values()].map((session) => ({
      ...session,
      sessionToken: undefined
    }));
  }

  private assertAccountNotDeleting(accountId: string): void {
    if (this.deletingAccountIds.has(accountId)) {
      throw new Error("Account deletion is already in progress");
    }
  }
}
