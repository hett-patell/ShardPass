import { z } from "zod/mini";

import { validateKdfRequestData, type KdfRequestData } from "./kdf";

export const KDF_WORKER_PROTOCOL_VERSION = 1 as const;

const requestId = z.string().check(z.regex(/^[a-f\d]{32}$/u));
const bytes = z.custom<Uint8Array<ArrayBuffer>>(
  (value) => value instanceof Uint8Array && value.buffer instanceof ArrayBuffer,
);

export const KdfWorkerRequestSchema = z.strictObject({
  version: z.literal(KDF_WORKER_PROTOCOL_VERSION),
  kind: z.literal("derive"),
  requestId,
  password: bytes,
  salt: bytes,
  parameters: z.strictObject({
    algorithm: z.literal("argon2id"),
    memoryKiB: z.int(),
    iterations: z.int(),
    parallelism: z.int(),
  }),
});

export const KdfWorkerResponseSchema = z.discriminatedUnion("kind", [
  z.strictObject({ version: z.literal(1), kind: z.literal("started"), requestId }),
  z.strictObject({
    version: z.literal(1),
    kind: z.literal("success"),
    requestId,
    result: z.instanceof(ArrayBuffer),
  }),
  z.strictObject({ version: z.literal(1), kind: z.literal("failure"), requestId }),
]);

export type KdfWorkerRequest = z.infer<typeof KdfWorkerRequestSchema>;
export type KdfWorkerResponse = z.infer<typeof KdfWorkerResponseSchema>;

export function parseWorkerRequest(candidate: unknown): KdfWorkerRequest & KdfRequestData {
  const parsed = KdfWorkerRequestSchema.parse(candidate);
  validateKdfRequestData(parsed);
  return parsed;
}
