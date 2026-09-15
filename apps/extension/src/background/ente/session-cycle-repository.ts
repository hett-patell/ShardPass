import {
  MAX_ITEM_TAG_LENGTH,
  MAX_ITEM_TAGS,
  MAX_OTP_ISSUER_LENGTH,
  MAX_OTP_LABEL_LENGTH,
  MAX_OTP_NOTE_LENGTH,
  MAX_OTP_PERIOD_SECONDS,
} from "@shardpass/domain";
import type { OtpItem } from "@shardpass/domain";
import { canonicalJson } from "@shardpass/storage";

import type { EnteSessionVaultRepository } from "../vault/session-vault-repository";
import type {
  EnteCycleItem,
  EnteCycleMutation,
  EnteCycleRepository,
  EnteCycleSnapshot,
} from "./operational-cycle";
import { EnteProtocolError, type EnteOtpProjection } from "./protocol";
import { parseEnteOtpSyncState } from "./sync-state";

const METADATA_NAME = "ente-otp-state" as const;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export type EnteSessionCycleRepository = EnteCycleRepository &
  Readonly<{ session: EnteSessionVaultRepository }>;

export function createEnteSessionCycleRepository(
  session: EnteSessionVaultRepository,
): EnteSessionCycleRepository {
  return Object.freeze({
    session,
    async read(): Promise<EnteCycleSnapshot> {
      const snapshot = await session.readOtpItemsAndMetadata(METADATA_NAME);
      if (snapshot.metadata === null) throw new EnteProtocolError("ENTE_INVALID");
      try {
        const text = decoder.decode(snapshot.metadata);
        const state = parseEnteOtpSyncState(JSON.parse(text));
        if (canonicalJson(state) !== text) throw new Error();
        return {
          sessionEpoch: snapshot.sessionEpoch,
          state,
          items: snapshot.items.map(itemToCycle),
        };
      } catch {
        throw new EnteProtocolError("ENTE_INVALID");
      } finally {
        snapshot.metadata.fill(0);
      }
    },
    async commit(
      expectedSessionEpoch: number,
      mutation: EnteCycleMutation,
    ): Promise<"activated" | "root-changed"> {
      const state = parseEnteOtpSyncState(mutation.state);
      const plaintext = encoder.encode(canonicalJson(state));
      try {
        return await session.replaceOtpItemsAndMetadataIfEpoch(
          expectedSessionEpoch,
          mutation.items.map(cycleToItem),
          { name: METADATA_NAME, schemaVersion: 1, plaintext },
        );
      } finally {
        plaintext.fill(0);
      }
    },
  });
}

function itemToCycle(item: OtpItem): EnteCycleItem {
  return Object.freeze({
    localId: item.id,
    projection: Object.freeze({
      version: 1,
      kind: "otp",
      otpType: item.otpType,
      issuer: item.issuer,
      label: item.label,
      secretBase32: item.secret,
      algorithm: item.algorithm,
      digits: item.digits as 6 | 7 | 8,
      ...(item.otpType === "hotp" ? { counter: item.counter } : { period: item.period }),
      ...(item.note ? { notes: item.note } : {}),
      ...(item.tags.length > 0 ? { tags: [...item.tags] } : {}),
    }) as EnteOtpProjection,
  });
}

/**
 * Ente is laxer than the vault's schema (untrimmed names, any period, duplicate tags). Each
 * value is brought within bounds here; a stricter check at the commit would otherwise fail
 * the whole cycle, and every later one, over a single trailing space on Ente's side.
 */
function cycleToItem(item: EnteCycleItem): OtpItem {
  const projection = item.projection;
  const issuer = projection.issuer.trim().slice(0, MAX_OTP_ISSUER_LENGTH);
  const label = projection.label.trim().slice(0, MAX_OTP_LABEL_LENGTH) || issuer || "Account";
  const period =
    projection.otpType === "hotp"
      ? 0
      : projection.otpType === "steam"
        ? 30
        : Math.min(MAX_OTP_PERIOD_SECONDS, Math.max(1, Math.trunc(projection.period ?? 30)));
  const digits =
    projection.otpType === "steam" ? 5 : Math.min(10, Math.max(6, Math.trunc(projection.digits)));
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of projection.tags ?? []) {
    const tag = raw.trim().slice(0, MAX_ITEM_TAG_LENGTH);
    const key = tag.normalize("NFKC").toLocaleLowerCase("en-US");
    if (tag === "" || seen.has(key) || tags.length >= MAX_ITEM_TAGS) continue;
    seen.add(key);
    tags.push(tag);
  }
  return {
    id: item.localId,
    kind: "otp",
    schemaVersion: 2,
    revision: 1,
    createdAt: "1970-01-01T00:00:00.000Z",
    updatedAt: "1970-01-01T00:00:00.000Z",
    issuer,
    label,
    secret: projection.secretBase32,
    otpType: projection.otpType,
    algorithm: projection.algorithm,
    digits,
    period,
    ...(projection.otpType === "hotp"
      ? { counter: Math.max(0, Math.trunc(projection.counter ?? 0)) }
      : {}),
    favorite: false,
    tags,
    note: (projection.notes ?? "").slice(0, MAX_OTP_NOTE_LENGTH),
  };
}
