import {
  createDeterministicRandomSource,
  createWorkerKdfExecutor,
  decryptEnvelope,
  deriveKeyEncryptionKey,
  encryptEnvelope,
} from "@shardpass/crypto";

import { runDefaultArgon2idBenchmark } from "./benchmark";

const hex = (value: string): Uint8Array =>
  Uint8Array.from(value.match(/.{2}/gu) ?? [], (byte) => Number.parseInt(byte, 16));
const toHex = (value: Uint8Array): string =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");

async function run(): Promise<void> {
  const sodiumWorker = new Worker(new URL("./ente-sodium-worker.ts", import.meta.url), {
    type: "module",
  });
  const sodiumReady = new Promise<Readonly<{ wasm: string; imports: string; exports: string }>>(
    (resolve, reject) => {
      sodiumWorker.onmessage = (event: MessageEvent<unknown>) => {
        if (
          typeof event.data === "object" &&
          event.data !== null &&
          Reflect.get(event.data, "kind") === "ente-sodium-ready"
        ) {
          const identity = Reflect.get(event.data, "identity") as unknown;
          if (
            typeof identity === "object" &&
            identity !== null &&
            typeof Reflect.get(identity, "wasm") === "string" &&
            typeof Reflect.get(identity, "imports") === "string" &&
            typeof Reflect.get(identity, "exports") === "string"
          )
            resolve(identity as Readonly<{ wasm: string; imports: string; exports: string }>);
          else reject(new Error("Ente sodium CSP harness failed"));
        } else reject(new Error("Ente sodium CSP harness failed"));
      };
      sodiumWorker.onerror = () => reject(new Error("Ente sodium CSP harness failed"));
    },
  );
  const sodiumIdentity = await sodiumReady;
  document.body.dataset.sodiumWasmSha256 = sodiumIdentity.wasm;
  document.body.dataset.sodiumImportsSha256 = sodiumIdentity.imports;
  document.body.dataset.sodiumExportsSha256 = sodiumIdentity.exports;
  sodiumWorker.terminate();

  const key = hex("808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f");
  const nonce = hex("404142434445464748494a4b4c4d4e4f5051525354555657");
  const aad = hex("50515253c0c1c2c3c4c5c6c7");
  const plaintext = hex(
    "4c616469657320616e642047656e746c656d656e206f662074686520636c617373206f66202739393a204966204920636f756c64206f6666657220796f75206f6e6c79206f6e652074697020666f7220746865206675747572652c2073756e73637265656e20776f756c642062652069742e",
  );
  const expected =
    "bd6d179d3e83d43b9576579493c0e939572a1700252bfaccbed2902c21396cbb731c7f1b0b4aa6440bf3a82f4eda7e39ae64c6708c54c216cb96b72e1213b4522f8c9ba40db5d945b11b69b982c1bb9e3f3fac2bc369488f76b2383565d3fff921f9664c97637da9768812f615c68b13b52ec0875924c1c7987947deafd8780acf49";
  const envelope = await encryptEnvelope(
    key,
    plaintext,
    aad,
    createDeterministicRandomSource(nonce),
  );
  if (toHex(envelope.ciphertext) !== expected) throw new Error("XChaCha known answer failed.");
  if (toHex(await decryptEnvelope(key, envelope, aad)) !== toHex(plaintext)) {
    throw new Error("XChaCha round trip failed.");
  }

  let ticks = 0;
  let started = false;
  const interval = setInterval(() => {
    if (started) ticks += 1;
  }, 10);
  const knownAnswer = await deriveKeyEncryptionKey(
    createWorkerKdfExecutor(),
    "password",
    { algorithm: "argon2id", memoryKiB: 65_536, iterations: 3, parallelism: 1 },
    new TextEncoder().encode("saltsaltsaltsalt"),
    { onStarted: () => (started = true) },
  );
  clearInterval(interval);
  if (toHex(knownAnswer) !== "0da38a14b42c0a97db18714d0011c5c63cec962e19202b7cdfe8ead145435e54") {
    throw new Error("Argon2 worker known answer failed.");
  }
  document.body.dataset.responsiveTicks = String(ticks);
  document.body.dataset.argon2Ms = (await runDefaultArgon2idBenchmark()).toFixed(1);
  document.body.dataset.sodiumStatus = "passed";
  document.body.dataset.srpStatus = "passed";
  document.body.dataset.cryptoStatus = "passed";
}

void run().catch(() => {
  document.body.dataset.cryptoStatus = "failed";
});
