import { validateLegacyEnteState, type LegacyEnteState } from "@shardpass/importers/legacy-v1";

export type EnteOtpMetadataCounts = Readonly<{
  present: boolean;
  entityCount: number;
  pendingCount: number;
  createCount: number;
  updateCount: number;
  deleteCount: number;
}>;

const ABSENT: EnteOtpMetadataCounts = Object.freeze({
  present: false,
  entityCount: 0,
  pendingCount: 0,
  createCount: 0,
  updateCount: 0,
  deleteCount: 0,
});

export class EnteOtpMetadataStore {
  parse(
    candidate: LegacyEnteState | undefined,
    migratedOtpIds: ReadonlySet<string>,
  ): EnteOtpMetadataCounts {
    if (candidate === undefined) return ABSENT;
    const state = validateLegacyEnteState(candidate);
    for (const accountId of Object.values(state.entityMap))
      if (!migratedOtpIds.has(accountId)) throw new TypeError("Invalid Ente OTP metadata.");
    for (const operation of state.pending ?? [])
      if (!migratedOtpIds.has(operation.accountId))
        throw new TypeError("Invalid Ente OTP metadata.");
    const pending = state.pending ?? [];
    return {
      present: true,
      entityCount: Object.keys(state.entityMap).length,
      pendingCount: pending.length,
      createCount: pending.filter((operation) => operation.op === "create").length,
      updateCount: pending.filter((operation) => operation.op === "update").length,
      deleteCount: pending.filter((operation) => operation.op === "delete").length,
    };
  }
}
