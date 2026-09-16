import type { AliasRequest, AliasResponse } from "@shardpass/messaging";
import type { StoragePort } from "@shardpass/storage";

export type AliasErrorCode =
  "ALIAS_NOT_CONFIGURED" | "ALIAS_REJECTED" | "ALIAS_UNAVAILABLE" | "VAULT_LOCKED";

export class AliasError extends Error {
  constructor(readonly code: AliasErrorCode) {
    super(code);
    this.name = "AliasError";
  }
}

const INTEGRATIONS_KEY = "shardpass:v1:integrations";

/** A locked vault is the one sealing failure the person can do something about; the rest is a fault. */
function sealingError(error: unknown): AliasError {
  const code = (error as { code?: unknown } | null)?.code;
  return new AliasError(code === "VAULT_LOCKED" ? "VAULT_LOCKED" : "ALIAS_UNAVAILABLE");
}
const DUCK_PURPOSE = "duckduckgo-token";
const DUCK_DOMAIN = "duck.com";

/** A secret sealed under the vault key; readable only while the vault is open. */
export type SealedSecret = Readonly<{ nonce: string; ciphertext: string }>;

/** The addresses minted so far, sealed as one JSON list beside the token. */
type IntegrationsRecord = Readonly<{
  version: 1;
  duckduckgo?: SealedSecret;
  duckAddresses?: SealedSecret;
}>;
export type DuckAddress = Readonly<{ address: string; createdAt: number; site?: string }>;
const DUCK_LIST_PURPOSE = "duckduckgo-addresses";
const MAX_DUCK_ADDRESSES = 500;

type AliasDependencies = Readonly<{
  /** Non-secret storage: what it holds for this service is sealed before it lands here. */
  local: StoragePort;
  secrets: Readonly<{
    seal(purpose: string, plaintext: Uint8Array): Promise<SealedSecret>;
    open(purpose: string, sealed: SealedSecret): Promise<Uint8Array>;
  }>;
  /** Asks DuckDuckGo for a fresh private address (the part before @duck.com). */
  requestDuckAddress(token: string): Promise<string>;
  now?(): number;
}>;

/**
 * DuckDuckGo Email Protection aliases. The token lives sealed under the vault key: locked
 * vault, unreadable token. Every address is minted by DuckDuckGo on request; ShardPass
 * keeps none of them, the person saves the ones they use on the login they made them for.
 */
export class AliasService {
  constructor(private readonly dependencies: AliasDependencies) {}

  async handle(request: AliasRequest): Promise<AliasResponse> {
    switch (request.kind) {
      case "alias.getStatus":
        return this.status();
      case "alias.setDuckToken": {
        const token = request.token.trim().replace(/^Bearer\s+/iu, "");
        if (token === "") throw new AliasError("ALIAS_UNAVAILABLE");
        const sealed = await this.seal(new TextEncoder().encode(token));
        const record = await this.read();
        await this.dependencies.local.set({
          [INTEGRATIONS_KEY]: { ...record, duckduckgo: sealed },
        });
        return { version: 1, kind: "alias.status", duckduckgo: true };
      }
      case "alias.clearDuckToken": {
        // The token goes; the addresses stay, since they still forward mail.
        const { duckduckgo: _dropped, ...rest } = await this.read();
        void _dropped;
        await this.dependencies.local.set({ [INTEGRATIONS_KEY]: rest });
        return { version: 1, kind: "alias.status", duckduckgo: false };
      }
      case "alias.generateDuck": {
        const address = await this.generateDuckAddressOrThrow(request.site);
        return { version: 1, kind: "alias.generated", provider: "duckduckgo", address };
      }
      case "alias.listDuck": {
        const addresses = await this.readAddressesOrNull();
        if (addresses === null) throw new AliasError("VAULT_LOCKED");
        return { version: 1, kind: "alias.duckList", addresses };
      }
      case "alias.forgetDuck": {
        // An unreadable list is never overwritten: forgetting one address must not lose all.
        const addresses = await this.readAddressesOrNull();
        if (addresses === null) throw new AliasError("VAULT_LOCKED");
        const kept = addresses.filter((entry) => entry.address !== request.address);
        await this.writeAddresses(kept);
        return { version: 1, kind: "alias.duckList", addresses: kept };
      }
    }
  }

  /** Every address minted so far, newest first; empty while the vault is locked. */
  async readAddresses(): Promise<DuckAddress[]> {
    return (await this.readAddressesOrNull()) ?? [];
  }

  /** The list, or null when it exists but cannot be opened (a locked vault, a bad record). */
  private async readAddressesOrNull(): Promise<DuckAddress[] | null> {
    const record = await this.read();
    if (record.duckAddresses === undefined) return [];
    try {
      const plaintext = await this.dependencies.secrets.open(
        DUCK_LIST_PURPOSE,
        record.duckAddresses,
      );
      const parsed: unknown = JSON.parse(new TextDecoder().decode(plaintext));
      if (!Array.isArray(parsed)) return [];
      const addresses: DuckAddress[] = [];
      for (const entry of parsed) {
        const candidate = entry as {
          address?: unknown;
          createdAt?: unknown;
          site?: unknown;
        } | null;
        if (typeof candidate?.address !== "string" || !Number.isSafeInteger(candidate.createdAt))
          continue;
        addresses.push({
          address: candidate.address,
          createdAt: candidate.createdAt as number,
          ...(typeof candidate.site === "string" && candidate.site !== ""
            ? { site: candidate.site }
            : {}),
        });
      }
      return addresses;
    } catch {
      return null;
    }
  }

  private async writeAddresses(addresses: readonly DuckAddress[]): Promise<void> {
    const record = await this.read();
    try {
      const sealed = await this.dependencies.secrets.seal(
        DUCK_LIST_PURPOSE,
        new TextEncoder().encode(JSON.stringify(addresses.slice(0, MAX_DUCK_ADDRESSES))),
      );
      await this.dependencies.local.set({
        [INTEGRATIONS_KEY]: { ...record, duckAddresses: sealed },
      });
    } catch (error) {
      throw sealingError(error);
    }
  }

  /** A DuckDuckGo token is stored (readable or not). */
  async configured(): Promise<boolean> {
    return (await this.read()).duckduckgo !== undefined;
  }

  /** For a sign-up picker: an address, or null when nothing is configured or DuckDuckGo said no. */
  async generateDuckAddress(site?: string): Promise<string | null> {
    try {
      return await this.generateDuckAddressOrThrow(site);
    } catch {
      return null;
    }
  }

  private async generateDuckAddressOrThrow(site?: string): Promise<string> {
    const record = await this.read();
    if (record.duckduckgo === undefined) throw new AliasError("ALIAS_NOT_CONFIGURED");
    const token = new TextDecoder().decode(await this.open(record.duckduckgo));
    const local = (await this.dependencies.requestDuckAddress(token)).trim();
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/iu.test(local)) throw new AliasError("ALIAS_UNAVAILABLE");
    const address = `${local}@${DUCK_DOMAIN}`;
    // Remembered so the address is never lost between the mint and the sign-up that uses it.
    const trimmedSite = (site ?? "").trim();
    const entry: DuckAddress = {
      address,
      createdAt: this.dependencies.now?.() ?? Date.now(),
      ...(trimmedSite === "" ? {} : { site: trimmedSite }),
    };
    await this.writeAddresses([entry, ...(await this.readAddresses())]).catch(() => undefined);
    return address;
  }

  private async status(): Promise<AliasResponse> {
    return { version: 1, kind: "alias.status", duckduckgo: await this.configured() };
  }

  private async seal(plaintext: Uint8Array): Promise<SealedSecret> {
    try {
      return await this.dependencies.secrets.seal(DUCK_PURPOSE, plaintext);
    } catch (error) {
      throw sealingError(error);
    } finally {
      plaintext.fill(0);
    }
  }

  private async open(sealed: SealedSecret): Promise<Uint8Array> {
    try {
      return await this.dependencies.secrets.open(DUCK_PURPOSE, sealed);
    } catch (error) {
      throw sealingError(error);
    }
  }

  private async read(): Promise<IntegrationsRecord> {
    try {
      const stored = (await this.dependencies.local.get([INTEGRATIONS_KEY]))[INTEGRATIONS_KEY];
      if (typeof stored !== "object" || stored === null) return { version: 1 };
      const candidate = stored as {
        version?: unknown;
        duckduckgo?: unknown;
        duckAddresses?: unknown;
      };
      const duck = candidate.duckduckgo;
      const sealed =
        typeof duck === "object" &&
        duck !== null &&
        typeof (duck as { nonce?: unknown }).nonce === "string" &&
        typeof (duck as { ciphertext?: unknown }).ciphertext === "string"
          ? (duck as SealedSecret)
          : undefined;
      const list = candidate.duckAddresses as { nonce?: unknown; ciphertext?: unknown } | undefined;
      const sealedList =
        typeof list?.nonce === "string" && typeof list.ciphertext === "string"
          ? (list as SealedSecret)
          : undefined;
      return {
        version: 1,
        ...(sealed === undefined ? {} : { duckduckgo: sealed }),
        ...(sealedList === undefined ? {} : { duckAddresses: sealedList }),
      };
    } catch {
      return { version: 1 };
    }
  }
}
