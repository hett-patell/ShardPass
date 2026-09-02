import type { OtpItem } from "@shardpass/domain";
import {
  HotpCommitError,
  type HotpCommitRequest,
  type HotpCommitResult,
  type HotpCounterCommitter,
} from "@shardpass/otp";
import { StorageError, type VaultCryptoContext, type VaultRepository } from "@shardpass/storage";

type SessionHotpRepository = Readonly<{
  commitHotpReservation(request: HotpCommitRequest): Promise<HotpCommitResult>;
  lookupHotpReservationReceipt(request: HotpCommitRequest): Promise<HotpCommitResult | null>;
  get(itemId: string): Promise<OtpItem | null>;
}>;

export function createRepositoryHotpCommitter(
  repository: VaultRepository,
  contextProvider: () => VaultCryptoContext,
): HotpCounterCommitter;
export function createRepositoryHotpCommitter(
  repository: SessionHotpRepository,
): HotpCounterCommitter;
export function createRepositoryHotpCommitter(
  repository: VaultRepository | SessionHotpRepository,
  contextProvider?: () => VaultCryptoContext,
): HotpCounterCommitter {
  return {
    async commit(request) {
      const context = contextProvider?.();
      const commit = () =>
        context === undefined
          ? (repository as SessionHotpRepository).commitHotpReservation(request)
          : (repository as VaultRepository).commitHotpReservation(request, context);
      const lookup = () =>
        context === undefined
          ? (repository as SessionHotpRepository).lookupHotpReservationReceipt(request)
          : (repository as VaultRepository).lookupHotpReservationReceipt(request, context);
      const get = () =>
        context === undefined
          ? (repository as SessionHotpRepository).get(request.itemId)
          : (repository as VaultRepository).get(request.itemId, context);
      try {
        return await commit();
      } catch (error) {
        if (error instanceof StorageError && error.code === "REVISION_CONFLICT")
          throw new HotpCommitError("not-committed");
        try {
          const receipt = await lookup();
          if (receipt !== null) return receipt;
          const current = await get();
          if (
            current !== null &&
            current.kind === "otp" &&
            current.otpType === "hotp" &&
            current.revision === request.expectedRevision &&
            current.counter === request.expectedCounter
          )
            throw new HotpCommitError("not-committed");
          throw new HotpCommitError("unknown-outcome");
        } catch (reconciliationError) {
          if (reconciliationError instanceof HotpCommitError) throw reconciliationError;
          throw new HotpCommitError("unknown-outcome");
        }
      }
    },
  };
}
