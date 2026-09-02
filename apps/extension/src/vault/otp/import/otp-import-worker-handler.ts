import { imageDimensionsFromData } from "image-dimensions";
import jsQR, { type QRCode } from "jsqr";

import {
  IMAGE_IMPORT_WORKER_VERSION,
  IMPORT_LIMITS,
  parseImageImportWorkerRequest,
  validateQrPayload,
  type ImageImportWorkerFailureCode,
} from "@shardpass/importers/qr-worker-protocol";

type FrameLike = Readonly<{
  codedWidth: number;
  codedHeight: number;
  displayWidth: number;
  displayHeight: number;
  close(): void;
}>;
type DecoderLike = Readonly<{
  complete: boolean;
  completed: Promise<void>;
  tracks: Readonly<{
    ready: Promise<void>;
    length: number;
    selectedTrack: Readonly<{ animated: boolean; frameCount: number }> | null;
  }>;
  decode(options?: ImageDecodeOptions): Promise<Readonly<{ complete: boolean; image: FrameLike }>>;
  close(): void;
}>;
type CanvasPixels = Readonly<{ pixels: Uint8ClampedArray }>;
export type ImageImportWorkerDependencies = Readonly<{
  createImageDecoder(bytes: Uint8Array): DecoderLike;
  createCanvas(frame: FrameLike): CanvasPixels;
  decodeQr(pixels: Uint8ClampedArray, width: number, height: number): QRCode | null;
}>;
type WorkerPort = Readonly<{ postMessage(message: unknown): void; close(): void }>;

// Captured intrinsic is invoked only with an explicit receiver through Reflect.apply.
// eslint-disable-next-line @typescript-eslint/unbound-method
const arrayBufferByteLength = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  "byteLength",
)?.get;

function lengthOfArrayBuffer(value: unknown): number | null {
  if (arrayBufferByteLength === undefined) return null;
  try {
    return Reflect.apply(arrayBufferByteLength, value, []) as number;
  } catch {
    return null;
  }
}

function clearBuffer(buffer: ArrayBuffer): void {
  const length = lengthOfArrayBuffer(buffer);
  if (length !== null && length > 0) new Uint8Array(buffer).fill(0);
}

function snapshotRequest(value: unknown): { input: unknown; retained: ArrayBuffer | null } {
  if (typeof value !== "object" || value === null) return { input: null, retained: null };
  let keys: readonly PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch {
    return { input: null, retained: null };
  }
  const expected = ["version", "requestId", "bytes"] as const;
  if (keys.length !== expected.length || !expected.every((key) => keys.includes(key)))
    return { input: null, retained: null };
  const captured = Object.create(null) as Record<string, unknown>;
  let valid = true;
  for (const key of ["bytes", "version", "requestId"] as const) {
    try {
      captured[key] = Reflect.get(value, key);
    } catch {
      valid = false;
    }
  }
  const retained =
    lengthOfArrayBuffer(captured.bytes) === null ? null : (captured.bytes as ArrayBuffer);
  if (retained === null) valid = false;
  return { input: valid ? Object.freeze(captured) : null, retained };
}

type ImageMetadata = Readonly<{ width: number; height: number }>;

function preflightPngDimensions(bytes: Uint8Array): ImageMetadata {
  const metadata = imageDimensionsFromData(bytes);
  if (metadata?.type !== "png") throw new Error("IMAGE_INVALID");
  const { width, height } = metadata;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1)
    throw new Error("IMAGE_INVALID");
  if (width > IMPORT_LIMITS.maxImageDimension || height > IMPORT_LIMITS.maxImageDimension)
    throw new Error("IMAGE_LIMIT");
  if (width > Math.floor(IMPORT_LIMITS.maxImagePixels / height)) throw new Error("IMAGE_LIMIT");
  return Object.freeze({ width, height });
}

function defaultCreateImageDecoder(bytes: Uint8Array): DecoderLike {
  if (typeof ImageDecoder !== "function") throw new Error("IMAGE_INVALID");
  return new ImageDecoder({ data: bytes, type: "image/png", preferAnimation: false });
}

function defaultCreateCanvas(frame: FrameLike): CanvasPixels {
  if (typeof OffscreenCanvas !== "function") throw new Error("IMAGE_INVALID");
  const canvas = new OffscreenCanvas(frame.codedWidth, frame.codedHeight);
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (context === null) throw new Error("IMAGE_INVALID");
  context.drawImage(frame as VideoFrame, 0, 0);
  const imageData = context.getImageData(0, 0, frame.codedWidth, frame.codedHeight);
  return { pixels: imageData.data };
}

const defaultDependencies: ImageImportWorkerDependencies = {
  createImageDecoder: defaultCreateImageDecoder,
  createCanvas: defaultCreateCanvas,
  decodeQr: (pixels, width, height) =>
    jsQR(pixels, width, height, { inversionAttempts: "attemptBoth" }),
};

function fixedCode(error: unknown): ImageImportWorkerFailureCode {
  if (error instanceof Error && error.message === "IMAGE_LIMIT") return "IMAGE_LIMIT";
  if (error instanceof Error && error.message === "QR_NOT_FOUND") return "QR_NOT_FOUND";
  return "IMAGE_INVALID";
}

export async function handleImageImportWorkerMessage(
  data: unknown,
  port: WorkerPort,
  dependencies: ImageImportWorkerDependencies = defaultDependencies,
): Promise<void> {
  const snapshot = snapshotRequest(data);
  let decoder: DecoderLike | null = null;
  let frame: FrameLike | null = null;
  let pixels: Uint8ClampedArray | null = null;
  let requestId: string | null = null;
  try {
    const request = parseImageImportWorkerRequest(snapshot.input);
    requestId = request.requestId;
    const bytes = new Uint8Array(request.bytes);
    const metadata = preflightPngDimensions(bytes);
    decoder = dependencies.createImageDecoder(bytes);
    await decoder.completed;
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    if (
      decoder.complete !== true ||
      decoder.tracks.length !== 1 ||
      track === null ||
      track.animated ||
      track.frameCount !== 1
    )
      throw new Error("IMAGE_INVALID");
    const result = await decoder.decode({ frameIndex: 0, completeFramesOnly: true });
    frame = result.image;
    if (result.complete !== true) throw new Error("IMAGE_INVALID");
    if (
      frame.codedWidth !== metadata.width ||
      frame.codedHeight !== metadata.height ||
      frame.displayWidth !== metadata.width ||
      frame.displayHeight !== metadata.height
    )
      throw new Error("IMAGE_INVALID");
    const canvas = dependencies.createCanvas(frame);
    pixels = canvas.pixels;
    if (pixels.byteLength !== metadata.width * metadata.height * 4)
      throw new Error("IMAGE_INVALID");
    const decoded = dependencies.decodeQr(pixels, metadata.width, metadata.height);
    if (decoded === null) throw new Error("QR_NOT_FOUND");
    validateQrPayload(decoded.data);
    port.postMessage({
      version: IMAGE_IMPORT_WORKER_VERSION,
      requestId,
      kind: "decoded",
      payload: decoded.data,
    });
  } catch (error) {
    if (requestId !== null) {
      try {
        port.postMessage({
          version: IMAGE_IMPORT_WORKER_VERSION,
          requestId,
          kind: "failed",
          code: fixedCode(error),
        });
      } catch {
        // Response failure cannot prevent cleanup and worker closure.
      }
    }
  } finally {
    try {
      pixels?.fill(0);
    } catch {
      // Continue cleanup after a hostile mutable view.
    }
    try {
      frame?.close();
    } catch {
      // Continue cleanup after native frame failure.
    }
    try {
      decoder?.close();
    } catch {
      // Continue cleanup after native decoder failure.
    }
    try {
      if (snapshot.retained !== null) clearBuffer(snapshot.retained);
    } catch {
      // Continue to mandatory worker closure.
    }
    try {
      port.close();
    } catch {
      // Worker scope closure is best effort.
    }
  }
}
