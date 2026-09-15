import type { SecurityRequest, SecurityResponse } from "@shardpass/messaging";
import type { StoragePort } from "@shardpass/storage";

import type { SessionVaultRepository } from "../vault/session-vault-repository";

export type BreachCheckErrorCode =
  | "BREACH_CHECK_DISABLED"
  | "BREACH_CHECK_UNAVAILABLE"
  | "ITEM_NOT_FOUND"
  | "VAULT_LOCKED";

export class BreachCheckError extends Error {
  constructor(readonly code: BreachCheckErrorCode) {
    super(code);
    this.name = "BreachCheckError";
  }
}

const SETTINGS_KEY = "shardpass:v1:breach-checks";
/** A range answer changes rarely; an hour of reuse keeps repeated checks off the network. */
const RANGE_CACHE_TTL_MS = 60 * 60_000;
const RANGE_CACHE_ENTRIES = 64;

type BreachCheckDependencies = Readonly<{
  repository: Pick<SessionVaultRepository, "getItem">;
  /** Non-secret preference; local storage so it survives a browser restart. */
  local: StoragePort;
  /** Fetches the padded range body for a five-character SHA-1 prefix. */
  fetchRange(prefix: string): Promise<string>;
  now(): number;
}>;

/**
 * Have I Been Pwned's k-anonymity check: the password is hashed on this device, the first
 * five hex characters of the hash are sent, and the reply (hundreds of suffixes, padded so
 * its size reveals nothing) is searched here for the rest. The password itself, and its
 * full hash, never leave the worker.
 */
export class BreachCheckService {
  private readonly ranges = new Map<string, Readonly<{ at: number; body: string }>>();

  constructor(private readonly dependencies: BreachCheckDependencies) {}

  async handle(request: SecurityRequest): Promise<SecurityResponse> {
    switch (request.kind) {
      case "security.getSettings":
        return { version: 1, kind: "security.settings", breachChecks: await this.enabled() };
      case "security.setBreachChecks":
        await this.dependencies.local.set({ [SETTINGS_KEY]: { version: 1, enabled: request.enabled } });
        if (!request.enabled) this.ranges.clear();
        return { version: 1, kind: "security.settings", breachChecks: request.enabled };
      case "security.checkItem": {
        if (!(await this.enabled())) throw new BreachCheckError("BREACH_CHECK_DISABLED");
        const password = await this.passwordOf(request.itemId);
        const count = await this.countFor(password);
        return {
          version: 1,
          kind: "security.breachResult",
          itemId: request.itemId,
          count,
          checkedAt: this.dependencies.now(),
        };
      }
    }
  }

  private async enabled(): Promise<boolean> {
    const stored = (await this.dependencies.local.get([SETTINGS_KEY]))[SETTINGS_KEY] as
      | { version?: unknown; enabled?: unknown }
      | undefined;
    return stored?.version === 1 && stored.enabled === true;
  }

  private async passwordOf(itemId: string): Promise<string> {
    let item: Awaited<ReturnType<SessionVaultRepository["getItem"]>>;
    try {
      item = await this.dependencies.repository.getItem(itemId);
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      throw new BreachCheckError(code === "VAULT_LOCKED" ? "VAULT_LOCKED" : "BREACH_CHECK_UNAVAILABLE");
    }
    if (item === null || item.kind !== "login" || item.password === "")
      throw new BreachCheckError("ITEM_NOT_FOUND");
    return item.password;
  }

  /** How often `password` appears in the breach corpus, by its SHA-1 prefix range. */
  async countFor(password: string): Promise<number> {
    const digest = await sha1Hex(password);
    const prefix = digest.slice(0, 5);
    const suffix = digest.slice(5);
    const body = await this.rangeBody(prefix);
    for (const line of body.split(/\r?\n/u)) {
      const separator = line.indexOf(":");
      if (separator < 0) continue;
      if (line.slice(0, separator).trim().toUpperCase() !== suffix) continue;
      const count = Number.parseInt(line.slice(separator + 1).trim(), 10);
      return Number.isSafeInteger(count) && count > 0 ? count : 0;
    }
    return 0;
  }

  private async rangeBody(prefix: string): Promise<string> {
    const now = this.dependencies.now();
    const cached = this.ranges.get(prefix);
    if (cached !== undefined && now - cached.at < RANGE_CACHE_TTL_MS) return cached.body;
    let body: string;
    try {
      body = await this.dependencies.fetchRange(prefix);
    } catch {
      throw new BreachCheckError("BREACH_CHECK_UNAVAILABLE");
    }
    if (typeof body !== "string" || body.length > 4 * 1024 * 1024)
      throw new BreachCheckError("BREACH_CHECK_UNAVAILABLE");
    for (const [key, value] of this.ranges) if (now - value.at >= RANGE_CACHE_TTL_MS) this.ranges.delete(key);
    while (this.ranges.size >= RANGE_CACHE_ENTRIES) {
      const oldest = this.ranges.keys().next().value;
      if (oldest === undefined) break;
      this.ranges.delete(oldest);
    }
    this.ranges.set(prefix, { at: now, body });
    return body;
  }
}

async function sha1Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  try {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", bytes));
    return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  } finally {
    bytes.fill(0);
  }
}
