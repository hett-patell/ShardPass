import { matchLoginUrls } from "@shardpass/autofill";
import {
  ITEM_SCHEMA_VERSION,
  MAX_LOGIN_PASSKEYS,
  type LoginItem,
  type LoginPasskey,
} from "@shardpass/domain";
import {
  PasskeyRequestSchema,
  PasskeyResponseSchema,
  type PasskeyRequest,
  type PasskeyResponse,
  type SenderContext,
} from "@shardpass/messaging";
import {
  ES256,
  PASSKEY_FLAGS,
  buildAttestationObject,
  buildAuthenticatorData,
  fromBase64Url,
  generateEs256KeyPair,
  isRegistrableRpId,
  newCredentialId,
  signAssertion,
  toBase64Url,
} from "@shardpass/passkeys";

import type { SessionVaultRepository } from "../vault/session-vault-repository";
import { diagnostics } from "../../platform/diagnostics";

type PasskeyRepository = Pick<
  SessionVaultRepository,
  "listAllItems" | "getItem" | "createItem" | "updateItem"
>;

export type PasskeyServiceErrorCode =
  | "VAULT_LOCKED"
  | "VAULT_UNAVAILABLE"
  | "PASSKEY_INVALID"
  | "PASSKEY_NOT_FOUND"
  | "PASSKEY_EXISTS"
  | "PASSKEY_UNSUPPORTED";

export class PasskeyServiceError extends Error {
  constructor(readonly code: PasskeyServiceErrorCode) {
    super(code);
    this.name = "PasskeyServiceError";
  }
}

type PasskeyServiceDependencies = Readonly<{
  repository: PasskeyRepository;
  now(): number;
  notePrivilegedActivity(): Promise<void>;
}>;

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

/**
 * The vault as a WebAuthn authenticator. Keys are ES256 pairs generated here and kept on
 * the login item they belong to; user verification is the unlocked vault itself. Every
 * request names the page origin, and the relying-party id must be that origin's host or a
 * parent domain of it -- a page can never mint or use a passkey for another site.
 */
export class PasskeyService {
  constructor(private readonly dependencies: PasskeyServiceDependencies) {}

  async handle(request: PasskeyRequest, sender: SenderContext): Promise<PasskeyResponse> {
    // The origin a ceremony is bound to is the browser's own word on the sender, never a
    // value the page script put in the message.
    if ("origin" in request) {
      const pageOrigin = originOf(sender.senderUrl);
      if (pageOrigin === null || request.origin !== pageOrigin) invalid();
    }
    try {
      const parsed = PasskeyRequestSchema.safeParse(request);
      if (!parsed.success) invalid();
      if (sender.contextKind !== "content") invalid();
      const command = parsed.data;
      switch (command.kind) {
        case "passkey.preview":
          return validated(await this.preview(command.rpId, command.userName));
        case "passkey.register":
          return validated(await this.register(command));
        case "passkey.candidates":
          return validated(await this.candidates(command));
        case "passkey.assert":
          return validated(await this.assert(command));
      }
    } catch (error) {
      throw mapError(error);
    }
  }

  private async logins(): Promise<LoginItem[]> {
    const items = await this.dependencies.repository.listAllItems();
    return items.filter(
      (item): item is LoginItem => item.kind === "login" && item.deletedAt === undefined,
    );
  }

  private async matchingLogin(rpId: string, userName: string): Promise<LoginItem | null> {
    const wanted = normalize(userName);
    const site = `https://${rpId}`;
    const candidates = (await this.logins()).filter((item) =>
      matchLoginUrls(site, item.urls, item.urlMatches),
    );
    return candidates.find((item) => normalize(item.username) === wanted) ?? null;
  }

  private async preview(rpId: string, userName: string): Promise<PasskeyResponse> {
    const login = await this.matchingLogin(rpId, userName);
    return {
      version: 1,
      kind: "passkey.previewResult",
      login:
        login === null ? null : { itemId: login.id, name: login.name, username: login.username },
    };
  }

  private async register(
    command: Extract<PasskeyRequest, { kind: "passkey.register" }>,
  ): Promise<PasskeyResponse> {
    if (!isRegistrableRpId(command.origin, command.rpId)) invalid();
    if (!command.algorithms.includes(ES256)) throw new PasskeyServiceError("PASSKEY_UNSUPPORTED");
    const excluded = new Set(command.excludeCredentialIds);
    const all = await this.logins();
    if (
      all.some((item) =>
        (item.passkeys ?? []).some(
          (key) => key.rpId === command.rpId && excluded.has(key.credentialId),
        ),
      )
    )
      throw new PasskeyServiceError("PASSKEY_EXISTS");

    let target: LoginItem | null;
    if (command.attachTo !== undefined) {
      const item = await this.dependencies.repository.getItem(command.attachTo);
      if (item === null || item.kind !== "login")
        throw new PasskeyServiceError("PASSKEY_NOT_FOUND");
      target = item;
    } else target = await this.matchingLogin(command.rpId, command.userName);
    if (target !== null && (target.passkeys?.length ?? 0) >= MAX_LOGIN_PASSKEYS) invalid();

    const pair = await generateEs256KeyPair();
    const credentialId = newCredentialId();
    const stamp = new Date(this.dependencies.now()).toISOString();
    const passkey: LoginPasskey = {
      credentialId: toBase64Url(credentialId),
      rpId: command.rpId,
      ...(command.rpName === "" ? {} : { rpName: command.rpName }),
      userHandle: command.userHandle,
      userName: command.userName,
      ...(command.userDisplayName === "" ? {} : { userDisplayName: command.userDisplayName }),
      algorithm: -7,
      privateKey: toBase64Url(pair.privateKey),
      publicKey: toBase64Url(pair.publicKeyCose),
      counter: 0,
      createdAt: stamp,
    };
    const authenticatorData = await buildAuthenticatorData({
      rpId: command.rpId,
      flags: PASSKEY_FLAGS,
      counter: 0,
      attestedCredential: { credentialId, publicKeyCose: pair.publicKeyCose },
    });

    let saved: LoginItem;
    if (target === null) {
      const created = await this.dependencies.repository.createItem({
        id: crypto.randomUUID(),
        kind: "login",
        schemaVersion: ITEM_SCHEMA_VERSION,
        revision: 1,
        createdAt: stamp,
        updatedAt: stamp,
        favorite: false,
        tags: [],
        name: command.rpName === "" ? command.rpId : command.rpName,
        username: command.userName,
        password: "",
        urls: [`https://${command.rpId}`],
        notes: "",
        passkeys: [passkey],
      });
      if (created.kind !== "login") throw new PasskeyServiceError("VAULT_UNAVAILABLE");
      saved = created;
    } else {
      const updated = await this.dependencies.repository.updateItem(
        { ...target, passkeys: [...(target.passkeys ?? []), passkey] },
        target.revision,
      );
      if (updated.kind !== "login") throw new PasskeyServiceError("VAULT_UNAVAILABLE");
      saved = updated;
    }
    await this.noteActivity();
    return {
      version: 1,
      kind: "passkey.registerResult",
      itemId: saved.id,
      credentialId: passkey.credentialId,
      attestationObject: toBase64Url(buildAttestationObject(authenticatorData)),
      authenticatorData: toBase64Url(authenticatorData),
      publicKey: toBase64Url(pair.publicKeySpki),
      publicKeyAlgorithm: -7,
    };
  }

  private async candidates(
    command: Extract<PasskeyRequest, { kind: "passkey.candidates" }>,
  ): Promise<PasskeyResponse> {
    if (!isRegistrableRpId(command.origin, command.rpId)) invalid();
    const allowed = new Set(command.allowCredentialIds);
    const candidates = [];
    for (const item of await this.logins()) {
      for (const key of item.passkeys ?? []) {
        if (key.rpId !== command.rpId) continue;
        if (allowed.size > 0 && !allowed.has(key.credentialId)) continue;
        candidates.push({
          itemId: item.id,
          credentialId: key.credentialId,
          userName: key.userName,
          loginName: item.name,
        });
      }
    }
    return { version: 1, kind: "passkey.candidatesResult", candidates };
  }

  private async assert(
    command: Extract<PasskeyRequest, { kind: "passkey.assert" }>,
  ): Promise<PasskeyResponse> {
    if (!isRegistrableRpId(command.origin, command.rpId)) invalid();
    const item = await this.dependencies.repository.getItem(command.itemId);
    if (item === null || item.kind !== "login") throw new PasskeyServiceError("PASSKEY_NOT_FOUND");
    const key = (item.passkeys ?? []).find(
      (candidate) => candidate.credentialId === command.credentialId,
    );
    if (key === undefined || key.rpId !== command.rpId)
      throw new PasskeyServiceError("PASSKEY_NOT_FOUND");
    // Synced passkeys keep the counter at zero (WebAuthn §6.1.1): a counter that advanced
    // on one device would make every other copy look cloned.
    const authenticatorData = await buildAuthenticatorData({
      rpId: command.rpId,
      flags: PASSKEY_FLAGS,
      counter: 0,
    });
    const signature = await signAssertion(
      fromBase64Url(key.privateKey),
      authenticatorData,
      fromBase64Url(command.clientDataJson),
    );
    const stamp = new Date(this.dependencies.now()).toISOString();
    try {
      await this.dependencies.repository.updateItem(
        {
          ...item,
          passkeys: (item.passkeys ?? []).map((candidate) =>
            candidate.credentialId === key.credentialId
              ? { ...candidate, lastUsedAt: stamp }
              : candidate,
          ),
        },
        item.revision,
      );
    } catch {
      // Recording the use is a courtesy; the sign-in must not fail on a concurrent edit.
    }
    await this.noteActivity();
    return {
      version: 1,
      kind: "passkey.assertResult",
      credentialId: key.credentialId,
      authenticatorData: toBase64Url(authenticatorData),
      signature: toBase64Url(signature),
      userHandle: key.userHandle,
    };
  }

  private async noteActivity(): Promise<void> {
    try {
      await this.dependencies.notePrivilegedActivity();
    } catch {
      // Best effort.
    }
  }
}

function validated(candidate: PasskeyResponse): PasskeyResponse {
  const parsed = PasskeyResponseSchema.safeParse(candidate);
  if (!parsed.success) throw new PasskeyServiceError("VAULT_UNAVAILABLE");
  return Object.freeze(parsed.data);
}

function invalid(): never {
  throw new PasskeyServiceError("PASSKEY_INVALID");
}

function mapError(error: unknown): PasskeyServiceError {
  if (error instanceof PasskeyServiceError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "VAULT_LOCKED") return new PasskeyServiceError("VAULT_LOCKED");
  if (code === "VAULT_INVALID") return new PasskeyServiceError("PASSKEY_INVALID");
  diagnostics.error("[ShardPass] passkey operation failed; reported as VAULT_UNAVAILABLE:", error);
  return new PasskeyServiceError("VAULT_UNAVAILABLE");
}

function originOf(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}
