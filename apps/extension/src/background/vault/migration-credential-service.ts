import { sha256 } from "@noble/hashes/sha2.js";
import {
  LEGACY_PBKDF2_ITERATIONS,
  LegacyEnvelopeSchema,
  parseLegacySettings,
  type LegacyEnvelope,
  type MigratedLockSettings,
} from "@shardpass/importers/legacy-v1";
import { decodeCanonicalBase64 } from "@shardpass/security";
import { canonicalJson, type StoragePort } from "@shardpass/storage";

import type { MigrationCapability, SenderBinding, SessionService } from "./session-service";

const LEGACY_VAULT_KEY = "vault";
const LEGACY_SETTINGS_KEY = "settings";
const CREDENTIAL_LIFETIME_MS = 30_000;
const MAX_OUTSTANDING_OPERATIONS = 32;
const OPAQUE_ID_ATTEMPTS = 8;
const OPAQUE_ID_PATTERN = /^[0-9a-f]{32}$/u;

type SessionCredentialPort = Pick<
  SessionService,
  | "beginMigration"
  | "assertMigrationCapability"
  | "assertMigrationCapabilityCurrent"
  | "onLockOrDispose"
>;
type Challenge = Readonly<{
  sender: SenderBinding;
  capability: MigrationCapability;
  sourceFingerprint: string;
  expiresAt: number;
}>;
export type LegacyMigrationSource = Readonly<{
  envelope: LegacyEnvelope;
  settings?: MigratedLockSettings;
}>;
type Credential = Readonly<{
  sender: SenderBinding;
  capability: MigrationCapability;
  sourceFingerprint: string;
  source: LegacyMigrationSource;
  key: Uint8Array;
  expiresAt: number;
}>;
type InFlightOperation = {
  readonly key: Uint8Array;
  readonly generation: number;
  cancelled: boolean;
};
type Dependencies = Readonly<{
  now(): number;
  nextOpaqueId(): string;
}>;

export type MigrationCredentialErrorCode =
  "CHALLENGE_INVALID" | "CREDENTIAL_INVALID" | "CREDENTIAL_UNAVAILABLE";

export class MigrationCredentialError extends Error {
  constructor(readonly code: MigrationCredentialErrorCode) {
    super(code);
    this.name = "MigrationCredentialError";
  }
}

export class MigrationCredentialService {
  private readonly challenges = new Map<string, Challenge>();
  private readonly credentials = new Map<string, Credential>();
  private readonly inFlight = new Set<InFlightOperation>();
  private readonly unregisterCleanup: () => void;
  private disposed = false;
  private invalidationGeneration = 0;
  private pendingIssuances = 0;

  constructor(
    private readonly storage: StoragePort,
    private readonly session: SessionCredentialPort,
    private readonly dependencies: Dependencies,
  ) {
    this.unregisterCleanup = session.onLockOrDispose(() => this.clear());
  }

  async getCredentialChallenge(senderInput: SenderBinding) {
    this.assertAvailable();
    const sender = captureSender(senderInput);
    this.pruneExpired();
    this.removeSenderChallenges(sender);
    this.assertCapacity();
    const generation = this.invalidationGeneration;
    this.pendingIssuances += 1;
    try {
      const capability = await this.session.beginMigration();
      this.assertIssuanceCurrent(generation);
      const source = await this.readSource();
      this.assertIssuanceCurrent(generation);
      this.session.assertMigrationCapabilityCurrent(capability);
      this.pruneExpired();
      this.removeSenderChallenges(sender);
      this.assertCapacity(0);
      const challengeId = this.uniqueId(this.challenges, this.credentials);
      const expiresAt = safeAdd(this.now(), CREDENTIAL_LIFETIME_MS);
      this.challenges.set(challengeId, {
        sender,
        capability,
        sourceFingerprint: fingerprint(source),
        expiresAt,
      });
      return {
        challengeId,
        kdf: {
          algorithm: "PBKDF2-HMAC-SHA-256" as const,
          salt: source.envelope.salt,
          iterations: LEGACY_PBKDF2_ITERATIONS,
          outputBytes: 32 as const,
        },
        expiresAt,
      };
    } finally {
      this.pendingIssuances -= 1;
    }
  }

  async authorizeCredential(
    challengeId: string,
    derivedKeyBase64: string,
    senderInput: SenderBinding,
  ) {
    const challenge = this.challenges.get(challengeId);
    this.challenges.delete(challengeId);
    let operation: InFlightOperation | null = null;
    try {
      const sender = captureSender(senderInput);
      if (
        this.disposed ||
        challenge === undefined ||
        this.now() >= challenge.expiresAt ||
        !sameSender(challenge.sender, sender)
      )
        throw new MigrationCredentialError("CHALLENGE_INVALID");
      operation = {
        key: decodeDerivedKey(derivedKeyBase64),
        generation: this.invalidationGeneration,
        cancelled: false,
      };
      this.inFlight.add(operation);
      await this.session.assertMigrationCapability(challenge.capability);
      this.assertAuthorizationCurrent(operation, challenge);
      const source = await this.readSource();
      this.assertAuthorizationCurrent(operation, challenge);
      if (fingerprint(source) !== challenge.sourceFingerprint)
        throw new MigrationCredentialError("CHALLENGE_INVALID");
      await this.session.assertMigrationCapability(challenge.capability);
      this.assertAuthorizationCurrent(operation, challenge);
      const current = await this.readSource();
      this.assertAuthorizationCurrent(operation, challenge);
      if (fingerprint(current) !== challenge.sourceFingerprint)
        throw new MigrationCredentialError("CHALLENGE_INVALID");
      this.session.assertMigrationCapabilityCurrent(challenge.capability);
      this.assertAuthorizationCurrent(operation, challenge);
      this.pruneExpired();
      this.removeSenderCredentials(challenge.sender);
      this.assertCapacity(1);
      const credentialToken = this.uniqueId(this.credentials, this.challenges);
      const expiresAt = Math.min(challenge.expiresAt, safeAdd(this.now(), CREDENTIAL_LIFETIME_MS));
      this.credentials.set(credentialToken, {
        sender: challenge.sender,
        capability: challenge.capability,
        sourceFingerprint: challenge.sourceFingerprint,
        source: immutableSource(source),
        key: operation.key,
        expiresAt,
      });
      this.inFlight.delete(operation);
      operation = null;
      return { credentialToken, expiresAt };
    } catch (error) {
      if (error instanceof MigrationCredentialError) throw error;
      throw new MigrationCredentialError("CHALLENGE_INVALID");
    } finally {
      if (operation !== null) {
        operation.key.fill(0);
        this.inFlight.delete(operation);
      }
    }
  }

  async withCredential<T>(
    credentialToken: string,
    senderInput: SenderBinding,
    callback: (derivedKey: Uint8Array, source: LegacyMigrationSource) => Promise<T> | T,
  ): Promise<T> {
    const credential = this.credentials.get(credentialToken);
    this.credentials.delete(credentialToken);
    if (credential === undefined) throw new MigrationCredentialError("CREDENTIAL_INVALID");
    const operation: InFlightOperation = {
      key: credential.key,
      generation: this.invalidationGeneration,
      cancelled: false,
    };
    this.inFlight.add(operation);
    try {
      const sender = captureSender(senderInput);
      this.assertConsumptionCurrent(operation, credential);
      if (!sameSender(credential.sender, sender))
        throw new MigrationCredentialError("CREDENTIAL_INVALID");
      await this.session.assertMigrationCapability(credential.capability);
      this.assertConsumptionCurrent(operation, credential);
      const source = await this.readSource();
      this.assertConsumptionCurrent(operation, credential);
      if (fingerprint(source) !== credential.sourceFingerprint)
        throw new MigrationCredentialError("CREDENTIAL_INVALID");
      await this.session.assertMigrationCapability(credential.capability);
      this.assertConsumptionCurrent(operation, credential);
      const current = await this.readSource();
      this.assertConsumptionCurrent(operation, credential);
      if (fingerprint(current) !== credential.sourceFingerprint)
        throw new MigrationCredentialError("CREDENTIAL_INVALID");
      this.session.assertMigrationCapabilityCurrent(credential.capability);
      this.assertConsumptionCurrent(operation, credential);
      return await callback(credential.key, credential.source);
    } catch (error) {
      if (error instanceof MigrationCredentialError) throw error;
      throw new MigrationCredentialError("CREDENTIAL_INVALID");
    } finally {
      credential.key.fill(0);
      this.inFlight.delete(operation);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unregisterCleanup();
    this.clear();
  }

  private clear(): void {
    this.invalidationGeneration += 1;
    this.challenges.clear();
    for (const credential of this.credentials.values()) credential.key.fill(0);
    this.credentials.clear();
    for (const operation of this.inFlight) {
      operation.cancelled = true;
      operation.key.fill(0);
    }
  }

  private assertIssuanceCurrent(generation: number): void {
    if (this.disposed || generation !== this.invalidationGeneration)
      throw new MigrationCredentialError("CREDENTIAL_UNAVAILABLE");
  }

  private assertAuthorizationCurrent(operation: InFlightOperation, challenge: Challenge): void {
    if (
      this.disposed ||
      operation.cancelled ||
      operation.generation !== this.invalidationGeneration ||
      this.now() >= challenge.expiresAt
    )
      throw new MigrationCredentialError("CHALLENGE_INVALID");
  }

  private assertConsumptionCurrent(operation: InFlightOperation, credential: Credential): void {
    if (
      this.disposed ||
      operation.cancelled ||
      operation.generation !== this.invalidationGeneration ||
      this.now() >= credential.expiresAt
    )
      throw new MigrationCredentialError("CREDENTIAL_INVALID");
  }

  private assertAvailable(): void {
    if (this.disposed) throw new MigrationCredentialError("CREDENTIAL_UNAVAILABLE");
  }

  private assertCapacity(additional = 1): void {
    if (
      this.challenges.size +
        this.credentials.size +
        this.inFlight.size +
        this.pendingIssuances +
        additional >
      MAX_OUTSTANDING_OPERATIONS
    )
      throw new MigrationCredentialError("CREDENTIAL_UNAVAILABLE");
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [id, challenge] of this.challenges)
      if (now >= challenge.expiresAt) this.challenges.delete(id);
    for (const [id, credential] of this.credentials) {
      if (now < credential.expiresAt) continue;
      credential.key.fill(0);
      this.credentials.delete(id);
    }
  }

  private removeSenderChallenges(sender: SenderBinding): void {
    for (const [id, challenge] of this.challenges)
      if (sameSender(challenge.sender, sender)) this.challenges.delete(id);
  }

  private removeSenderCredentials(sender: SenderBinding): void {
    for (const [id, credential] of this.credentials) {
      if (!sameSender(credential.sender, sender)) continue;
      credential.key.fill(0);
      this.credentials.delete(id);
    }
  }

  private async readSource(): Promise<LegacyMigrationSource> {
    const values = await this.storage.get([LEGACY_VAULT_KEY, LEGACY_SETTINGS_KEY]);
    const parsed = LegacyEnvelopeSchema.safeParse(values[LEGACY_VAULT_KEY]);
    if (!parsed.success) throw new MigrationCredentialError("CREDENTIAL_UNAVAILABLE");
    try {
      const settings =
        values[LEGACY_SETTINGS_KEY] === undefined
          ? undefined
          : parseLegacySettings(values[LEGACY_SETTINGS_KEY]);
      return immutableSource({
        envelope: parsed.data,
        ...(settings === undefined ? {} : { settings }),
      });
    } catch {
      throw new MigrationCredentialError("CREDENTIAL_UNAVAILABLE");
    }
  }

  private uniqueId(
    primary: ReadonlyMap<string, unknown>,
    secondary: ReadonlyMap<string, unknown>,
  ): string {
    for (let attempt = 0; attempt < OPAQUE_ID_ATTEMPTS; attempt++) {
      const candidate = this.dependencies.nextOpaqueId();
      if (OPAQUE_ID_PATTERN.test(candidate) && !primary.has(candidate) && !secondary.has(candidate))
        return candidate;
    }
    throw new MigrationCredentialError("CREDENTIAL_UNAVAILABLE");
  }

  private now(): number {
    const value = this.dependencies.now();
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }
}

function captureSender(sender: SenderBinding): SenderBinding {
  const extensionId = sender.extensionId;
  const contextKind = sender.contextKind;
  const senderUrl = sender.senderUrl;
  const documentId = sender.documentId;
  const tabId = sender.tabId;
  const frameId = sender.frameId;
  if (
    extensionId.length === 0 ||
    contextKind !== "vault" ||
    senderUrl !== `chrome-extension://${extensionId}/vault/index.html` ||
    documentId.length === 0
  )
    throw new MigrationCredentialError("CREDENTIAL_UNAVAILABLE");
  return Object.freeze({
    extensionId,
    contextKind,
    senderUrl,
    documentId,
    ...(tabId === undefined ? {} : { tabId }),
    ...(frameId === undefined ? {} : { frameId }),
  });
}
function sameSender(left: SenderBinding, right: SenderBinding): boolean {
  return (
    left.extensionId === right.extensionId &&
    left.contextKind === right.contextKind &&
    left.senderUrl === right.senderUrl &&
    left.documentId === right.documentId &&
    left.tabId === right.tabId &&
    left.frameId === right.frameId
  );
}
function decodeDerivedKey(value: string): Uint8Array {
  const decoded = decodeCanonicalBase64(value, 32, 32);
  if (decoded === null) throw new MigrationCredentialError("CHALLENGE_INVALID");
  return decoded;
}
function immutableSource(source: LegacyMigrationSource): LegacyMigrationSource {
  return Object.freeze({
    envelope: Object.freeze({ ...source.envelope }),
    ...(source.settings === undefined ? {} : { settings: Object.freeze({ ...source.settings }) }),
  });
}
function fingerprint(source: LegacyMigrationSource): string {
  return [...sha256(new TextEncoder().encode(canonicalJson(source)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function safeAdd(left: number, right: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, left + right);
}
