import type { SenderContext } from "@shardpass/messaging";

import { createEnteResponseBudget, type EnteClient } from "./client";
import type { EnteConflictBinding, EnteConflictCapabilities } from "./conflicts";
import { mergeEnteOtp } from "./merge";
import type {
  EnteCycleCrypto,
  EnteCycleItem,
  EnteCycleRepository,
  EnteCycleSnapshot,
} from "./operational-cycle";
import { EnteProtocolError, type EnteOtpProjection } from "./protocol";
import { readRemoteState } from "./read-engine";
import { normalizePendingOperations } from "./sync-state";

export type EnteConflictPreview = Readonly<{ capability: string; canKeepBoth: boolean }>;
export type EnteConflictResolutionResult = Readonly<{
  applied: boolean;
  conflicts: readonly EnteConflictPreview[];
}>;

type Dependencies = Readonly<{
  repository: EnteCycleRepository;
  client: Pick<EnteClient, "getAuthenticatorKey" | "getEntityDiff">;
  crypto: EnteCycleCrypto;
  capabilities: EnteConflictCapabilities;
  rootDigest(snapshot: EnteCycleSnapshot): Promise<string>;
  nextId(): string;
}>;

const senderBinding = (sender: SenderContext): string =>
  `${sender.extensionId}\n${sender.contextKind}\n${sender.senderUrl}\n${sender.documentId ?? ""}`;

async function openedConflict(
  crypto: EnteCycleCrypto,
  snapshot: EnteCycleSnapshot,
  conflictId: string,
) {
  const conflict = snapshot.state.conflicts.find((entry) => entry.conflictId === conflictId);
  if (conflict === undefined) return null;
  const open = (value: string | null) =>
    value === null ? Promise.resolve(null) : crypto.openProjection(value);
  return {
    conflict,
    base: await open(conflict.encryptedBase),
    local: await open(conflict.encryptedLocal),
    remote: await open(conflict.encryptedRemote),
  };
}

async function projectionDigest(
  crypto: EnteCycleCrypto,
  projection: EnteOtpProjection | null,
): Promise<string> {
  return projection === null ? "deleted" : crypto.digestProjection(projection);
}

export class EnteConflictResolver {
  constructor(private readonly dependencies: Dependencies) {}

  async preview(sender: SenderContext): Promise<readonly EnteConflictPreview[]> {
    const snapshot = await this.dependencies.repository.read();
    const rootDigest = await this.dependencies.rootDigest(snapshot);
    const previews: EnteConflictPreview[] = [];
    for (const row of snapshot.state.conflicts) {
      const opened = await openedConflict(this.dependencies.crypto, snapshot, row.conflictId);
      if (opened === null) continue;
      previews.push(
        await this.issue(sender, snapshot.sessionEpoch, rootDigest, {
          conflictId: row.conflictId,
          base: opened.base,
          local: opened.local,
          remote: opened.remote,
        }),
      );
    }
    return previews;
  }

  async resolve(
    capability: string,
    choice: "keep-local" | "keep-ente" | "keep-both",
    sender: SenderContext,
    signal = new AbortController().signal,
  ): Promise<EnteConflictResolutionResult> {
    const initial = await this.dependencies.repository.read();
    const initialRoot = await this.dependencies.rootDigest(initial);
    let binding: EnteConflictBinding;
    try {
      binding = this.dependencies.capabilities.take({
        capability,
        sessionEpoch: initial.sessionEpoch,
        currentRootDigest: initialRoot,
      });
    } catch {
      return { applied: false, conflicts: await this.preview(sender) };
    }
    if (binding.sender !== senderBinding(sender))
      return { applied: false, conflicts: await this.preview(sender) };

    const current = await openedConflict(this.dependencies.crypto, initial, binding.conflictId);
    if (current === null || !(await this.matches(binding, current)))
      return { applied: false, conflicts: await this.preview(sender) };

    const token = await this.dependencies.crypto.openCredential(initial.state.credentialEnvelope);
    const budget = createEnteResponseBudget();
    let authKey: Uint8Array | undefined;
    try {
      const key = await this.dependencies.client.getAuthenticatorKey(token, signal, budget);
      authKey = await this.dependencies.crypto.openAuthKey(initial.state.authKeyEnvelope, key);
      const pulled = await readRemoteState({
        client: this.dependencies.client,
        token,
        authKey,
        sinceTime: 0,
        forceSnapshot: true,
        signal,
        budget,
      });
      if (!pulled.complete) throw new EnteProtocolError("ENTE_CONFLICT");
      const remoteEntity =
        current.conflict.remoteId === null
          ? undefined
          : pulled.entities.get(current.conflict.remoteId);
      const freshRemote =
        remoteEntity === undefined || remoteEntity.isDeleted
          ? null
          : this.dependencies.crypto.decryptEntity(remoteEntity, authKey);
      if (
        (await projectionDigest(this.dependencies.crypto, freshRemote)) !== binding.remoteDigest ||
        mergeEnteOtp({ base: current.base, local: current.local, remote: freshRemote }).action !==
          "conflict"
      )
        return { applied: false, conflicts: await this.preview(sender) };

      const mutation = await this.mutation(initial, current, choice);
      if (
        (await this.dependencies.repository.commit(initial.sessionEpoch, mutation)) !== "activated"
      )
        return { applied: false, conflicts: await this.preview(sender) };
      return { applied: true, conflicts: await this.preview(sender) };
    } finally {
      authKey?.fill(0);
    }
  }

  private async issue(
    sender: SenderContext,
    sessionEpoch: number,
    rootDigest: string,
    value: Readonly<{
      conflictId: string;
      base: EnteOtpProjection | null;
      local: EnteOtpProjection | null;
      remote: EnteOtpProjection | null;
    }>,
  ): Promise<EnteConflictPreview> {
    const [baseDigest, localDigest, remoteDigest] = await Promise.all([
      projectionDigest(this.dependencies.crypto, value.base),
      projectionDigest(this.dependencies.crypto, value.local),
      projectionDigest(this.dependencies.crypto, value.remote),
    ]);
    const capability = this.dependencies.capabilities.issue({
      sessionEpoch,
      rootDigest,
      conflictId: value.conflictId,
      baseDigest,
      localDigest,
      remoteDigest,
      base: value.base,
      local: value.local,
      remote: value.remote,
      sender: senderBinding(sender),
    });
    return { capability, canKeepBoth: value.local !== null && value.remote !== null };
  }

  private async matches(
    binding: EnteConflictBinding,
    value: Readonly<{
      base: EnteOtpProjection | null;
      local: EnteOtpProjection | null;
      remote: EnteOtpProjection | null;
    }>,
  ): Promise<boolean> {
    const digests = await Promise.all([
      projectionDigest(this.dependencies.crypto, value.base),
      projectionDigest(this.dependencies.crypto, value.local),
      projectionDigest(this.dependencies.crypto, value.remote),
    ]);
    return (
      binding.baseDigest === digests[0] &&
      binding.localDigest === digests[1] &&
      binding.remoteDigest === digests[2]
    );
  }

  private async mutation(
    snapshot: EnteCycleSnapshot,
    value: NonNullable<Awaited<ReturnType<typeof openedConflict>>>,
    choice: "keep-local" | "keep-ente" | "keep-both",
  ) {
    const { conflict, base, local, remote } = value;
    const items = new Map(snapshot.items.map((entry) => [entry.localId, entry.projection]));
    const mappings = [...snapshot.state.mappings];
    const bases = [...snapshot.state.bases];
    const pending = snapshot.state.pending.filter((entry) => entry.localId !== conflict.localId);
    const remoteId =
      conflict.remoteId ?? mappings.find((entry) => entry.localId === conflict.localId)?.remoteId;
    const removeBinding = () => {
      const mapping = mappings.findIndex((entry) => entry.localId === conflict.localId);
      if (mapping >= 0) mappings.splice(mapping, 1);
      const storedBase = bases.findIndex((entry) => entry.localId === conflict.localId);
      if (storedBase >= 0) bases.splice(storedBase, 1);
    };
    const setBase = async (projection: EnteOtpProjection) => {
      if (remoteId === undefined) throw new EnteProtocolError("ENTE_CONFLICT");
      const row = {
        localId: conflict.localId,
        remoteId,
        digest: await this.dependencies.crypto.digestProjection(projection),
        encryptedBase: await this.dependencies.crypto.sealProjection(projection),
      };
      const index = bases.findIndex((entry) => entry.localId === conflict.localId);
      if (index < 0) bases.push(row);
      else bases[index] = row;
    };
    if (choice === "keep-local") {
      if (remoteId === undefined) throw new EnteProtocolError("ENTE_CONFLICT");
      if (local === null) {
        items.delete(conflict.localId);
        pending.push({
          operationId: conflict.conflictId,
          kind: "delete",
          localId: conflict.localId,
          remoteId,
          ...(base === null
            ? {}
            : { baseDigest: await this.dependencies.crypto.digestProjection(base) }),
          attempts: 0,
        });
      } else {
        items.set(conflict.localId, local);
        pending.push({
          operationId: conflict.conflictId,
          kind: "update",
          localId: conflict.localId,
          remoteId,
          baseDigest: await projectionDigest(this.dependencies.crypto, base),
          desired: await this.dependencies.crypto.sealProjection(local),
          attempts: 0,
        });
      }
    } else if (choice === "keep-ente") {
      if (remote === null) {
        items.delete(conflict.localId);
        removeBinding();
      } else {
        items.set(conflict.localId, remote);
        await setBase(remote);
      }
    } else {
      if (local === null || remote === null || remoteId === undefined)
        throw new EnteProtocolError("ENTE_CONFLICT");
      items.set(conflict.localId, local);
      removeBinding();
      const localId = this.dependencies.nextId();
      items.set(localId, remote);
      mappings.push({ localId, remoteId });
      bases.push({
        localId,
        remoteId,
        digest: await this.dependencies.crypto.digestProjection(remote),
        encryptedBase: await this.dependencies.crypto.sealProjection(remote),
      });
    }
    return {
      items: [...items].map(([localId, projection]): EnteCycleItem => ({ localId, projection })),
      state: {
        ...snapshot.state,
        mappings,
        bases,
        pending: normalizePendingOperations(pending),
        conflicts: snapshot.state.conflicts.filter(
          (entry) => entry.conflictId !== conflict.conflictId,
        ),
      },
    };
  }
}
