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
const DUCK_PURPOSE = "duckduckgo-token";
const DUCK_DOMAIN = "duck.com";

/** A secret sealed under the vault key; readable only while the vault is open. */
export type SealedSecret = Readonly<{ nonce: string; ciphertext: string }>;

type IntegrationsRecord = Readonly<{ version: 1; duckduckgo?: SealedSecret }>;

type AliasDependencies = Readonly<{
  /** Non-secret storage: what it holds for this service is sealed before it lands here. */
  local: StoragePort;
  secrets: Readonly<{
    seal(purpose: string, plaintext: Uint8Array): Promise<SealedSecret>;
    open(purpose: string, sealed: SealedSecret): Promise<Uint8Array>;
  }>;
  /** Asks DuckDuckGo for a fresh private address (the part before @duck.com). */
  requestDuckAddress(token: string): Promise<string>;
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
        const { duckduckgo: _dropped, ...rest } = await this.read();
        void _dropped;
        await this.dependencies.local.set({ [INTEGRATIONS_KEY]: rest });
        return { version: 1, kind: "alias.status", duckduckgo: false };
      }
      case "alias.generateDuck": {
        const address = await this.generateDuckAddressOrThrow();
        return { version: 1, kind: "alias.generated", provider: "duckduckgo", address };
      }
    }
  }

  /** A DuckDuckGo token is stored (readable or not). */
  async configured(): Promise<boolean> {
    return (await this.read()).duckduckgo !== undefined;
  }

  /** For a sign-up picker: an address, or null when nothing is configured or DuckDuckGo said no. */
  async generateDuckAddress(): Promise<string | null> {
    try {
      return await this.generateDuckAddressOrThrow();
    } catch {
      return null;
    }
  }

  private async generateDuckAddressOrThrow(): Promise<string> {
    const record = await this.read();
    if (record.duckduckgo === undefined) throw new AliasError("ALIAS_NOT_CONFIGURED");
    const token = new TextDecoder().decode(await this.open(record.duckduckgo));
    const local = (await this.dependencies.requestDuckAddress(token)).trim();
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/iu.test(local)) throw new AliasError("ALIAS_UNAVAILABLE");
    return `${local}@${DUCK_DOMAIN}`;
  }

  private async status(): Promise<AliasResponse> {
    return { version: 1, kind: "alias.status", duckduckgo: await this.configured() };
  }

  private async seal(plaintext: Uint8Array): Promise<SealedSecret> {
    try {
      return await this.dependencies.secrets.seal(DUCK_PURPOSE, plaintext);
    } catch {
      throw new AliasError("VAULT_LOCKED");
    } finally {
      plaintext.fill(0);
    }
  }

  private async open(sealed: SealedSecret): Promise<Uint8Array> {
    try {
      return await this.dependencies.secrets.open(DUCK_PURPOSE, sealed);
    } catch {
      throw new AliasError("VAULT_LOCKED");
    }
  }

  private async read(): Promise<IntegrationsRecord> {
    try {
      const stored = (await this.dependencies.local.get([INTEGRATIONS_KEY]))[INTEGRATIONS_KEY];
      if (typeof stored !== "object" || stored === null) return { version: 1 };
      const candidate = stored as { version?: unknown; duckduckgo?: unknown };
      const duck = candidate.duckduckgo;
      const sealed =
        typeof duck === "object" &&
        duck !== null &&
        typeof (duck as { nonce?: unknown }).nonce === "string" &&
        typeof (duck as { ciphertext?: unknown }).ciphertext === "string"
          ? (duck as SealedSecret)
          : undefined;
      return { version: 1, ...(sealed === undefined ? {} : { duckduckgo: sealed }) };
    } catch {
      return { version: 1 };
    }
  }
}
