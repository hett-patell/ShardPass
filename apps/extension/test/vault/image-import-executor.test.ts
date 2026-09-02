import { describe, expect, it, vi } from "vitest";

import {
  createImageImportExecutor,
  type ImageImportWorkerLike,
} from "../../src/vault/otp/import/image-import-executor";
import { handleImageImportWorkerMessage } from "../../src/vault/otp/import/otp-import-worker-handler";

class FakeWorker implements ImageImportWorkerLike {
  readonly posted: Array<{ message: unknown; transfer: Transferable[]; snapshot: Uint8Array }> = [];
  terminateCalls = 0;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  postMessage(message: unknown, transfer: Transferable[] = []): void {
    const bytes = (message as { bytes: ArrayBuffer }).bytes;
    this.posted.push({ message, transfer, snapshot: new Uint8Array(bytes).slice() });
  }
  terminate(): void {
    this.terminateCalls += 1;
  }
  respond(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent<unknown>);
  }
}

const imageBlob = (size = 8) => new Blob([new Uint8Array(size).fill(7)]);
const encoded = (value: string): Uint8Array => Uint8Array.from(Buffer.from(value, "base64"));
const STATIC_PNG = encoded(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQAAAADsdIMmAAAADUlEQVR42mP4z8SADAEPcQEOdvOI0AAAAABJRU5ErkJggg==",
);
const OVERSIZED_PNG = encoded(
  "iVBORw0KGgoAAAANSUhEUgAAEAEAAAABAQAAAACZmD3vAAAAEElEQVR42mP8zzAKRjJoBAADogGC9/kiMQAAAABJRU5ErkJggg==",
);
const APNG = encoded(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAAIAAAACAAAAAAAAAAAAGQD6AAAG0/pfwAAABZJREFUeJxj/P///38GPIAJn+TwUQAAG24EDIndbQsAAAAaZmNUTAAAAAEAAAAIAAAACAAAAAAAAAAAAGQD6AAAgDwDqwAAABlmZEFUAAAAAnicY2RgYPjPgAcw4ZMcPgoADFMBD+HEhzQAAAAASUVORK5CYII=",
);
const DUPLICATE_IHDR_PNG = encoded(
  "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQAAAADsdIMmAAAADUlIRFIAAAAJAAAACAEAAAAAA7boGAAAAA1JREFUeNpj+M/EgAwBD3EBDnbziNAAAAAASUVORK5CYII=",
);
const BAD_CRC_PNG = STATIC_PNG.map((value, index) => (index === 24 ? value ^ 1 : value));
const JPEG = encoded(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==",
);
const WEBP = encoded("UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoIAAgAAUAmJaQAA3AA/vz0AAA=");

describe("image import executor", () => {
  it("rejects encoded images over 8 MiB before reading or creating a Worker", async () => {
    const blob = imageBlob(8_388_609);
    const read = vi.spyOn(blob, "arrayBuffer");
    const factory = vi.fn(() => new FakeWorker());
    await expect(
      createImageImportExecutor(factory).decode(blob, new AbortController().signal),
    ).rejects.toThrow(/^IMAGE_LIMIT$/u);
    expect(read).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
  });

  it("installs abort and timeout before a deferred read and never creates a late Worker", async () => {
    vi.useFakeTimers();
    try {
      let resolveRead!: (buffer: ArrayBuffer) => void;
      const blob = imageBlob();
      const readBlob = vi.fn(
        () =>
          new Promise<ArrayBuffer>((resolve) => {
            resolveRead = resolve;
          }),
      );
      const factory = vi.fn(() => new FakeWorker());
      const controller = new AbortController();
      const aborted = createImageImportExecutor(factory, { readBlob }).decode(
        blob,
        controller.signal,
      );
      controller.abort();
      await expect(aborted).rejects.toThrow(/^IMAGE_INVALID$/u);
      const lateAbortBuffer = new Uint8Array(8).fill(9);
      resolveRead(lateAbortBuffer.buffer);
      await vi.waitFor(() => expect(lateAbortBuffer).toEqual(new Uint8Array(8)));
      expect(factory).not.toHaveBeenCalled();

      let resolveTimeoutRead!: (buffer: ArrayBuffer) => void;
      const timedBlob = imageBlob();
      const readTimedBlob = vi.fn(
        () =>
          new Promise<ArrayBuffer>((resolve) => {
            resolveTimeoutRead = resolve;
          }),
      );
      const timed = createImageImportExecutor(factory, {
        timeoutMs: 25,
        readBlob: readTimedBlob,
      }).decode(timedBlob, new AbortController().signal);
      const rejection = expect(timed).rejects.toThrow(/^IMAGE_INVALID$/u);
      await vi.advanceTimersByTimeAsync(25);
      await rejection;
      const lateTimeoutBuffer = new Uint8Array(8).fill(6);
      resolveTimeoutRead(lateTimeoutBuffer.buffer);
      await vi.waitFor(() => expect(lateTimeoutBuffer).toEqual(new Uint8Array(8)));
      expect(factory).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("posts one minimal transferable copy, clears it synchronously, and accepts once", async () => {
    const worker = new FakeWorker();
    const pending = createImageImportExecutor(() => worker).decode(
      imageBlob(),
      new AbortController().signal,
    );
    await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
    const posted = worker.posted[0]!;
    const request = posted.message as { version: 1; requestId: string; bytes: ArrayBuffer };
    expect(Object.keys(request).sort()).toEqual(["bytes", "requestId", "version"]);
    expect(posted.transfer).toEqual([request.bytes]);
    expect(posted.snapshot).toEqual(new Uint8Array(8).fill(7));
    expect(new Uint8Array(request.bytes)).toEqual(new Uint8Array(8));

    worker.respond({
      version: 1,
      requestId: request.requestId,
      kind: "decoded",
      payload: "bounded",
    });
    await expect(pending).resolves.toBe("bounded");
    expect(worker.terminateCalls).toBe(1);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    worker.respond({ version: 1, requestId: request.requestId, kind: "decoded", payload: "late" });
    expect(worker.terminateCalls).toBe(1);
  });

  it("terminates on timeout and abort and ignores late responses", async () => {
    vi.useFakeTimers();
    try {
      const timedWorker = new FakeWorker();
      const timed = createImageImportExecutor(() => timedWorker, { timeoutMs: 25 }).decode(
        imageBlob(),
        new AbortController().signal,
      );
      const timedRejection = expect(timed).rejects.toThrow(/^IMAGE_INVALID$/u);
      await vi.advanceTimersByTimeAsync(25);
      await timedRejection;
      expect(timedWorker.terminateCalls).toBe(1);

      const abortedWorker = new FakeWorker();
      const controller = new AbortController();
      const aborted = createImageImportExecutor(() => abortedWorker).decode(
        imageBlob(),
        controller.signal,
      );
      await Promise.resolve();
      await Promise.resolve();
      controller.abort();
      await expect(aborted).rejects.toThrow(/^IMAGE_INVALID$/u);
      expect(abortedWorker.terminateCalls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed on hostile factories, methods, getters, IDs, and result fields", async () => {
    const controller = new AbortController();
    await expect(
      createImageImportExecutor(() => {
        throw new Error("private");
      }).decode(imageBlob(), controller.signal),
    ).rejects.toThrow(/^IMAGE_INVALID$/u);

    for (const response of [
      { version: 1, requestId: "f".repeat(32), kind: "decoded", payload: "bounded" },
      { version: 1, requestId: "REQUEST", kind: "decoded", payload: "bounded", detail: "private" },
      { version: 1, requestId: "REQUEST", kind: "failed", code: "unknown" },
    ]) {
      const worker = new FakeWorker();
      const pending = createImageImportExecutor(() => worker).decode(
        imageBlob(),
        new AbortController().signal,
      );
      await vi.waitFor(() => expect(worker.posted).toHaveLength(1));
      const id = (worker.posted[0]!.message as { requestId: string }).requestId;
      worker.respond({
        ...response,
        requestId: response.requestId === "REQUEST" ? id : response.requestId,
      });
      await expect(pending).rejects.toThrow(/^IMAGE_INVALID$/u);
      expect(worker.terminateCalls).toBe(1);
    }
  });
});

describe("image import worker handler", () => {
  const run = async (
    bytes: Uint8Array,
    options: Readonly<{
      frameDimensions?: Readonly<{ width: number; height: number }>;
      animated?: boolean;
      frameCount?: number;
      metadataReject?: boolean;
      decodeComplete?: boolean;
    }> = {},
  ) => {
    const dimensions = options.frameDimensions ?? { width: 8, height: 8 };
    const decode = vi.fn(() =>
      Promise.resolve({
        complete: options.decodeComplete ?? true,
        image: {
          codedWidth: dimensions.width,
          codedHeight: dimensions.height,
          displayWidth: dimensions.width,
          displayHeight: dimensions.height,
          close: () => undefined,
        },
      }),
    );
    const createImageDecoder = vi.fn(() => ({
      complete: true,
      completed: Promise.resolve(),
      tracks: {
        ready: options.metadataReject
          ? Promise.reject(new Error("native metadata rejection"))
          : Promise.resolve(),
        length: 1,
        selectedTrack: {
          animated: options.animated ?? false,
          frameCount: options.frameCount ?? 1,
        },
      },
      decode,
      close: () => undefined,
    }));
    const responses: unknown[] = [];
    const owned = bytes.slice().buffer;
    await handleImageImportWorkerMessage(
      { version: 1, requestId: "0".repeat(32), bytes: owned },
      { postMessage: (message) => responses.push(message), close: () => undefined },
      {
        createImageDecoder,
        createCanvas: () => ({
          pixels: new Uint8ClampedArray(dimensions.width * dimensions.height * 4),
        }),
        decodeQr: () => null,
      },
    );
    return { createImageDecoder, decode, responses };
  };

  it.each([
    ["oversized metadata", OVERSIZED_PNG, "IMAGE_LIMIT"],
    ["animated PNG", APNG, "IMAGE_INVALID"],
    ["duplicate header PNG", DUPLICATE_IHDR_PNG, "IMAGE_INVALID"],
    ["bad CRC PNG", BAD_CRC_PNG, "IMAGE_INVALID"],
    ["truncated PNG", STATIC_PNG.subarray(0, STATIC_PNG.length - 7), "IMAGE_INVALID"],
    ["JPEG without multipicture guarantee", JPEG, "IMAGE_INVALID"],
    ["WebP without complete animation guarantee", WEBP, "IMAGE_INVALID"],
  ] as const)("rejects %s before pixel decode", async (_label, bytes, code) => {
    const result = await run(
      bytes,
      code === "IMAGE_LIMIT"
        ? { frameDimensions: { width: 4097, height: 1 } }
        : { metadataReject: true },
    );
    expect(result.decode).not.toHaveBeenCalled();
    expect(result.responses).toEqual([
      { version: 1, requestId: "0".repeat(32), kind: "failed", code },
    ]);
  });

  it.each([
    ["animated track", { animated: true, frameCount: 2 }],
    ["multiple frames", { animated: false, frameCount: 2 }],
  ] as const)("rejects %s before pixel decode", async (_label, options) => {
    const result = await run(APNG, options);
    expect(result.decode).not.toHaveBeenCalled();
    expect(result.responses).toEqual([
      { version: 1, requestId: "0".repeat(32), kind: "failed", code: "IMAGE_INVALID" },
    ]);
  });

  it("rejects an incomplete native frame decode", async () => {
    const result = await run(STATIC_PNG, { decodeComplete: false });
    expect(result.decode).toHaveBeenCalledOnce();
    expect(result.responses).toEqual([
      { version: 1, requestId: "0".repeat(32), kind: "failed", code: "IMAGE_INVALID" },
    ]);
  });

  it("decodes a native-accepted static PNG only after track metadata", async () => {
    const result = await run(STATIC_PNG);
    expect(result.createImageDecoder).toHaveBeenCalledOnce();
    expect(result.decode).toHaveBeenCalledOnce();
    expect(result.responses).toEqual([
      { version: 1, requestId: "0".repeat(32), kind: "failed", code: "QR_NOT_FOUND" },
    ]);
  });

  it("returns the first deterministic jsQR result without pretending to enumerate symbols", async () => {
    const responses: unknown[] = [];
    const decodeQr = vi.fn(() => ({
      data: "first",
      binaryData: [],
      chunks: [],
      version: 1,
      location: {
        topLeftCorner: { x: 1, y: 1 },
        topRightCorner: { x: 2, y: 1 },
        bottomLeftCorner: { x: 1, y: 2 },
        bottomRightCorner: { x: 2, y: 2 },
        topLeftFinderPattern: { x: 1, y: 1 },
        topRightFinderPattern: { x: 2, y: 1 },
        bottomLeftFinderPattern: { x: 1, y: 2 },
        bottomRightAlignmentPattern: { x: 2, y: 2 },
      },
    }));
    await handleImageImportWorkerMessage(
      { version: 1, requestId: "0".repeat(32), bytes: STATIC_PNG.slice().buffer },
      { postMessage: (message) => responses.push(message), close: () => undefined },
      {
        createImageDecoder: () => ({
          complete: true,
          completed: Promise.resolve(),
          tracks: {
            ready: Promise.resolve(),
            length: 1,
            selectedTrack: { animated: false, frameCount: 1 },
          },
          decode: () =>
            Promise.resolve({
              complete: true,
              image: {
                codedWidth: 8,
                codedHeight: 8,
                displayWidth: 8,
                displayHeight: 8,
                close: () => undefined,
              },
            }),
          close: () => undefined,
        }),
        createCanvas: () => ({ pixels: new Uint8ClampedArray(8 * 8 * 4) }),
        decodeQr,
      },
    );
    expect(decodeQr).toHaveBeenCalledOnce();
    expect(responses).toEqual([
      { version: 1, requestId: "0".repeat(32), kind: "decoded", payload: "first" },
    ]);
  });

  it("rejects corrupt and non-QR images with fixed results", async () => {
    const cases = [
      { bytes: [1, 2, 3, 4], bitmapReject: false, scans: [] },
      { bytes: [...STATIC_PNG], bitmapReject: true, scans: [] },
      {
        bytes: [...STATIC_PNG],
        bitmapReject: false,
        scans: [null],
      },
    ];
    const expected = ["IMAGE_INVALID", "IMAGE_INVALID", "QR_NOT_FOUND"];
    for (const [index, testCase] of cases.entries()) {
      const responses: unknown[] = [];
      const scans = [...testCase.scans];
      await handleImageImportWorkerMessage(
        {
          version: 1,
          requestId: "0".repeat(32),
          bytes: Uint8Array.from(testCase.bytes).buffer,
        },
        { postMessage: (message) => responses.push(message), close: () => undefined },
        {
          createImageDecoder: () => ({
            complete: true,
            completed: Promise.resolve(),
            tracks: {
              ready: testCase.bitmapReject
                ? Promise.reject(new Error("decoder detail"))
                : Promise.resolve(),
              length: 1,
              selectedTrack: { animated: false, frameCount: 1 },
            },
            decode: () =>
              Promise.resolve({
                complete: true,
                image: {
                  codedWidth: 8,
                  codedHeight: 8,
                  displayWidth: 8,
                  displayHeight: 8,
                  close: () => undefined,
                },
              }),
            close: () => undefined,
          }),
          createCanvas: () => ({ pixels: new Uint8ClampedArray(8 * 8 * 4) }),
          decodeQr: () => (scans.length === 0 ? null : scans.shift()!),
        },
      );
      expect(responses).toEqual([
        { version: 1, requestId: "0".repeat(32), kind: "failed", code: expected[index] },
      ]);
    }
  });
});
