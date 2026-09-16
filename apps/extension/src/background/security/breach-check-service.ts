import type { SecurityRequest, SecurityResponse } from "@shardpass/messaging";
import type { StoragePort } from "@shardpass/storage";

import type { SessionVaultRepository } from "../vault/session-vault-repository";

export type BreachCheckErrorCode =
  | "BREACH_CHECK_DISABLED"
  | "BREACH_CHECK_UNAVAILABLE"
  | "ITEM_NOT_FOUND"
  | "REPROMPT_REQUIRED"
  | "VAULT_LOCKED";

export class BreachCheckError extends Error {
  constructor(readonly code: BreachCheckErrorCode) {
    super(code);
    this.name = "BreachCheckError";
  }
}

const SETTINGS_KEY = "shardpass:v1:breach-checks";
/** Remembered results, sealed under the vault key: which logins were checked, when, and what was found. */
const RESULTS_KEY = "shardpass:v1:breach-results";
const RESULTS_PURPOSE = "breach-results";
const MAX_REMEMBERED_RESULTS = 10_000;
/** A range answer changes rarely; an hour of reuse keeps repeated checks off the network. */
const RANGE_CACHE_TTL_MS = 60 * 60_000;
const RANGE_CACHE_ENTRIES = 64;

export type SealedSecret = Readonly<{ nonce: string; ciphertext: string }>;
/** One remembered verdict: a digest of the password it was for, the count, and when. */
type StoredResult = Readonly<{ d: string; c: number; t: number }>;
type StoredResults = Record<string, StoredResult>;

type BreachCheckDependencies = Readonly<{
  repository: Pick<SessionVaultRepository, "getItem"> &
    Partial<Pick<SessionVaultRepository, "listAllItems">>;
  /** Seals the remembered results under the vault key; without it nothing is remembered. */
  secrets?: Readonly<{
    seal(purpose: string, plaintext: Uint8Array): Promise<SealedSecret>;
    open(purpose: string, sealed: SealedSecret): Promise<Uint8Array>;
  }>;
  /** Non-secret preference; local storage so it survives a browser restart. */
  local: StoragePort;
  /** Whether an item's master-password re-prompt has been answered recently. */
  repromptGranted?(itemId: string): boolean;
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
        await this.dependencies.local.set({
          [SETTINGS_KEY]: { version: 1, enabled: request.enabled },
        });
        if (!request.enabled) this.ranges.clear();
        return { version: 1, kind: "security.settings", breachChecks: request.enabled };
      case "security.checkItem": {
        if (!(await this.enabled())) throw new BreachCheckError("BREACH_CHECK_DISABLED");
        const password = await this.passwordOf(request.itemId);
        const digest = await passwordDigest(password);
        const remembered = await this.readResults();
        const known = remembered[request.itemId];
        // A password checked once stays checked until it changes; asking again is a choice.
        if (request.force !== true && known !== undefined && known.d === digest)
          return {
            version: 1,
            kind: "security.breachResult",
            itemId: request.itemId,
            count: known.c,
            checkedAt: known.t,
          };
        const count = await this.countFor(password);
        const checkedAt = this.dependencies.now();
        remembered[request.itemId] = { d: digest, c: count, t: checkedAt };
        await this.writeResults(remembered);
        return {
          version: 1,
          kind: "security.breachResult",
          itemId: request.itemId,
          count,
          checkedAt,
        };
      }
      case "security.listResults":
        return {
          version: 1,
          kind: "security.results",
          results: await this.listResults(request.itemId),
        };
    }
  }

  /**
   * The remembered verdicts, each marked stale when its login's password has changed since.
   * Verdicts for logins that no longer exist are dropped on the way.
   */
  private async listResults(
    itemId: string | undefined,
  ): Promise<{ itemId: string; count: number; checkedAt: number; stale: boolean }[]> {
    const remembered = await this.readResults();
    const results: { itemId: string; count: number; checkedAt: number; stale: boolean }[] = [];
    let changed = false;
    const passwords = new Map<string, string | null>();
    if (itemId !== undefined) {
      if (remembered[itemId] === undefined) return [];
      passwords.set(itemId, await this.passwordOrNull(itemId));
    } else if (this.dependencies.repository.listAllItems !== undefined) {
      let items: Awaited<ReturnType<NonNullable<SessionVaultRepository["listAllItems"]>>>;
      try {
        items = await this.dependencies.repository.listAllItems();
      } catch (error) {
        const code = (error as { code?: unknown } | null)?.code;
        throw new BreachCheckError(
          code === "VAULT_LOCKED" ? "VAULT_LOCKED" : "BREACH_CHECK_UNAVAILABLE",
        );
      }
      for (const id of Object.keys(remembered)) passwords.set(id, null);
      for (const item of items)
        if (item.kind === "login" && remembered[item.id] !== undefined)
          passwords.set(item.id, item.password === "" ? null : item.password);
    }
    for (const [id, password] of passwords) {
      const known = remembered[id];
      if (known === undefined) continue;
      if (password === null) {
        delete remembered[id];
        changed = true;
        continue;
      }
      results.push({
        itemId: id,
        count: known.c,
        checkedAt: known.t,
        stale: (await passwordDigest(password)) !== known.d,
      });
    }
    if (changed) await this.writeResults(remembered);
    return results;
  }

  private async passwordOrNull(itemId: string): Promise<string | null> {
    try {
      return await this.passwordOf(itemId);
    } catch (error) {
      if (error instanceof BreachCheckError && error.code === "VAULT_LOCKED") throw error;
      return null;
    }
  }

  private async readResults(): Promise<StoredResults> {
    const secrets = this.dependencies.secrets;
    if (secrets === undefined) return {};
    try {
      const stored = (await this.dependencies.local.get([RESULTS_KEY]))[RESULTS_KEY] as
        { version?: unknown; sealed?: unknown } | undefined;
      const sealed = stored?.sealed as { nonce?: unknown; ciphertext?: unknown } | undefined;
      if (
        stored?.version !== 1 ||
        typeof sealed?.nonce !== "string" ||
        typeof sealed.ciphertext !== "string"
      )
        return {};
      const plaintext = await secrets.open(RESULTS_PURPOSE, sealed as SealedSecret);
      const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
      const results: StoredResults = {};
      for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
        const entry = value as { d?: unknown; c?: unknown; t?: unknown } | null;
        if (
          typeof entry?.d === "string" &&
          Number.isSafeInteger(entry.c) &&
          Number.isSafeInteger(entry.t)
        )
          results[id] = { d: entry.d, c: entry.c as number, t: entry.t as number };
      }
      return results;
    } catch {
      // Unreadable (a locked vault, a vault reset under it): as good as never checked.
      return {};
    }
  }

  private async writeResults(results: StoredResults): Promise<void> {
    const secrets = this.dependencies.secrets;
    if (secrets === undefined) return;
    const entries = Object.entries(results)
      .sort(([, left], [, right]) => right.t - left.t)
      .slice(0, MAX_REMEMBERED_RESULTS);
    try {
      const sealed = await secrets.seal(
        RESULTS_PURPOSE,
        new TextEncoder().encode(JSON.stringify(Object.fromEntries(entries))),
      );
      await this.dependencies.local.set({ [RESULTS_KEY]: { version: 1, sealed } });
    } catch {
      // Remembering is a convenience; the verdict was still answered.
    }
  }

  private async enabled(): Promise<boolean> {
    const stored = (await this.dependencies.local.get([SETTINGS_KEY]))[SETTINGS_KEY] as
      { version?: unknown; enabled?: unknown } | undefined;
    return stored?.version === 1 && stored.enabled === true;
  }

  private async passwordOf(itemId: string): Promise<string> {
    let item: Awaited<ReturnType<SessionVaultRepository["getItem"]>>;
    try {
      item = await this.dependencies.repository.getItem(itemId);
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      throw new BreachCheckError(
        code === "VAULT_LOCKED" ? "VAULT_LOCKED" : "BREACH_CHECK_UNAVAILABLE",
      );
    }
    if (item === null || item.kind !== "login" || item.password === "")
      throw new BreachCheckError("ITEM_NOT_FOUND");
    // Only a hash prefix would leave, but a re-prompted login is read only once answered,
    // the same rule every other reader of its password follows.
    if (item.reprompt === true && !(this.dependencies.repromptGranted?.(itemId) ?? false))
      throw new BreachCheckError("REPROMPT_REQUIRED");
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
    for (const [key, value] of this.ranges)
      if (now - value.at >= RANGE_CACHE_TTL_MS) this.ranges.delete(key);
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

/** Enough of a SHA-256 to tell a changed password from the one checked; sealed at rest anyway. */
async function passwordDigest(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(password);
  try {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return Array.from(digest.subarray(0, 12), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  } finally {
    bytes.fill(0);
  }
}
