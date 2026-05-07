// Popup-side shims for libs that assume Node globals.
//
// Some Node-targeted dependencies pulled in transitively by fast-srp-hap and
// crypto-browserify (readable-stream, randombytes, etc.) reach for
// `process.nextTick`, `process.browser`, and the `Buffer` global without
// importing them explicitly. vite-plugin-node-polyfills' `globals` option is
// inconsistent with dynamically-imported chunks, so we install the polyfills
// ourselves before any of that code can evaluate.
//
// This module MUST be imported as the very first import in the popup entry.

import processPolyfill from "process";
import { Buffer as BufferPolyfill } from "buffer";

const g = globalThis as unknown as {
  process?: unknown;
  Buffer?: unknown;
  global?: unknown;
};

if (typeof g.process === "undefined") g.process = processPolyfill;
if (typeof g.Buffer === "undefined") g.Buffer = BufferPolyfill;
if (typeof g.global === "undefined") g.global = globalThis;

export {};
