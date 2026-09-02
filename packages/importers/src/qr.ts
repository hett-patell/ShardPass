import { parseOtpImportText } from "./detect";
import { type ParsedOtpImport } from "./import-model";
import { validateQrPayload } from "./qr-worker-protocol";

export * from "./qr-worker-protocol";

export function parseOtpImportQrPayload(payload: string): ParsedOtpImport {
  validateQrPayload(payload);
  const parsed = parseOtpImportText(payload);
  return Object.freeze({ ...parsed, format: "qr" });
}
