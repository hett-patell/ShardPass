import { describe, expect, it } from "vitest";

import {
  IMAGE_IMPORT_WORKER_VERSION,
  parseImageImportWorkerRequest,
  parseImageImportWorkerResponse,
  parseOtpImportQrPayload,
  validateQrPayload,
} from "../src";

const requestId = "0".repeat(32);

describe("bounded QR protocol", () => {
  it("accepts only the exact bounded transferable request", () => {
    const bytes = new ArrayBuffer(8);
    expect(parseImageImportWorkerRequest({ version: 1, requestId, bytes })).toEqual({
      version: IMAGE_IMPORT_WORKER_VERSION,
      requestId,
      bytes,
    });
    for (const value of [
      { version: 1, requestId, bytes, filename: "local.png" },
      { version: 1, requestId, bytes, type: "image/png" },
      { version: 1, requestId, bytes, sender: "vault" },
      { version: 1, requestId, bytes, previewId: "preview" },
      { version: 1, requestId, bytes, callback: () => undefined },
      { version: 1, requestId, bytes: new ArrayBuffer(8_388_609) },
      { version: 1, requestId: "wrong", bytes },
    ]) {
      expect(() => parseImageImportWorkerRequest(value)).toThrow(/^IMAGE_/u);
    }
  });

  it("accepts only exact fixed worker responses", () => {
    expect(
      parseImageImportWorkerResponse({ version: 1, requestId, kind: "decoded", payload: "x" }),
    ).toEqual({ version: 1, requestId, kind: "decoded", payload: "x" });
    for (const value of [
      { version: 1, requestId, kind: "decoded", payload: "x", raw: "x" },
      { version: 1, requestId, kind: "failed", code: "arbitrary" },
      { version: 1, requestId, kind: "failed", code: "IMAGE_INVALID", detail: "private" },
      { version: 0, requestId, kind: "failed", code: "IMAGE_INVALID" },
    ]) {
      expect(() => parseImageImportWorkerResponse(value)).toThrow(/^IMAGE_/u);
    }
  });

  it("bounds QR text by encoded UTF-8 bytes without truncation", () => {
    expect(validateQrPayload("a".repeat(1_048_576))).toHaveLength(1_048_576);
    expect(() => validateQrPayload("a".repeat(1_048_577))).toThrow(/^IMAGE_LIMIT$/u);
    expect(() => validateQrPayload("😀".repeat(262_145))).toThrow(/^IMAGE_LIMIT$/u);
    expect(() => validateQrPayload("\ud800")).toThrow(/^IMAGE_INVALID$/u);
  });

  it("routes bounded decoded text through strict format detection", () => {
    expect(() => parseOtpImportQrPayload("not an import")).toThrow(/^IMPORT_/u);
  });
});
