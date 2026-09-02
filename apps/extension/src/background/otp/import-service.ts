import type { OtpItem } from "@shardpass/domain";
import {
  IMPORT_LIMITS,
  classifyImportCandidates,
  type ImportPreviewRow,
  type ImportSourceFormat,
  type OtpImportCandidate,
} from "@shardpass/importers/import-model";
import {
  OtpImportRequestSchema,
  OtpImportResponseSchema,
  type OtpImportRequest,
  type OtpImportResponse,
  type SenderContext,
} from "@shardpass/messaging";

import type { SessionVaultRepository } from "../vault/session-vault-repository";

export type OtpImportServiceErrorCode =
  | "OTP_IMPORT_INVALID"
  | "OTP_IMPORT_LIMIT"
  | "OTP_IMPORT_EXPIRED"
  | "OTP_IMPORT_CAPACITY"
  | "OTP_IMPORT_UNAVAILABLE"
  | "VAULT_LOCKED";

export class OtpImportServiceError extends Error {
  constructor(readonly code: OtpImportServiceErrorCode) {
    super(code);
    this.name = "OtpImportServiceError";
  }
}

type Dependencies = Readonly<{
  repository: Pick<SessionVaultRepository, "listItems" | "importOtpBatch">;
  now(): number;
  nextId(): string;
  notePrivilegedActivity(): Promise<void>;
  observeSnapshotCandidates?(candidates: OtpImportCandidate[]): void;
}>;
type OperationState = "creating" | "pending" | "confirming";
type Operation = {
  token: string;
  format: ImportSourceFormat;
  candidates: OtpImportCandidate[];
  statuses: ("accepted" | "duplicate")[];
  senderKey: string;
  expiresAt: number;
  sequence: number;
  generation: number;
  state: OperationState;
};

const MAX_TOKEN_ATTEMPTS = 16;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class OtpImportService {
  private readonly operations = new Map<string, Operation>();
  private nextSequence = 0;
  private sessionGeneration = 0;
  private disposed = false;

  constructor(private readonly dependencies: Dependencies) {}

  clearForSession(): void {
    this.sessionGeneration += 1;
    for (const operation of this.operations.values()) operation.candidates.splice(0);
    this.operations.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearForSession();
  }

  async handle(request: OtpImportRequest, sender: SenderContext): Promise<OtpImportResponse> {
    if (this.disposed) throw new OtpImportServiceError("OTP_IMPORT_UNAVAILABLE");
    const parsed = OtpImportRequestSchema.safeParse(request);
    if (!parsed.success || sender.contextKind !== "vault" || sender.documentId === undefined)
      throw new OtpImportServiceError("OTP_IMPORT_INVALID");
    this.expire();
    switch (parsed.data.kind) {
      case "otp.importPreview":
        return this.preview(
          parsed.data.format,
          parsed.data.candidates.map((candidate) =>
            copyCandidate({
              sourceOrdinal: candidate.sourceOrdinal,
              issuer: candidate.issuer,
              label: candidate.label,
              secret: candidate.secret,
              otpType: candidate.otpType,
              algorithm: candidate.algorithm,
              digits: candidate.digits,
              period: candidate.period,
              ...(candidate.counter === undefined ? {} : { counter: candidate.counter }),
              favorite: candidate.favorite,
              tags: candidate.tags,
              note: candidate.note,
            }),
          ),
          sender,
        );
      case "otp.importConfirm":
        return this.confirm(parsed.data.previewToken, sender);
      case "otp.importCancel":
        this.cancel(parsed.data.previewToken, sender);
        return this.response({ version: 1, kind: "otp.importCancelled", cancelled: true });
    }
  }

  private async preview(
    format: ImportSourceFormat,
    candidates: OtpImportCandidate[],
    sender: SenderContext,
  ): Promise<OtpImportResponse> {
    const operation = this.reserveOperation(format, candidates, senderKey(sender));
    try {
      const existing = await this.dependencies.repository.listItems();
      this.assertCurrent(operation);
      const rows = classifyImportCandidates(
        operation.candidates,
        existing.map(toCandidate),
        operation.candidates.map(() => this.allocateOpaqueId()),
      );
      this.assertCurrent(operation);
      operation.statuses = rows.map((row) =>
        row.status === "duplicate" ? "duplicate" : "accepted",
      );
      operation.expiresAt = this.dependencies.now() + IMPORT_LIMITS.previewTtlMs;
      operation.state = "pending";
      return this.previewResponse("otp.importPreviewResult", operation, rows);
    } catch (error) {
      this.removeAndClear(operation);
      throw mapError(error);
    }
  }

  private async confirm(token: string, sender: SenderContext): Promise<OtpImportResponse> {
    const operation = this.claim(token, sender);
    const repositoryCandidates = operation.candidates.map(copyCandidate);
    const retainedCandidates = [...repositoryCandidates];
    const statuses = [...operation.statuses];
    operation.candidates.splice(0);
    try {
      let repositoryPromise: Promise<
        Awaited<ReturnType<Dependencies["repository"]["importOtpBatch"]>>
      >;
      try {
        repositoryPromise = this.dependencies.repository.importOtpBatch(
          repositoryCandidates,
          statuses,
        );
      } finally {
        repositoryCandidates.splice(0);
      }
      const result = await repositoryPromise;
      this.assertCurrent(operation);
      if (result.previewChanged) {
        const existing = await this.dependencies.repository.listItems();
        this.assertCurrent(operation);
        const rows = classifyImportCandidates(
          retainedCandidates,
          existing.map(toCandidate),
          retainedCandidates.map(() => this.allocateOpaqueId()),
        );
        this.assertCurrent(operation);
        const replacementCandidates = retainedCandidates.map(copyCandidate);
        this.operations.delete(operation.token);
        const replacement = this.reserveOperation(
          operation.format,
          replacementCandidates,
          operation.senderKey,
        );
        replacement.statuses = rows.map((row) =>
          row.status === "duplicate" ? "duplicate" : "accepted",
        );
        replacement.expiresAt = this.dependencies.now() + IMPORT_LIMITS.previewTtlMs;
        replacement.state = "pending";
        return this.previewResponse("otp.importPreviewChanged", replacement, rows);
      }
      try {
        await this.dependencies.notePrivilegedActivity();
      } catch {
        // Activity is non-authoritative after authenticated persistence.
      }
      this.assertCurrent(operation);
      return this.response({
        version: 1,
        kind: "otp.importConfirmed",
        imported: result.imported,
        duplicate: result.duplicate,
      });
    } catch (error) {
      throw mapError(error);
    } finally {
      repositoryCandidates.splice(0);
      retainedCandidates.splice(0);
      statuses.splice(0);
      if (this.operations.get(operation.token) === operation)
        this.operations.delete(operation.token);
    }
  }

  private reserveOperation(
    format: ImportSourceFormat,
    candidates: OtpImportCandidate[],
    binding: string,
  ): Operation {
    this.dependencies.observeSnapshotCandidates?.(candidates);
    this.evictOwnPending(binding);
    if (this.operations.size >= IMPORT_LIMITS.maxLivePreviews) {
      candidates.splice(0);
      throw new OtpImportServiceError("OTP_IMPORT_CAPACITY");
    }
    let token: string;
    try {
      token = this.allocateToken();
    } catch (error) {
      candidates.splice(0);
      throw error;
    }
    const operation: Operation = {
      token,
      format,
      candidates,
      statuses: [],
      senderKey: binding,
      expiresAt: 0,
      sequence: this.nextSequence++,
      generation: this.sessionGeneration,
      state: "creating",
    };
    this.operations.set(token, operation);
    return operation;
  }

  private allocateToken(): string {
    for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS; attempt++) {
      const token = this.allocateOpaqueId();
      if (!this.operations.has(token)) return token;
    }
    throw new OtpImportServiceError("OTP_IMPORT_UNAVAILABLE");
  }

  private allocateOpaqueId(): string {
    for (let attempt = 0; attempt < MAX_TOKEN_ATTEMPTS; attempt++) {
      const id = this.dependencies.nextId();
      if (UUID.test(id)) return id;
    }
    throw new OtpImportServiceError("OTP_IMPORT_UNAVAILABLE");
  }

  private claim(token: string, sender: SenderContext): Operation {
    const operation = this.operations.get(token);
    if (
      operation === undefined ||
      operation.state !== "pending" ||
      operation.senderKey !== senderKey(sender) ||
      operation.expiresAt < this.dependencies.now()
    ) {
      if (operation?.expiresAt !== undefined && operation.expiresAt < this.dependencies.now())
        this.removeAndClear(operation);
      throw new OtpImportServiceError("OTP_IMPORT_EXPIRED");
    }
    operation.state = "confirming";
    return operation;
  }

  private cancel(token: string, sender: SenderContext): void {
    const operation = this.operations.get(token);
    if (
      operation !== undefined &&
      operation.state !== "confirming" &&
      operation.senderKey === senderKey(sender)
    )
      this.removeAndClear(operation);
  }

  private evictOwnPending(binding: string): void {
    const own = [...this.operations.values()]
      .filter((operation) => operation.senderKey === binding && operation.state !== "confirming")
      .sort((left, right) => left.sequence - right.sequence);
    while (own.length >= IMPORT_LIMITS.maxPreviewsPerDocument) this.removeAndClear(own.shift()!);
  }

  private assertCurrent(operation: Operation): void {
    if (
      this.disposed ||
      operation.generation !== this.sessionGeneration ||
      this.operations.get(operation.token) !== operation
    )
      throw new OtpImportServiceError("VAULT_LOCKED");
  }

  private removeAndClear(operation: Operation): void {
    this.operations.delete(operation.token);
    operation.candidates.splice(0);
  }

  private expire(): void {
    const now = this.dependencies.now();
    for (const operation of this.operations.values())
      if (operation.state === "pending" && operation.expiresAt < now)
        this.removeAndClear(operation);
  }

  private previewResponse(
    kind: "otp.importPreviewResult" | "otp.importPreviewChanged",
    operation: Operation,
    rows: readonly ImportPreviewRow[],
  ): OtpImportResponse {
    const counts = countRows(rows);
    return this.response({
      version: 1,
      kind,
      previewToken: operation.token,
      format: operation.format,
      rows: rows.map((row) => ({
        ...row,
        metadata: row.metadata === null ? null : { ...row.metadata },
      })),
      ...counts,
      expiresAt: operation.expiresAt,
    });
  }

  private response(candidate: OtpImportResponse): OtpImportResponse {
    const parsed = OtpImportResponseSchema.safeParse(candidate);
    if (!parsed.success) throw new OtpImportServiceError("OTP_IMPORT_UNAVAILABLE");
    return parsed.data;
  }
}

function senderKey(sender: SenderContext): string {
  return `${sender.extensionId}\n${sender.senderUrl}\n${sender.documentId ?? ""}`;
}
function copyCandidate(candidate: OtpImportCandidate): OtpImportCandidate {
  return Object.freeze({ ...candidate, tags: Object.freeze([...candidate.tags]) });
}
function toCandidate(item: OtpItem): OtpImportCandidate {
  return copyCandidate({
    sourceOrdinal: 1,
    issuer: item.issuer,
    label: item.label,
    secret: item.secret,
    otpType: item.otpType,
    algorithm: item.algorithm,
    digits: item.digits,
    period: item.period,
    ...(item.counter === undefined ? {} : { counter: item.counter }),
    favorite: item.favorite,
    tags: item.tags,
    note: item.note,
  });
}
function countRows(rows: readonly ImportPreviewRow[]) {
  return {
    accepted: rows.filter((row) => row.status === "accepted").length,
    duplicate: rows.filter((row) => row.status === "duplicate").length,
    rejected: rows.filter((row) => row.status === "rejected").length,
  };
}
function mapError(error: unknown): OtpImportServiceError {
  if (error instanceof OtpImportServiceError) return error;
  const code =
    typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
  if (code === "VAULT_LOCKED") return new OtpImportServiceError("VAULT_LOCKED");
  if (code === "STORAGE_CAPACITY_EXCEEDED") return new OtpImportServiceError("OTP_IMPORT_CAPACITY");
  return new OtpImportServiceError("OTP_IMPORT_UNAVAILABLE");
}
