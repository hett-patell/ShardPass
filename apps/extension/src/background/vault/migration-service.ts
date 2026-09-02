import { sha256 } from "@noble/hashes/sha2.js";
import {
  LegacyEnvelopeSchema,
  LegacyMigrationError,
  decryptLegacyVaultWithDerivedKey,
  inspectLegacyVault,
  mapLegacyAccount,
  mapLegacyEnteState,
  parseLegacySettings,
} from "@shardpass/importers/legacy-v1";
import type { MigrationRequest, MigrationResponse } from "@shardpass/messaging";
import { generateOtp } from "@shardpass/otp";
import { canonicalJson, type StoragePort } from "@shardpass/storage";

import type {
  LegacyMigrationSource,
  MigrationCredentialService,
} from "./migration-credential-service";
import type {
  DestinationPayload as MigrationPayload,
  DestinationStage as MigrationStage,
} from "./migration-destination";
import type { SenderBinding } from "./session-service";

const LEGACY_VAULT_KEY = "vault";
const LEGACY_SETTINGS_KEY = "settings";
export type MigrationPhase = "none" | "staged" | "verified" | "completed" | "failed";
export type MigrationStatus = Readonly<{
  phase: MigrationPhase;
  itemCount: number;
  guidance?: "retry-or-export";
}>;
export type MigrationInspection = MigrationStatus & Readonly<{ available: boolean }>;
type Expectations = readonly Readonly<{
  itemId: string;
  timestamp: number;
  code: string;
  counter: number;
}>[];
type Dependencies = Readonly<{ expectations?: Expectations }>;
type CredentialPort = Pick<
  MigrationCredentialService,
  "getCredentialChallenge" | "authorizeCredential" | "withCredential"
>;
export interface MigrationDestination {
  stage(input: { payload: MigrationPayload; sourceFingerprint: string }): Promise<MigrationStage>;
  verify(stage: MigrationStage): Promise<MigrationPayload>;
  activate(stage: MigrationStage): Promise<void>;
  assertSource(stage: MigrationStage, sourceFingerprint: string): Promise<void>;
  reconcile(): Promise<{
    phase: MigrationPhase;
    generationId?: string;
    stage?: MigrationStage;
    itemCount?: number;
  }>;
}

class Mutex {
  private tail = Promise.resolve();
  run<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export class MigrationService {
  private readonly mutex = new Mutex();
  constructor(
    private readonly storage: StoragePort,
    private readonly destination: MigrationDestination,
    private readonly credentials: CredentialPort,
    private readonly dependencies: Dependencies = {},
  ) {}

  async handle(request: MigrationRequest, sender: SenderBinding): Promise<MigrationResponse> {
    switch (request.kind) {
      case "migration.getCredentialChallenge": {
        const challenge = await this.credentials.getCredentialChallenge(sender);
        return {
          version: 1,
          kind: "migration.credentialChallenge",
          ...challenge,
          kdf: { ...challenge.kdf, iterations: 600_000 as const },
        };
      }
      case "migration.authorizeCredential": {
        const authorization = await this.credentials.authorizeCredential(
          request.challengeId,
          request.derivedKey,
          sender,
        );
        return { version: 1, kind: "migration.credentialAuthorized", ...authorization };
      }
      case "migration.inspect":
        return this.statusResponse(await this.inspect());
      case "migration.start":
        return this.statusResponse(await this.start(request, sender));
      case "migration.verify":
        return this.statusResponse(await this.verify());
      case "migration.activate":
        return this.statusResponse(await this.activate());
      case "migration.retry":
        return this.statusResponse(await this.retry(request, sender));
    }
  }

  private statusResponse(status: MigrationStatus | MigrationInspection): MigrationResponse {
    return {
      version: 1,
      kind: "migration.status",
      available: "available" in status ? status.available : true,
      phase: status.phase,
      itemCount: status.itemCount,
      ...(status.guidance === undefined ? {} : { guidance: status.guidance }),
    };
  }

  inspect(): Promise<MigrationInspection> {
    return this.mutex.run(async () => {
      const values = await this.storage.get([LEGACY_VAULT_KEY]);
      const reconciled = await this.destination.reconcile();
      if (values[LEGACY_VAULT_KEY] === undefined)
        return { available: false, phase: reconciled.phase, itemCount: 0 };
      inspectLegacyVault(values[LEGACY_VAULT_KEY]);
      return { available: true, phase: reconciled.phase, itemCount: 0 };
    });
  }

  private start(
    request: Extract<MigrationRequest, { kind: "migration.start" }>,
    sender: SenderBinding,
  ) {
    return this.mutex.run(() =>
      this.credentials.withCredential(request.credentialToken, sender, (derivedKey, source) =>
        this.startInternal(derivedKey, source),
      ),
    );
  }
  private retry(
    request: Extract<MigrationRequest, { kind: "migration.retry" }>,
    sender: SenderBinding,
  ): Promise<MigrationStatus> {
    return this.mutex.run(async () => {
      const current = await this.destination.reconcile();
      if (current.phase === "completed")
        return { phase: "completed", itemCount: current.itemCount ?? 0 };
      if (current.phase === "verified" && current.stage !== undefined) {
        await this.activateStage(current.stage);
        return { phase: "completed", itemCount: current.itemCount ?? 0 };
      }
      if (current.phase === "staged") return { phase: "staged", itemCount: current.itemCount ?? 0 };
      if (request.credentialToken === undefined) throw new MigrationServiceError("RETRY_REQUIRED");
      return this.credentials.withCredential(
        request.credentialToken,
        sender,
        (derivedKey, source) => this.startInternal(derivedKey, source),
      );
    });
  }
  verify(): Promise<MigrationStatus> {
    return this.mutex.run(async () => {
      const current = await this.destination.reconcile();
      if (current.phase === "completed")
        return { phase: "completed", itemCount: current.itemCount ?? 0 };
      if (current.stage === undefined || current.phase !== "staged")
        throw new MigrationServiceError("RETRY_REQUIRED");
      try {
        const actual = await this.destination.verify(current.stage);
        await verifyIndependent(actual, this.dependencies.expectations ?? []);
        return { phase: "verified", itemCount: actual.items.length };
      } catch {
        throw new MigrationServiceError("MIGRATION_FAILED");
      }
    });
  }
  activate(): Promise<MigrationStatus> {
    return this.mutex.run(async () => {
      const current = await this.destination.reconcile();
      if (current.phase === "completed")
        return { phase: "completed", itemCount: current.itemCount ?? 0 };
      if (current.stage === undefined || current.phase !== "verified")
        throw new MigrationServiceError("RETRY_REQUIRED");
      await this.activateStage(current.stage);
      return { phase: "completed", itemCount: current.itemCount ?? 0 };
    });
  }

  private async startInternal(
    derivedKey: Uint8Array,
    legacySource: LegacyMigrationSource,
  ): Promise<MigrationStatus> {
    const current = await this.destination.reconcile();
    if (current.phase === "staged" || current.phase === "verified")
      throw new MigrationServiceError("MIGRATION_IN_PROGRESS");
    if (current.phase === "completed")
      return { phase: "completed", itemCount: current.itemCount ?? 0 };
    const plaintext = await decryptLegacyVaultWithDerivedKey(legacySource.envelope, derivedKey);
    let source: MigrationPayload;
    try {
      const items = plaintext.accounts.map(mapLegacyAccount);
      if (new Set(items.map((item) => item.id)).size !== items.length)
        throw new LegacyMigrationError("UNSUPPORTED_LEGACY_RECORD");
      const ente = plaintext.integrations?.ente;
      source = {
        items,
        ...(legacySource.settings === undefined ? {} : { settings: legacySource.settings }),
        ...(ente === undefined ? {} : { ente: mapLegacyEnteState(ente) }),
      };
    } catch (error) {
      if (error instanceof LegacyMigrationError) throw error;
      throw new LegacyMigrationError("UNSUPPORTED_LEGACY_RECORD");
    }
    const sourceFingerprint = fingerprint(legacySource);
    await this.destination.stage({ payload: source, sourceFingerprint });
    return { phase: "staged", itemCount: source.items.length };
  }
  private async activateStage(stage: MigrationStage): Promise<void> {
    const fingerprint = await this.sourceFingerprint();
    await this.destination.assertSource(stage, fingerprint);
    try {
      await this.destination.activate(stage);
    } catch {
      throw new MigrationServiceError("MIGRATION_FAILED");
    }
  }
  private async sourceFingerprint(): Promise<string> {
    const values = await this.storage.get([LEGACY_VAULT_KEY, LEGACY_SETTINGS_KEY]);
    if (values[LEGACY_VAULT_KEY] === undefined)
      throw new MigrationServiceError("LEGACY_VAULT_NOT_FOUND");
    const envelope = LegacyEnvelopeSchema.parse(values[LEGACY_VAULT_KEY]);
    const settings =
      values[LEGACY_SETTINGS_KEY] === undefined
        ? undefined
        : parseSettingsSnapshot(values[LEGACY_SETTINGS_KEY]);
    return fingerprint({ envelope, ...(settings === undefined ? {} : { settings }) });
  }
}

export type MigrationServiceErrorCode =
  "LEGACY_VAULT_NOT_FOUND" | "MIGRATION_FAILED" | "MIGRATION_IN_PROGRESS" | "RETRY_REQUIRED";
export class MigrationServiceError extends Error {
  constructor(readonly code: MigrationServiceErrorCode) {
    super(code);
    this.name = "MigrationServiceError";
  }
}
function parseSettingsSnapshot(value: unknown) {
  return parseLegacySettings(value);
}
function fingerprint(value: unknown): string {
  return [...sha256(new TextEncoder().encode(canonicalJson(value)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
async function verifyIndependent(
  payload: MigrationPayload,
  expectations: Expectations,
): Promise<void> {
  const byId = new Map(payload.items.map((item) => [item.id, item]));
  for (const expected of expectations) {
    const item = byId.get(expected.itemId);
    if (item === undefined) throw new Error("missing expected item");
    const generated = await generateOtp(item, expected.timestamp);
    if (generated.code !== expected.code || generated.counter !== expected.counter)
      throw new Error("OTP mismatch");
  }
}
export type { MigrationPayload, MigrationStage };
