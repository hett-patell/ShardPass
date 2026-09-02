import { toBinary } from "@bufbuild/protobuf";

import {
  decodeGoogleMigrationPayloads,
  type GoogleMigrationCanonicalSerializer,
} from "./google-migration-decoder";
import { MigrationPayloadSchema } from "./generated/google-authenticator-migration_pb";

export type CanonicalBytesLifecycleObserver = Readonly<{
  allocated(bytes: Uint8Array): void;
  cleared(bytes: Uint8Array): void;
}>;

export function decodeGoogleMigrationPayloadsObservingCanonicalBytes(
  payloads: readonly Uint8Array[],
  observer: CanonicalBytesLifecycleObserver,
  clearOwnedBytes?: (bytes: Uint8Array) => void,
): ReturnType<typeof decodeGoogleMigrationPayloads> {
  const serializeCanonical: GoogleMigrationCanonicalSerializer = (decoded) => {
    const canonical = toBinary(MigrationPayloadSchema, decoded, { writeUnknownFields: true });
    try {
      observer.allocated(canonical);
      return canonical;
    } catch (error) {
      try {
        canonical.fill(0);
      } catch {
        // Best-effort cleanup must not replace the allocation observer error.
      }
      try {
        observer.cleared(canonical);
      } catch {
        // Best-effort observation must not replace the allocation observer error.
      }
      throw error;
    }
  };
  return decodeGoogleMigrationPayloads(
    payloads,
    clearOwnedBytes,
    serializeCanonical,
    observer.cleared,
  );
}
