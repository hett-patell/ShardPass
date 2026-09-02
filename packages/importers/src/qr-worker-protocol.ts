import { isUnicodeScalarText } from "@shardpass/domain";
import { z } from "zod/mini";

import { IMPORT_LIMITS } from "./import-model";

export { IMPORT_LIMITS } from "./import-model";

export const IMAGE_IMPORT_WORKER_VERSION = 1 as const;
export const IMAGE_IMPORT_TIMEOUT_MS = 10_000 as const;
export const IMAGE_IMPORT_ACCEPTED_FORMATS = Object.freeze(["png"] as const);

const requestIdSchema = z.string().check(z.regex(/^[a-f0-9]{32}$/u));
const requestSchema = z.strictObject({
  version: z.literal(IMAGE_IMPORT_WORKER_VERSION),
  requestId: requestIdSchema,
  bytes: z.instanceof(ArrayBuffer),
});
const responseSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    version: z.literal(IMAGE_IMPORT_WORKER_VERSION),
    requestId: requestIdSchema,
    kind: z.literal("decoded"),
    payload: z.string(),
  }),
  z.strictObject({
    version: z.literal(IMAGE_IMPORT_WORKER_VERSION),
    requestId: requestIdSchema,
    kind: z.literal("failed"),
    code: z.enum(["IMAGE_INVALID", "IMAGE_LIMIT", "QR_NOT_FOUND"]),
  }),
]);

export type ImageImportWorkerRequest = Readonly<{
  version: typeof IMAGE_IMPORT_WORKER_VERSION;
  requestId: string;
  bytes: ArrayBuffer;
}>;
export type ImageImportWorkerFailureCode = "IMAGE_INVALID" | "IMAGE_LIMIT" | "QR_NOT_FOUND";
export type ImageImportWorkerResponse =
  | Readonly<{
      version: typeof IMAGE_IMPORT_WORKER_VERSION;
      requestId: string;
      kind: "decoded";
      payload: string;
    }>
  | Readonly<{
      version: typeof IMAGE_IMPORT_WORKER_VERSION;
      requestId: string;
      kind: "failed";
      code: ImageImportWorkerFailureCode;
    }>;

const fixedError = (code: ImageImportWorkerFailureCode): Error => new Error(code);

export function parseImageImportWorkerRequest(value: unknown): ImageImportWorkerRequest {
  const result = requestSchema.safeParse(value);
  if (!result.success) throw fixedError("IMAGE_INVALID");
  if (result.data.bytes.byteLength === 0) throw fixedError("IMAGE_INVALID");
  if (result.data.bytes.byteLength > IMPORT_LIMITS.maxImageBytes) throw fixedError("IMAGE_LIMIT");
  return result.data;
}

export function parseImageImportWorkerResponse(value: unknown): ImageImportWorkerResponse {
  const result = responseSchema.safeParse(value);
  if (!result.success) throw fixedError("IMAGE_INVALID");
  if (result.data.kind === "decoded") validateQrPayload(result.data.payload);
  return result.data;
}

export function validateQrPayload(payload: string): string {
  if (!isUnicodeScalarText(payload) || payload.length === 0) throw fixedError("IMAGE_INVALID");
  if (payload.length > IMPORT_LIMITS.maxQrPayloadBytes) throw fixedError("IMAGE_LIMIT");
  if (new TextEncoder().encode(payload).byteLength > IMPORT_LIMITS.maxQrPayloadBytes)
    throw fixedError("IMAGE_LIMIT");
  return payload;
}
