import { sha256 } from "@noble/hashes/sha2.js";
import type { OtpItem } from "@shardpass/domain";
import type { LegacyEnteState, MigratedLockSettings } from "@shardpass/importers/legacy-v1";
import {
  MAX_GENERATION_ENTRIES,
  canonicalJson,
  type StoragePort,
  type StorageValue,
} from "@shardpass/storage";
import { z } from "zod/mini";

import type { EnteOtpMetadataCounts, EnteOtpMetadataStore } from "../ente/ente-otp-metadata-store";
import type { SettingsService } from "./settings-service";
import type {
  MigrationCapability,
  MigrationMetadataPlaintext,
  MigrationStageReference,
  MigrationTransactionEnvelope,
  SessionService,
} from "./session-service";

const TRANSACTION_KEY = "shardpass:v1:migration-transaction";
const LEASE_MS = 30_000;
// One module instance represents one background worker. This identity narrows
// accidental same-worker races; the durable lease remains evidence, not CAS.
const WORKER_INSTANCE_ID = crypto.randomUUID();
const WORKER_LEASE_ID = crypto.randomUUID();
class TransactionMutex {
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
// All MigrationService instances in this worker share this transaction-write mutex.
const TRANSACTION_MUTEX = new TransactionMutex();
const uuid = z.uuid();
const digest = z.string().check(z.regex(/^[0-9a-f]{64}$/u));
const presence = z.strictObject({ settings: z.boolean(), ente: z.boolean() });
const TransactionSchema = z.strictObject({
  revision: z.int().check(z.positive()),
  version: z.literal(2),
  phase: z.enum([
    "staging",
    "staged",
    "verifying",
    "verified",
    "activating",
    "finalizing",
    "completed",
    "failed",
  ]),
  transactionId: uuid,
  sourceFingerprint: digest,
  payloadDigest: digest,
  expectedGenerationId: uuid,
  targetStage: z.literal("v3"),
  targetGenerationId: uuid,
  itemCount: z.int().check(z.nonnegative()),
  presence,
  owner: z.strictObject({
    instanceId: uuid,
    leaseId: uuid,
    leaseVersion: z.int().check(z.positive()),
    expiresAt: z.int().check(z.nonnegative()),
  }),
  updatedAt: z.int().check(z.nonnegative()),
  safeRetry: z.enum(["restage", "verify", "activate", "finalize", "none"]),
});
type Transaction = z.infer<typeof TransactionSchema>;
const DescriptorSchema = z.strictObject({
  version: z.literal(1),
  transactionId: uuid,
  sourceFingerprint: digest,
  payloadDigest: digest,
  expectedGenerationId: uuid,
  targetGenerationId: uuid,
  itemCount: z.int().check(z.nonnegative()),
  presence,
});
type Descriptor = z.infer<typeof DescriptorSchema>;

export type DestinationPayload = Readonly<{
  items: readonly OtpItem[];
  settings?: MigratedLockSettings;
  ente?: LegacyEnteState;
}>;
export type DestinationStage = Readonly<{
  transactionId: string;
  generationId: string;
  sourceFingerprint: string;
}>;
export type DestinationState = Readonly<{
  phase: "none" | "staged" | "verified" | "completed" | "failed";
  generationId?: string;
  itemCount?: number;
  stage?: DestinationStage;
}>;

type Dependencies = Readonly<{
  now?: () => number;
  instanceId?: string;
  leaseId?: string;
  /** @deprecated Test-only compatibility alias for instanceId. */
  ownerId?: string;
  settings?: Pick<SettingsService, "applyMigrated">;
  ente?: Pick<EnteOtpMetadataStore, "parse">;
}>;

export class MigrationDestinationError extends Error {
  constructor(
    readonly code:
      | "EXTERNAL_ROOT_CHANGED"
      | "MIGRATION_IN_PROGRESS"
      | "SOURCE_CHANGED"
      | "STORAGE_CAPACITY_EXCEEDED"
      | "TRANSACTION_INVALID",
  ) {
    super(code);
    this.name = "MigrationDestinationError";
  }
}

export function migrationRecordCapacity(presence: {
  settings: boolean;
  ente: boolean;
  pending?: boolean;
}): number {
  return (
    MAX_GENERATION_ENTRIES -
    1 -
    Number(presence.settings) -
    Number(presence.ente) -
    Number(presence.pending ?? false)
  );
}

export function assertMigrationCapacity(
  itemCount: number,
  presence: { settings: boolean; ente: boolean; pending?: boolean },
): void {
  if (
    !Number.isSafeInteger(itemCount) ||
    itemCount < 0 ||
    itemCount > migrationRecordCapacity(presence)
  )
    throw new MigrationDestinationError("STORAGE_CAPACITY_EXCEEDED");
}

export class EncryptedMigrationDestination {
  private readonly now: () => number;
  private readonly instanceId: string;
  private readonly leaseId: string;
  private readonly settings: Pick<SettingsService, "applyMigrated"> | undefined;
  private readonly ente: Pick<EnteOtpMetadataStore, "parse"> | undefined;
  private enteSummary: EnteOtpMetadataCounts | undefined;

  constructor(
    private readonly storage: StoragePort,
    private readonly session: SessionService,
    dependencies: Dependencies = {},
  ) {
    this.now = dependencies.now ?? Date.now;
    this.instanceId = dependencies.instanceId ?? dependencies.ownerId ?? WORKER_INSTANCE_ID;
    this.leaseId = dependencies.leaseId ?? WORKER_LEASE_ID;
    this.settings = dependencies.settings;
    this.ente = dependencies.ente;
  }

  stage(input: {
    payload: DestinationPayload;
    sourceFingerprint: string;
  }): Promise<DestinationStage> {
    return TRANSACTION_MUTEX.run(async () => {
      const presence = payloadPresence(input.payload);
      assertMigrationCapacity(input.payload.items.length, presence);
      const existing = (await this.storage.get([TRANSACTION_KEY]))[TRANSACTION_KEY];
      if (existing !== undefined) {
        const transaction = await this.readTransaction();
        const matchesInput =
          transaction.sourceFingerprint === input.sourceFingerprint &&
          transaction.payloadDigest === payloadHash(input.payload) &&
          transaction.itemCount === input.payload.items.length &&
          canonicalJson(transaction.presence) === canonicalJson(presence);
        if (matchesInput && transaction.phase === "staging" && transaction.safeRetry === "restage")
          return this.restage(transaction, input.payload);
        if (matchesInput && transaction.phase === "staged" && transaction.safeRetry === "verify") {
          if (!this.owns(transaction) && safeNow(this.now()) <= transaction.owner.expiresAt)
            throw new MigrationDestinationError("MIGRATION_IN_PROGRESS");
          await this.readAndAuthenticate(transaction);
          return stageFrom(transaction);
        }
        throw new MigrationDestinationError("MIGRATION_IN_PROGRESS");
      }
      const capability = await this.session.beginMigration();
      const transactionId = this.session.reserveMigrationGeneration(capability);
      const generationId = this.session.reserveMigrationGeneration(capability);
      const payloadDigest = payloadHash(input.payload);
      const descriptor: Descriptor = DescriptorSchema.parse({
        version: 1,
        transactionId,
        sourceFingerprint: input.sourceFingerprint,
        payloadDigest,
        expectedGenerationId: capability.activeGenerationId,
        targetGenerationId: generationId,
        itemCount: input.payload.items.length,
        presence,
      });
      const base = this.transaction({
        phase: "staging",
        transactionId,
        sourceFingerprint: input.sourceFingerprint,
        payloadDigest,
        expectedGenerationId: capability.activeGenerationId,
        targetGenerationId: generationId,
        itemCount: input.payload.items.length,
        presence: descriptor.presence,
        safeRetry: "restage",
      });
      await this.writeTransaction(base);
      await this.session.stageMigration(capability, {
        generationId,
        items: input.payload.items,
        metadata: metadataFrom(input.payload, descriptor),
      });
      await this.writeTransaction(this.advance(base, "staged", "verify"), base);
      return { transactionId, generationId, sourceFingerprint: input.sourceFingerprint };
    });
  }

  private async restage(
    transaction: Transaction,
    payload: DestinationPayload,
  ): Promise<DestinationStage> {
    if (!this.owns(transaction) && safeNow(this.now()) <= transaction.owner.expiresAt)
      throw new MigrationDestinationError("MIGRATION_IN_PROGRESS");
    const capability = await this.session.beginMigration();
    if (capability.activeGenerationId !== transaction.expectedGenerationId)
      throw new MigrationDestinationError("EXTERNAL_ROOT_CHANGED");
    try {
      await this.readAndAuthenticate(transaction);
    } catch (error) {
      if (error instanceof MigrationDestinationError && error.code === "EXTERNAL_ROOT_CHANGED")
        throw error;
      const descriptor = DescriptorSchema.parse({
        version: 1,
        transactionId: transaction.transactionId,
        sourceFingerprint: transaction.sourceFingerprint,
        payloadDigest: transaction.payloadDigest,
        expectedGenerationId: transaction.expectedGenerationId,
        targetGenerationId: transaction.targetGenerationId,
        itemCount: transaction.itemCount,
        presence: transaction.presence,
      });
      await this.session.stageMigration(capability, {
        generationId: transaction.targetGenerationId,
        items: payload.items,
        metadata: metadataFrom(payload, descriptor),
      });
    }
    const staged = this.advance(transaction, "staged", "verify");
    await this.writeTransaction(staged, transaction);
    return stageFrom(staged);
  }

  verify(stage: DestinationStage): Promise<DestinationPayload> {
    return TRANSACTION_MUTEX.run(async () => {
      const transaction = await this.requireTransaction(stage, ["staged", "verifying", "verified"]);
      if (transaction.phase === "verified")
        return this.readAndAuthenticate(transaction).then((x) => x.payload);
      const verifying = this.advance(transaction, "verifying", "verify");
      await this.writeTransaction(verifying, transaction);
      const { payload } = await this.readAndAuthenticate(verifying);
      await this.writeTransaction(this.advance(verifying, "verified", "activate"), verifying);
      return payload;
    });
  }

  async activate(stage: DestinationStage): Promise<void> {
    let transaction = await this.requireTransaction(stage, [
      "verified",
      "activating",
      "finalizing",
      "completed",
    ]).catch(() => {
      throw new MigrationDestinationError("EXTERNAL_ROOT_CHANGED");
    });
    if (transaction.phase === "completed") return;
    if (
      transaction.phase === "finalizing" ||
      (transaction.phase === "activating" && (await this.activeMatches(transaction)))
    ) {
      const payload = await this.authenticateActive(transaction);
      await this.finalize(payload);
      await this.writeTransaction(this.advance(transaction, "completed", "none"));
      return;
    }
    const { capability, reference } = await this.readAndAuthenticate(transaction);
    transaction = this.advance(transaction, "activating", "activate");
    await this.writeTransaction(transaction);
    const outcome = await this.session.commitMigration(reference).catch(async () => {
      if (await this.activeMatches(transaction)) return { committed: true as const };
      throw new MigrationDestinationError("EXTERNAL_ROOT_CHANGED");
    });
    if (!outcome.committed) throw new MigrationDestinationError("EXTERNAL_ROOT_CHANGED");
    void capability;
    transaction = this.advance(transaction, "finalizing", "finalize");
    await this.writeTransaction(transaction);
    const activePayload = await this.authenticateActive(transaction);
    await this.finalize(activePayload);
    await this.writeTransaction(this.advance(transaction, "completed", "none"));
  }

  assertSource(stage: DestinationStage, sourceFingerprint: string): Promise<void> {
    return stage.sourceFingerprint === sourceFingerprint
      ? Promise.resolve()
      : Promise.reject(new MigrationDestinationError("SOURCE_CHANGED"));
  }

  async reconcile(): Promise<DestinationState> {
    const transaction = await this.readTransaction().catch(() => null);
    if (transaction === null) return { phase: "none" };
    if (await this.activeMatches(transaction)) {
      if (transaction.phase !== "completed") {
        const payload = await this.authenticateActive(transaction);
        await this.finalize(payload);
        await this.writeTransaction(this.advance(transaction, "completed", "none"));
      }
      return {
        phase: "completed",
        generationId: transaction.targetGenerationId,
        itemCount: transaction.itemCount,
        stage: stageFrom(transaction),
      };
    }
    if (transaction.phase === "staging" && transaction.safeRetry === "restage") {
      if (!this.owns(transaction) && safeNow(this.now()) <= transaction.owner.expiresAt)
        return {
          phase: "staged",
          generationId: transaction.targetGenerationId,
          itemCount: transaction.itemCount,
          stage: stageFrom(transaction),
        };
      try {
        await this.readAndAuthenticate(transaction);
        const staged = this.advance(transaction, "staged", "verify");
        await this.writeTransaction(staged, transaction);
        return {
          phase: "staged",
          generationId: staged.targetGenerationId,
          itemCount: staged.itemCount,
          stage: stageFrom(staged),
        };
      } catch {
        return {
          phase: "failed",
          generationId: transaction.targetGenerationId,
          itemCount: transaction.itemCount,
        };
      }
    }
    const phase = publicPhase(transaction.phase);
    return {
      phase,
      generationId: transaction.targetGenerationId,
      itemCount: transaction.itemCount,
      stage: stageFrom(transaction),
    };
  }

  private async readAndAuthenticate(transaction: Transaction): Promise<{
    payload: DestinationPayload;
    capability: MigrationCapability;
    reference: MigrationStageReference;
  }> {
    const capability = await this.session.beginMigration();
    if (capability.activeGenerationId !== transaction.expectedGenerationId)
      throw new MigrationDestinationError("EXTERNAL_ROOT_CHANGED");
    const reference = await this.session.resumeMigration(
      capability,
      transaction.targetGenerationId,
    );
    const read = await this.session.readMigration(reference);
    const { descriptor, payload } = payloadFrom(read.items, read.metadata);
    assertDescriptor(transaction, descriptor, payload);
    return { payload, capability, reference };
  }

  private async authenticateActive(transaction: Transaction): Promise<DestinationPayload> {
    const active = await this.session.readActiveMigration();
    const { descriptor, payload } = payloadFrom(active.items, active.metadata);
    assertDescriptor(transaction, descriptor, payload);
    if (active.generationId !== transaction.targetGenerationId)
      throw new MigrationDestinationError("EXTERNAL_ROOT_CHANGED");
    return payload;
  }

  private async finalize(payload: DestinationPayload): Promise<void> {
    if (payload.settings !== undefined && this.settings !== undefined)
      await this.settings.applyMigrated(payload.settings);
    if (this.ente !== undefined)
      this.enteSummary = this.ente.parse(
        payload.ente,
        new Set(payload.items.map((item) => item.id)),
      );
  }

  getEnteSummary(): EnteOtpMetadataCounts | undefined {
    return this.enteSummary;
  }

  private async activeMatches(transaction: Transaction): Promise<boolean> {
    try {
      await this.authenticateActive(transaction);
      return true;
    } catch {
      return false;
    }
  }

  private async requireTransaction(
    stage: DestinationStage,
    phases: readonly Transaction["phase"][],
  ): Promise<Transaction> {
    let transaction = await this.readTransaction();
    if (
      transaction.transactionId !== stage.transactionId ||
      transaction.targetGenerationId !== stage.generationId ||
      transaction.sourceFingerprint !== stage.sourceFingerprint ||
      !phases.includes(transaction.phase)
    )
      throw new MigrationDestinationError("TRANSACTION_INVALID");
    if (transaction.phase === "completed" || this.owns(transaction)) return transaction;
    if (safeNow(this.now()) <= transaction.owner.expiresAt)
      throw new MigrationDestinationError("MIGRATION_IN_PROGRESS");

    // Storage read/write is not compare-and-swap. Before recording takeover
    // evidence, authenticate the current root and exact staged/active target.
    if (await this.activeMatches(transaction)) await this.authenticateActive(transaction);
    else await this.readAndAuthenticate(transaction);
    transaction = this.advance(transaction, transaction.phase, transaction.safeRetry);
    await this.writeTransaction(transaction);
    return transaction;
  }

  private owns(transaction: Transaction): boolean {
    return (
      transaction.owner.instanceId === this.instanceId && transaction.owner.leaseId === this.leaseId
    );
  }

  private transaction(
    value: Omit<Transaction, "revision" | "version" | "targetStage" | "owner" | "updatedAt">,
  ): Transaction {
    const now = safeNow(this.now());
    return TransactionSchema.parse({
      ...value,
      revision: 1,
      version: 2,
      targetStage: "v3",
      owner: {
        instanceId: this.instanceId,
        leaseId: this.leaseId,
        leaseVersion: 1,
        expiresAt: safeAdd(now, LEASE_MS),
      },
      updatedAt: now,
    });
  }

  private advance(
    value: Transaction,
    phase: Transaction["phase"],
    safeRetry: Transaction["safeRetry"],
  ): Transaction {
    const now = safeNow(this.now());
    return TransactionSchema.parse({
      ...value,
      revision: value.revision + 1,
      phase,
      safeRetry,
      owner: {
        instanceId: this.instanceId,
        leaseId: this.leaseId,
        leaseVersion: value.owner.leaseVersion + 1,
        expiresAt: safeAdd(now, LEASE_MS),
      },
      updatedAt: now,
    });
  }

  private async readTransaction(): Promise<Transaction> {
    const candidate = (await this.storage.get([TRANSACTION_KEY]))[TRANSACTION_KEY];
    if (candidate === undefined) throw new MigrationDestinationError("TRANSACTION_INVALID");
    try {
      const opened = await this.session.openMigrationTransaction(candidate);
      const parsed = TransactionSchema.parse(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(opened.plaintext)),
      );
      if (opened.transactionId !== parsed.transactionId)
        throw new Error("transaction binding mismatch");
      return parsed;
    } catch {
      throw new MigrationDestinationError("TRANSACTION_INVALID");
    }
  }

  private async writeTransaction(transaction: Transaction, expected?: Transaction): Promise<void> {
    if (expected !== undefined) {
      const current = await this.readTransaction();
      if (
        current.transactionId !== expected.transactionId ||
        current.revision !== expected.revision ||
        current.owner.leaseVersion !== expected.owner.leaseVersion ||
        current.owner.instanceId !== expected.owner.instanceId ||
        current.owner.leaseId !== expected.owner.leaseId
      )
        throw new MigrationDestinationError("TRANSACTION_INVALID");
    }
    const plaintext = new TextEncoder().encode(canonicalJson(TransactionSchema.parse(transaction)));
    const envelope = await this.session.sealMigrationTransaction(
      transaction.transactionId,
      plaintext,
    );
    await this.storage.set({ [TRANSACTION_KEY]: asStorage(envelope) });
  }
}

function metadataFrom(
  payload: DestinationPayload,
  descriptor: Descriptor,
): MigrationMetadataPlaintext[] {
  const encoder = new TextEncoder();
  return [
    {
      name: "migration-descriptor",
      schemaVersion: 1,
      plaintext: encoder.encode(canonicalJson(descriptor)),
    },
    ...(payload.settings === undefined
      ? []
      : [
          {
            name: "lock-settings" as const,
            schemaVersion: 1 as const,
            plaintext: encoder.encode(canonicalJson(payload.settings)),
          },
        ]),
    ...(payload.ente === undefined
      ? []
      : [
          {
            name: "ente-otp-state" as const,
            schemaVersion: 1 as const,
            plaintext: encoder.encode(canonicalJson(payload.ente)),
          },
        ]),
  ];
}
function payloadFrom(items: readonly OtpItem[], metadata: readonly MigrationMetadataPlaintext[]) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const exact = new Map(metadata.map((entry) => [entry.name, entry]));
  if (exact.size !== metadata.length || !exact.has("migration-descriptor"))
    throw new MigrationDestinationError("TRANSACTION_INVALID");
  const value = (name: MigrationMetadataPlaintext["name"]) => {
    const found = exact.get(name);
    return found === undefined
      ? undefined
      : (JSON.parse(decoder.decode(found.plaintext)) as unknown);
  };
  const descriptor = DescriptorSchema.parse(value("migration-descriptor"));
  const settings = value("lock-settings") as MigratedLockSettings | undefined;
  const ente = value("ente-otp-state") as LegacyEnteState | undefined;
  const payload: DestinationPayload = {
    items,
    ...(settings === undefined ? {} : { settings }),
    ...(ente === undefined ? {} : { ente }),
  };
  return { descriptor, payload };
}
function assertDescriptor(
  transaction: Transaction,
  descriptor: Descriptor,
  payload: DestinationPayload,
): void {
  if (
    descriptor.transactionId !== transaction.transactionId ||
    descriptor.sourceFingerprint !== transaction.sourceFingerprint ||
    descriptor.payloadDigest !== transaction.payloadDigest ||
    descriptor.expectedGenerationId !== transaction.expectedGenerationId ||
    descriptor.targetGenerationId !== transaction.targetGenerationId ||
    descriptor.itemCount !== transaction.itemCount ||
    canonicalJson(descriptor.presence) !== canonicalJson(transaction.presence) ||
    payload.items.length !== transaction.itemCount ||
    canonicalJson(payloadPresence(payload)) !== canonicalJson(transaction.presence) ||
    payloadHash(payload) !== transaction.payloadDigest
  )
    throw new MigrationDestinationError("TRANSACTION_INVALID");
}
function payloadPresence(payload: DestinationPayload) {
  return { settings: payload.settings !== undefined, ente: payload.ente !== undefined };
}
function payloadHash(payload: DestinationPayload): string {
  const canonicalPayload = {
    ...payload,
    items: [...payload.items].sort((left, right) => left.id.localeCompare(right.id)),
  };
  return [...sha256(new TextEncoder().encode(canonicalJson(canonicalPayload)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
function stageFrom(transaction: Transaction): DestinationStage {
  return {
    transactionId: transaction.transactionId,
    generationId: transaction.targetGenerationId,
    sourceFingerprint: transaction.sourceFingerprint,
  };
}
function publicPhase(phase: Transaction["phase"]): DestinationState["phase"] {
  if (phase === "completed" || phase === "finalizing")
    return phase === "completed" ? "completed" : "verified";
  if (phase === "verified" || phase === "activating") return "verified";
  if (phase === "failed") return "failed";
  return "staged";
}
function safeNow(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}
function safeAdd(left: number, right: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, left + right);
}
function asStorage(value: MigrationTransactionEnvelope): StorageValue {
  return JSON.parse(canonicalJson(value)) as StorageValue;
}
