import type { DataFillRequest, DataFillResponse, SenderContext } from "@shardpass/messaging";

import type { SessionVaultRepository } from "../vault/session-vault-repository";

export type DataFillServiceErrorCode =
  | "DATA_FILL_INVALID"
  | "DATA_FILL_NOT_FOUND"
  | "DATA_FILL_UNAVAILABLE"
  | "REPROMPT_REQUIRED"
  | "VAULT_LOCKED";

export class DataFillServiceError extends Error {
  constructor(readonly code: DataFillServiceErrorCode) {
    super(code);
    this.name = "DataFillServiceError";
  }
}

type DataFillServiceDependencies = Readonly<{
  repository: Pick<SessionVaultRepository, "getItem">;
  now(): number;
  notePrivilegedActivity(): Promise<void>;
  repromptGranted?(itemId: string): boolean;
}>;

/** A grant lives long enough for the popup to reach the tab and the tab to ask. */
const GRANT_TTL_MS = 60_000;
const MAX_GRANTS = 32;

/**
 * Cards and identities are filled only on the popup's say-so: a grant names one item for
 * one tab, and that tab's content script collects the values once. Nothing here matches a
 * page to an item, since neither kind belongs to a site.
 */
export class DataFillService {
  private readonly grants = new Map<string, Readonly<{ tabId: number; expiresAt: number }>>();

  constructor(private readonly dependencies: DataFillServiceDependencies) {}

  async handle(request: DataFillRequest, sender: SenderContext): Promise<DataFillResponse> {
    try {
      switch (request.kind) {
        case "data.fillGrant":
          return await this.grant(request.itemId, request.tabId);
        case "data.fillSelect":
          return await this.select(request.itemId, sender);
      }
    } catch (error) {
      throw mapError(error);
    }
  }

  private async grant(itemId: string, tabId: number): Promise<DataFillResponse> {
    const item = await this.dependencies.repository.getItem(itemId);
    if (
      item === null ||
      (item.kind !== "card" && item.kind !== "identity") ||
      item.deletedAt !== undefined
    )
      throw new DataFillServiceError("DATA_FILL_NOT_FOUND");
    if (item.reprompt === true && !(this.dependencies.repromptGranted?.(item.id) ?? false))
      throw new DataFillServiceError("REPROMPT_REQUIRED");
    const now = this.dependencies.now();
    for (const [id, entry] of this.grants) if (entry.expiresAt <= now) this.grants.delete(id);
    while (this.grants.size >= MAX_GRANTS) {
      const oldest = this.grants.keys().next().value;
      if (oldest === undefined) break;
      this.grants.delete(oldest);
    }
    const expiresAt = now + GRANT_TTL_MS;
    this.grants.set(itemId, { tabId, expiresAt });
    await this.dependencies.notePrivilegedActivity();
    return { version: 1, kind: "data.fillGranted", itemId, expiresAt };
  }

  private async select(itemId: string, sender: SenderContext): Promise<DataFillResponse> {
    const grant = this.grants.get(itemId);
    this.grants.delete(itemId);
    const tabId = "tabId" in sender ? sender.tabId : undefined;
    if (
      grant === undefined ||
      tabId === undefined ||
      grant.tabId !== tabId ||
      grant.expiresAt <= this.dependencies.now()
    )
      throw new DataFillServiceError("DATA_FILL_INVALID");
    const item = await this.dependencies.repository.getItem(itemId);
    if (item === null || item.deletedAt !== undefined)
      throw new DataFillServiceError("DATA_FILL_NOT_FOUND");
    if (item.kind === "card")
      return {
        version: 1,
        kind: "data.fillRelease",
        data: "card",
        card: {
          number: item.number,
          cardholderName: item.cardholderName,
          expMonth: item.expMonth,
          expYear: item.expYear,
          cvv: item.cvv,
        },
      };
    if (item.kind === "identity")
      return {
        version: 1,
        kind: "data.fillRelease",
        data: "identity",
        identity: {
          firstName: item.firstName,
          ...(item.middleName === undefined ? {} : { middleName: item.middleName }),
          lastName: item.lastName,
          email: item.email,
          phone: item.phone,
          ...(item.company === undefined ? {} : { company: item.company }),
          ...(item.username === undefined ? {} : { username: item.username }),
          street: item.street,
          ...(item.address2 === undefined ? {} : { address2: item.address2 }),
          city: item.city,
          state: item.state,
          zip: item.zip,
          country: item.country,
          ...(item.birthDate === undefined ? {} : { birthDate: item.birthDate }),
        },
      };
    throw new DataFillServiceError("DATA_FILL_NOT_FOUND");
  }
}

function mapError(error: unknown): DataFillServiceError {
  if (error instanceof DataFillServiceError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "VAULT_LOCKED") return new DataFillServiceError("VAULT_LOCKED");
  return new DataFillServiceError("DATA_FILL_UNAVAILABLE");
}
