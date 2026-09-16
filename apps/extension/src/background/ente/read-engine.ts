import { canonicalJson } from "@shardpass/storage";
import type { z } from "zod/mini";

import type { EnteClient, EnteResponseBudget } from "./client";
import { ENTE_SYNC_LIMITS, EnteProtocolError } from "./protocol";
import type { authenticatorEntitySchema } from "./schemas";

type Entity = z.infer<typeof authenticatorEntitySchema>;
export type RemoteOtpState = Entity;
type Observation = Readonly<{ updatedAt: number; digest: string; entity: Entity }>;

/** Names the check that failed and the page it failed on; ids are not secrets. */
function ambiguous(page: number, reason: string): EnteProtocolError {
  return new EnteProtocolError("ENTE_TIMESTAMP_AMBIGUOUS", `diff page ${page + 1}: ${reason}`);
}

function observationDigest(entity: Entity): string {
  return canonicalJson({
    isDeleted: entity.isDeleted,
    encryptedData: entity.encryptedData,
    header: entity.header,
  });
}

export async function readRemoteState(input: {
  readonly client: Pick<EnteClient, "getEntityDiff">;
  readonly token: string;
  readonly authKey?: Uint8Array;
  readonly sinceTime: number;
  readonly forceSnapshot: boolean;
  readonly signal: AbortSignal;
  readonly budget?: EnteResponseBudget;
}): Promise<{
  mode: "incremental" | "snapshot";
  complete: boolean;
  entities: ReadonlyMap<string, RemoteOtpState>;
  nextCursor: number;
}> {
  const attempt = async (since: number, mode: "incremental" | "snapshot") => {
    const observations = new Map<string, Observation>();
    const entities = new Map<string, Entity>();
    let cursor = since;
    let total = 0;
    const maxPages =
      mode === "snapshot"
        ? ENTE_SYNC_LIMITS.maxPagesPerSnapshot
        : ENTE_SYNC_LIMITS.maxPagesPerIncremental;

    for (let page = 0; page < maxPages; page += 1) {
      if (input.signal.aborted) throw new EnteProtocolError("ENTE_UNAVAILABLE", "sync cancelled");
      const requested = cursor;
      const response =
        input.budget === undefined
          ? await input.client.getEntityDiff(input.token, requested, input.signal)
          : await input.client.getEntityDiff(input.token, requested, input.signal, input.budget);
      total += response.diff.length;
      if (total > ENTE_SYNC_LIMITS.maxRemoteChanges)
        throw new EnteProtocolError(
          "ENTE_LIMIT_REACHED",
          "more remote changes than the sync accepts",
        );

      let maximum = requested;
      let maximumCount = 0;
      for (const entity of response.diff) {
        if (entity.updatedAt <= requested && mode === "incremental")
          throw ambiguous(page, "an entity is not newer than the cursor");
        if (entity.updatedAt < requested)
          throw ambiguous(page, "an entity is older than the cursor");
        if (entity.updatedAt > maximum) {
          maximum = entity.updatedAt;
          maximumCount = 1;
        } else if (entity.updatedAt === maximum) maximumCount += 1;

        const digest = observationDigest(entity);
        const previous = observations.get(entity.id);
        if (previous !== undefined) {
          if (entity.updatedAt < previous.updatedAt)
            throw ambiguous(page, "an entity went backwards in time");
          if (entity.updatedAt === previous.updatedAt && digest !== previous.digest)
            throw ambiguous(page, "one entity, one timestamp, two contents");
          if (entity.updatedAt === previous.updatedAt) continue;
        }
        observations.set(entity.id, { updatedAt: entity.updatedAt, digest, entity });
        // A tombstone is kept in snapshot mode too: dropping it made a remote deletion look
        // like "unchanged" to the planner, so the local copy was never deleted.
        entities.set(entity.id, entity);
      }

      const serverTimestamp = response.timestamp ?? maximum;
      if (serverTimestamp < requested || serverTimestamp < maximum)
        throw ambiguous(page, "the server's timestamp is behind the entities it sent");

      let liveEntityCount = 0;
      for (const entity of entities.values()) if (!entity.isDeleted) liveEntityCount += 1;
      if (liveEntityCount > ENTE_SYNC_LIMITS.maxLiveRemoteEntities)
        throw new EnteProtocolError(
          "ENTE_LIMIT_REACHED",
          "more live remote codes than the sync accepts",
        );

      const full = response.diff.length === ENTE_SYNC_LIMITS.pageSize;
      if (full) {
        if (maximum <= requested || maximumCount > 1)
          throw ambiguous(page, "a full page cannot be continued from a unique timestamp");
        cursor = maximum;
        continue;
      }

      // Advance to the newest entity seen, as the official client does. The server's own
      // timestamp is later than its SELECT, so a row committed in between would be skipped.
      cursor = Math.max(cursor, maximum);
      return {
        mode,
        complete: mode === "snapshot",
        entities,
        nextCursor: cursor,
      };
    }
    throw new EnteProtocolError("ENTE_LIMIT_REACHED", `more than ${maxPages} diff pages`);
  };

  if (input.forceSnapshot) return attempt(0, "snapshot");
  try {
    return await attempt(input.sinceTime, "incremental");
  } catch (error) {
    if (!(error instanceof EnteProtocolError) || error.code !== "ENTE_TIMESTAMP_AMBIGUOUS")
      throw error;
    try {
      return await attempt(0, "snapshot");
    } catch (snapshotError) {
      if (
        snapshotError instanceof EnteProtocolError &&
        snapshotError.code !== "ENTE_TIMESTAMP_AMBIGUOUS"
      )
        throw snapshotError;
      throw new EnteProtocolError(
        "ENTE_TIMESTAMP_AMBIGUOUS",
        "incremental and snapshot reads both failed",
      );
    }
  }
}
