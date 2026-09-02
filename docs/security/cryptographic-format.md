# Cryptographic format

## Task 13 release binding

Task 13 does not change vault, backup, OTP, Ente, KDF, or AEAD formats. Release identity is a separate SHA-256 build-evidence domain: the complete regular-file `dist/` tree is identified as `{ name, version, candidateDigest }` under `ShardPass packaged candidate v1\0`. The candidate is frozen before consumers run, and source/candidate secret scans, full tests, Task 12 observed Chrome 110 record, detached Ed25519 external-review signature/trust store, deterministic archive, audit, docs, and final evidence DAG must bind the same `candidateDigest`.

The archive uses raw DEFLATE level 9 with root `ShardPass-<version>/`, timestamp `1980-01-01T00:00:00Z`, 0644 files, 0755 directories, and no owner/group/comment/extra/symlink/executable metadata. Archive hashing proves packaging identity, not cryptographic confidentiality or authenticity. Only `pnpm verify:project1` under Node 22, pnpm 10.14.0, actual Chrome 110, isolated network modes, and trusted review can emit `PASS-PROJECT1-RELEASE`; Node 24/Chromium 151.0.7922.34 is development-only and every other outcome is `STOP-PROJECT1-RELEASE`.

## Version 1 key hierarchy

ShardPass generates one random 32-byte vault data-encryption key (DEK). A 32-byte key-encryption key (KEK), derived from the exact master-password UTF-8 bytes and a fresh 16-byte salt, wraps the DEK with XChaCha20-Poly1305. Persisted `WrappedVaultKey` values use the strict Task 2 schema: format version 1, Argon2id parameters and padded canonical Base64 salt, plus algorithm ID, padded canonical Base64 24-byte nonce, and ciphertext containing the 16-byte tag.

The wrapped-key AEAD associated data is the UTF-8 byte string `shardpass:wrapped-vault-key:v1:xchacha20-poly1305`. It binds the format and algorithms independently of mutable storage location. Item encryption uses the DEK and a fresh random 24-byte nonce for every encryption. Callers must never reuse a nonce/key pair.

## Algorithms and dependencies

- Argon2id v1.3 (`version: 0x13`) comes from exact-pinned `@noble/hashes@2.2.0`.
- XChaCha20-Poly1305 comes from exact-pinned `@noble/ciphers@2.2.0`.
- Both are pure TypeScript-derived ESM implementations with zero runtime dependencies. They do not use WebAssembly, dynamic code generation, or runtime network access.
- The extension CSP remains `script-src 'self'` without `unsafe-eval` or `wasm-unsafe-eval`.

Noble Ciphers 1.0.0 had an independent Cure53 audit covering the package in September 2024 and 2.2.0 had an April 2026 project self-review. The independent Noble Hashes 1.0.0 audit explicitly excluded Argon2; Argon2 2.2.0 had an April 2026 project self-review. Accordingly, ShardPass describes these as reviewed dependencies and does not claim that this Argon2 implementation or ShardPass itself has an independent audit.

The package-internal direct primitive used by the worker is checked against node-argon2's published raw Argon2id vector: password `password`, salt `saltsaltsaltsalt`, memory 65,536 KiB, three iterations, four lanes, and output `ac15942c3e63386a50cb7dab2ef19c9af40c56a2153409ab0ad7a45af500f1bc`. The isolated browser test repeats that known answer end to end through the public executor, strict worker protocol, and dedicated Worker. The AEAD test reproduces the CFRG XChaCha20-Poly1305 draft vector beginning with key `808182...9f`, nonce `404142...57`, and ciphertext `bd6d179d...acf49`.

## Password and Argon2id policy

Passwords are encoded once with `TextEncoder` and are not normalized, trimmed, case-folded, or otherwise transformed. Canonically equivalent Unicode strings therefore remain distinct passwords. New vault setup requires at least 12 Unicode code points and at most 1,024 UTF-8 bytes. Generic derivation and unwrapping accept empty or shorter passwords only to read compatible stored descriptors; they never apply setup policy retroactively.

Persisted parameter bounds match the Task 2 schema:

- memory: 8,192–131,072 KiB;
- iterations: 1–10;
- parallelism: 1–4;
- memory must be at least eight times parallelism.

`DEFAULT_ARGON2ID_PARAMETERS` is 65,536 KiB, two iterations, and parallelism one. This retains the 64 MiB memory cost while reducing the measured multi-second unlock cost of three iterations. `deriveKeyEncryptionKey(executor, password, parameters, salt, options?)`, `createVaultKeyMaterial(executor, password, random?)`, and `unwrapVaultDataKey(executor, password, wrapped)` require an explicit `KdfExecutor`; there is no blocking or Worker-absence fallback. New setup always uses the default, while unwrap accepts every Task 2-valid persisted parameter set. Compatibility descriptors are built only by a utility under `packages/crypto/test`; no test helper remains in production source or package exports.

The browser executor creates one local module Worker per derivation from a static Vite URL. Version-1 strict messages contain one 32-hex-character request ID, bounded password/salt/parameters, and only `started`, transferred 32-byte `success`, or detail-free `failure` responses. Both client and worker validate inputs. Before posting, the client copies password and salt into exact-length, privately owned plain `ArrayBuffer` instances and transfers both buffers; caller arrays remain attached and unchanged while the private sender copies detach in a real structured-clone transfer. References to private copies are dropped after transfer or failure. The client establishes its abort listener before invoking the factory, rechecks cancellation before creation, and catches synchronous abort during factory execution; a Worker returned after cancellation is terminated once and is never posted to. Factory results are treated as hostile values. Validation reads `terminate` first inside a guard and captures the callable once, then separately reads and captures `postMessage`; neither getter is reread during posting or cleanup. Throwing getters and Proxy traps are contained. If `postMessage` lookup fails after a callable terminator was captured, termination is attempted once with that captured method and candidate receiver before fixed rejection. The client enforces a bounded timeout, redacts factory/post/worker/protocol failures as `KDF_EXECUTION_FAILED`, and uses one idempotent settlement path. Timer clearing, abort-listener removal, handler nulling, and termination are individually exception-contained so hostile setters or throwing cleanup methods cannot replace the sanitized outcome; termination is attempted at most once. The worker entry alone imports the blocking Noble Argon2 primitive. No Blob/data/remote Worker, dynamic code, or network loading is used.

Argon2 is not described as cooperative in browser JavaScript. UI responsiveness comes from executing the entire blocking primitive off the extension page's main thread. The browser test begins a default-cost Worker derivation, waits for `started`, and observes at least two interval callbacks before completion. Chrome MV3 service workers are not assumed to create dedicated Workers; Task 5 must supply this execution port through a trusted extension page or offscreen-document architecture. Task 3 adds no offscreen permission or production offscreen machinery, and background code cannot import the direct primitive.

The isolated `.test-dist/crypto-extension` harness measures Worker computation from an extension page. It is built by a separate Vite/CRXJS configuration, loaded directly by the crypto Playwright test, and removed from release inputs and after browser tests. Production scanning rejects benchmark/test-helper material if it leaks into `dist`; dependency rules reject production imports of crypto tests and allow direct primitive access only from the worker entry or crypto tests. Measurements are local hardware/runtime observations, not universal timing guarantees. Round-1 candidate measurements remain useful for selecting 64 MiB/2. On local headless Chromium 151.0.7922.34, the final round-2 dedicated-Worker run measured 1,996.6 ms and the page observed 288 ten-millisecond interval callbacks between `started` and completion; only the behavioral minimum of two callbacks is asserted. The MV3 service worker exposed no benchmark symbol and performed no Argon2 computation.

## Portable backup v2

ShardPass backup v2 is a portable, password-protected format. Its UTF-8 outer document is strict canonical JSON in this exact field order: `type`, `formatVersion`, `payloadSchemaVersion`, `kdf`, `cipher`, and `ciphertext`. Unknown fields, alternate field order or whitespace, malformed UTF-8, unsupported versions or algorithms, non-safe-integer work factors, and noncanonical Base64 are rejected. The type is `shardpass-backup`, the format version is 2, and the payload schema version is 1.

The authenticated header is the same canonical JSON construction without `ciphertext`, encoded as UTF-8. Its fixed order is `type`, `formatVersion`, `payloadSchemaVersion`, then KDF fields `algorithm`, `version`, `memoryKiB`, `iterations`, `parallelism`, `salt`, then cipher fields `algorithm`, `nonce`. These exact bytes are XChaCha20-Poly1305 associated data. Changing any header field or ciphertext therefore fails authentication.

Each export uses a separate backup password, a fresh random 16-byte Argon2id salt, and a fresh random 24-byte XChaCha20-Poly1305 nonce. Argon2id uses version 19 and the same validated work-factor bounds described above; production export defaults to 65,536 KiB, two iterations, and parallelism one. The derived 32-byte key is backup-only and is never the vault DEK. Ciphertext uses canonical padded Base64 and includes Noble Ciphers' 16-byte authentication tag. The implementation calls the existing `@shardpass/crypto` KDF executor and AEAD adapter; it defines no cryptographic primitive.

The plaintext is strict canonical UTF-8 JSON containing only schema version 1, export time, up to 10,000 current `OtpItem` values, safe lock settings (`autoLockMinutes` 0, 5, 15, 30, or 60 and `lockOnScreenLock`), and explicitly selected logical history. Logical history is bounded to 10,000 journal entries and 10,000 tombstones. Journal entries preserve sequence, item ID, kind/schema/revision, operation, change time, and optional mutation ID. Tombstones preserve only item ID, revision, and deletion time. Empty history remains empty; import does not invent absent history. The maximum outer document is 8,388,608 bytes and decoded ciphertext is at most 8,000,000 bytes. Domain schemas retain their existing item and string bounds before export and after decryption.

Portable backups never contain the vault DEK, wrapped keys, authenticated roots, manifests, encrypted storage records, migration transaction state, Ente credentials or pending operations, HOTP reservations or receipts, session epochs, or capabilities. Passwords, derived keys, plaintext, and decoded cryptographic buffers are held in implementation-owned mutable byte copies where practical and cleared in independent `finally` paths. JavaScript and garbage-collected runtimes provide no guaranteed zeroization; cleanup is best effort, and callers continue to own and clear their input arrays.

Import also supports the authorized legacy `type: "shardpass-export"`, version 1 wrapper as import-only compatibility. Production parsing rejects the synthetic fixture metadata used by the test harness, delegates PBKDF2/AES-GCM handling to the existing legacy-v1 compatibility module, maps supported TOTP, HOTP, and Steam records field-by-field, omits Ente state, uses safe default lock settings because that wrapper carries no settings, and represents unavailable journal/tombstone history as empty. ShardPass exposes no legacy export API.

Backup passwords remain in the trusted full-vault page. That page gives private password-byte copies to its local KDF Worker and sends only a canonical Base64 KEK proof for the separate current-password step-up; plaintext current or backup passwords do not cross runtime messaging. The background never derives a backup KEK. Export first obtains a one-use authenticated portable snapshot and, before exposing a download link, decrypts and strictly reparses the generated v2 bytes with independently retained inputs and compares the canonical plaintext payload.

An import applies at most one new authenticated generation containing the item merge, effective lock settings, and normalized logical history. Imported journal sequence numbers are not storage identities: validated logical events are deduplicated, bounded, and re-encrypted with contiguous generation-local sequences; tombstones must correspond to authenticated delete events. Confirmation reloads authenticated current state and reclassifies the proposed merge, including HOTP maximum-counter behavior. A changed result produces a replacement preview and requires another explicit confirmation. No import write occurs during preview.

Authenticated `lock-settings` generation metadata is the unlocked settings authority. Standalone settings storage is a runtime scheduling/UI projection: setup and unlock reconcile it from authenticated metadata, and import applies it only after root activation. A projection failure cannot roll back an already committed root and is reconciled on a later unlock; the implementation does not claim cross-store projection atomicity. Repository mutation serialization plus authenticated-root checks are local coordination, not cross-process compare-and-swap.

## Record associated data

Record associated data uses deterministic binary encoding, not JSON. Fields occur exactly in this order:

1. `format`
2. `formatVersion`
3. `itemId`
4. `kind`
5. `schemaVersion`
6. `revision`

Each value is converted to its canonical decimal or literal string, encoded as UTF-8, and preceded by a four-byte unsigned big-endian byte length. The decoder rejects truncation, trailing bytes, invalid UTF-8, and non-integer numeric fields. Modifying any authenticated item field, nonce, or ciphertext causes decryption to fail with a generic authentication error.

## Memory and error limits

Implementation code keeps values in `Uint8Array` form where practical. The Worker boundary intentionally makes private request copies to avoid transferring or detaching caller-owned arrays; those private buffers are detached by successful transfer and local references are dropped after transfer or failure. JavaScript engines may copy, retain, optimize, or move strings and typed arrays, so ShardPass does not claim guaranteed memory zeroization. Authentication errors do not distinguish wrong passwords from modified ciphertext. No secrets or derived material are logged.
