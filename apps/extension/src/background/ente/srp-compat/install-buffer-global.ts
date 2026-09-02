import { Buffer } from "./buffer";

Object.defineProperty(globalThis, "Buffer", {
  configurable: false,
  enumerable: false,
  value: Buffer,
  writable: false,
});
