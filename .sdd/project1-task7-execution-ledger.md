# Project 1 Task 7 — Reconstructed Execution Ledger

## Status and evidence boundary

This is a conservative reconstruction prepared for owner review on 2026-08-10. It is **not owner-approved** and is not a claim that the former ledger history is independently authenticated.

Evidence labels used below:

- **Independent reconstruction check** — performed during this provenance-repair session against files currently on disk.
- **Agent-reported execution** — copied in summarized form from a named persisted agent `output.txt` or from the Task 7-looking range of the preserved ledger. The command was not rerun during this reconstruction unless explicitly stated.
- **Static-review conclusion** — a reviewer reported tracing current code/tests without necessarily executing them.
- **Unverified historical entry** — text is present in the contaminated ledger, but no independent chain of custody establishes authorship, completeness, or exact pre-overwrite origin.

The sealed SHA-256 and byte size of this file are recorded externally in [`.sdd/recovery/MANIFEST.md`](recovery/MANIFEST.md). A hash cannot be embedded in the bytes it hashes without changing the hash; the manifest therefore defines the sealed-file boundary.

## Provenance and contamination map

**Independent reconstruction check:** the former `.sdd/execution-ledger.md` was 132,626 bytes, 2,009 physical lines as counted by Python `splitlines()`, and SHA-256 `3618d7fe35b05393852463f200df0576533f5115bb996faee51ae3a41566b44b`. It was copied byte-for-byte before replacement to [`.sdd/recovery/project1-task7-contaminated-execution-ledger-2026-08-10.md`](recovery/project1-task7-contaminated-execution-ledger-2026-08-10.md). `cmp` succeeded, source/copy sizes matched, and both hashes matched. The preserved copy was made non-writable (`0444`) as read-only intent, not as an immutable-storage guarantee.

Range map of the preserved artifact (one-based physical line numbers):

- **Lines 1–1,700: unrelated contamination / transport capture.** Line 1 is `LINE 114 PATH /response/text`. Lines 2–292 contain unrelated editorial/blog material. Lines 293, 585, 877, 1,169, and 1,461 are additional transport markers. The block following the first marker is repeated exactly across lines 294–584, 586–876, 878–1,168, and 1,170–1,460. Lines 1,462–1,700 begin another partial repetition and end in the middle of that unrelated structure.
- **Lines 1,701–2,009: authoritative-looking ShardPass Task 7 history.** These entries are relevant in subject matter and chronological shape, but remain **unverified historical entries** because they share the contaminated artifact and lack an owner-controlled pre-overwrite digest or detached original.
- No earlier ShardPass Task 7 range was found before line 1,701. Whether earlier Task 7 entries were omitted before the captured range is unknown and unverifiable from the project artifact alone.

Persisted provenance sources were inspected under `/home/het/.zcode/cli/agents/sess_475fc0cd-31ed-486e-b219-e470d18aaf94`. Only compact agent results and narrowly searched transcript evidence were used; arbitrary transcript content and sensitive fixture/runtime values were not copied here. These files are ZCode-local persisted outputs, not owner-signed or independently immutable evidence.

### Known overwrite/recovery incident

**Agent-reported execution:** agent `3218c302-8215-406a-b492-4bb159764006/output.txt` states that an append accidentally replaced the ledger with a placeholder, that a persisted tool-result `beforeContent` was used for recovery, and that the restored prefix was checked against a 128,294-byte payload before appending once.

**Unverified historical entry:** preserved-ledger line 2,006 instead states that the recovered pre-write content was 128,172 bytes. Reviewer agent `8c371a15-b5a8-4044-9a15-d9606d66af52/output.txt` quotes the 128,172-byte statement and concluded that no pre-overwrite hash, detached backup, Git history, or owner-controlled evidence authenticated those restored bytes.

The two reported lengths conflict. Narrow transcript searches located the two disclosures but no trustworthy SHA-256 for either alleged `beforeContent` payload and no detached exact payload suitable for sealing. This reconstruction therefore does **not** authenticate either length, does not call the recovered bytes authoritative, and treats the entire former ledger as preserved recovery evidence only.

## Chronological reconstruction

Dates below are retained only where they appeared in the Task 7-looking ledger headings. Exact times were unavailable and are not invented.

### 2026-08-03 — Legacy importer and initial migration boundary

**Unverified historical entry (preserved lines 1,701–1,737):** reported a bounded, import-only legacy-v1 reader, deterministic mapping, all-or-nothing staging/verification/activation behavior, strict privileged messaging, and preservation of the legacy source. It reported importer, service, messaging, settings-compatibility, browser-gate, full-suite, build/security, and legacy-hash results. These exact early counts are retained only in the preserved artifact; they are not promoted here because later phases superseded them and custody is weak.

**Agent-reported recovery (`4c66224b-e303-45cb-ac33-1f7979fc15ad/output.txt`):** an interrupted round was found broken: a focused service suite did not load, typecheck reported eight errors, and the importer crypto file was reported truncated. The agent reported restoring a bounded WebCrypto reader and structural destination compatibility, then obtaining 6 files / 44 tests, a serial full source result of 53 files / 779 tests, typecheck/lint/Prettier/dependency/security gates, packaged browser 13/13, and legacy fixture/hash 8/8 with 17/17 preserved artifacts. These are agent-reported results, not reruns in this reconstruction.

### 2026-08-03 — Ordered substrate and importer corrections

**Unverified historical entries (preserved lines 1,778–1,850):** reported generation-format v3 authenticated metadata, bounded importer derived-key APIs, Ente validation, session-owned migration snapshots/commit capabilities, migrated lock settings, metadata preservation through repository mutations, canonical AAD, generation capacity preflight, and deadlock/capability corrections.

The same entries report strict RED/GREEN phases followed by serial-source results rising from 792 to 799 tests and passing typecheck, lint, Prettier, dependency, security-build, generated-output, semantic-scan, legacy-hash, and audit gates on Node 24.18.0 with pinned pnpm 10.14.0. These command results were not independently rerun here.

### 2026-08-03 — Password-rotation preservation correction

**Unverified historical entry (preserved lines 1,832–1,850):** reported correcting password rotation so authenticated metadata and idempotency receipts survive re-encryption, while retained nonce accounting spans both retained generations.

**Static-review conclusion (`525ef239-68ce-49a4-9db2-1c6518d4ae26/output.txt`):** the scoped reviewer traced current session/storage code and tests and returned **APPROVED**, with no Critical or Important issue in that narrow password-rotation scope. It explicitly described this as a static review and did not claim Node 22 execution.

### 2026-08-03 to 2026-08-05 — Document-bound credential lifecycle

**Unverified historical entries (preserved lines 1,851–1,902):** reported a document-bound challenge/token service, exact sender binding, bounded lifecycle and cleanup, canonical key handling, source snapshot binding, and later review fixes for races, stale authorization, capacity/pruning, transactional source validation, and canonical Base64.

**Static-review conclusion (`0d22534d-29d8-460e-bc69-38e482e4bf3f/output.txt`):** an earlier reviewer returned **NOT APPROVED**, identifying lock/disposal races, post-cleanup credential release, unbounded maps, and insufficient transactional source binding. That reviewer explicitly ran no focused command.

**Agent-reported correction (`d2349f13-9d27-4627-ada8-35c3e94c9728/output.txt`):** a later agent reported completing the credential fix round. This reconstruction attributes the correction to that persisted result but does not reproduce sensitive test vectors or internal values.

### 2026-08-10 — Durable state, authenticated finalization, and concurrency

**Unverified historical entries (preserved lines 1,903–1,953):** reported restart-reconstructible encrypted migration transactions; source, payload, root, target, phase, owner, revision, lease, and metadata binding; token-only credential-driven start/retry; authenticated final application of settings and Ente state; conservative reconciliation; lease arbitration; strict tamper matrices; and interruption testing across observed writes.

**Agent-reported execution (`91ed1652-f70c-4807-abf1-e60cc0ec2dfe/output.txt`):** reported implementing credential-driven lifecycle and authenticated finalization after recovering an abandoned partial state.

**Agent-reported recovery (`2b6a69f8-fd07-4843-8015-ecf5212e6f00/output.txt`):** reported persisted-state inspection and rerun evidence after interruption. The preserved ledger records later full serial source results of 840 tests and passing static/build/security/audit gates; those exact counts remain agent-reported.

**Standing limitation:** extension storage has no compare-and-swap primitive. The modeled lease/revision checks, worker-wide mutex, and authenticated target/root rechecks are evidence against tested races, not proof of absolute simultaneous exclusion across independently executing workers.

### 2026-08-10 — Final backend review corrections

**Unverified historical entry (preserved lines 1,955–1,971):** reported two Important corrections: recover authenticated interrupted staging under the same transaction/generation, and calculate record capacity from the 10,000-entry generation cap minus actual mandatory/optional migration metadata. It reports destination RED with five expected failures, destination GREEN 13/13, relevant regressions 85 tests, full source 844 tests, and passing typecheck/lint/changed-file Prettier.

**Static-review custody:** final and scoped reviewer outputs in the persisted session include both earlier non-approval findings and later approvals. Approval scopes differ; no narrow approval should be read as approval of ledger provenance or of all Task 7 behavior.

### 2026-08-10 — Production background runtime wiring

**Agent-reported execution (`1826d887-c361-4b11-9243-9439764537a8/output.txt`):** reported one background-owned dependency graph using shared session/settings lifecycle, live migration routing after readiness, lock/disposal cleanup, and state publication. Its runtime integration RED initially returned safe unavailability, then exposed order-dependent payload hashing; canonical item ordering for hashing was reported as the minimal correction.

Reported verification: runtime GREEN 1/1, relevant regressions 13 files / 126 tests, bounded full source 58 files / 845 tests, and passing TypeScript, ESLint, Prettier, and dependency-cruiser (153 modules / 410 dependencies). The first unconstrained run reportedly had one unrelated timeout that passed in isolation before the bounded full run. All are agent-reported, not rerun here.

### 2026-08-10 — Trusted-page UI and dedicated worker

**Unverified historical entry (preserved lines 1,985–1,995):** reported an unlocked full-vault-only progressive migration panel and a same-origin single-use PBKDF2 worker. The reported boundary keeps passwords in the trusted page/worker, sends only bounded derived material for authorization and opaque tokens for start/retry, terminates on cancellation/timeout, ignores stale responses, and projects only safe status/count text.

Reported RED: three missing UI/worker modules. Reported GREEN: 4 files / 16 tests; broader migration/background/vault/messaging/importer/legacy 23 files / 209 tests; full serial source 61 files / 854 tests; passing typecheck, lint, changed-file Prettier, dependency-cruiser, security build, generated-output, and semantic scan. Full-repository Prettier reportedly failed only because the former append-only ledger already had drift. These are historical agent reports.

### 2026-08-10 — Packaged browser RED, root cause, and GREEN

**Agent-reported execution (`3218c302-8215-406a-b492-4bb159764006/output.txt`):** the packaged migration browser test initially observed background unavailability. The reported root cause was a startup/storage ordering race: service-worker existence was treated as completed background readiness before trusted storage/settings initialization. The correction was a production-neutral trusted-page readiness handshake in the browser test; no production code or security assertion was reported changed.

Reported GREEN and final checks: focused migration browser 1/1 twice, 10/10 repeated clean-profile runs for race confirmation, relevant packaged set 5/5, complete packaged browser 13/13 after the required adjacent crypto test build, focused source regressions 9 files / 77 tests, and passing TypeScript, ESLint, changed-file Prettier, security build, generated-output checks, semantic scan, and crypto test build. The agent states only clean temporary synthetic profiles were used. These are agent-reported results, not browser reruns during provenance repair.

This was the append during which the overwrite/recovery incident occurred. Its custody claim is limited as described above.

## Reviewer verdicts

- **Scoped substrate/password-rotation review — APPROVED:** agent `525ef239-68ce-49a4-9db2-1c6518d4ae26`; static review only.
- **Other scoped backend reviews — mixed over time:** persisted outputs contain NOT APPROVED findings followed by correction rounds and later scoped approvals. They establish review activity, not an authenticated linear release record.
- **Final complete Task 7 review — NOT APPROVED:** agent `8c371a15-b5a8-4044-9a15-d9606d66af52`. The reviewer found no high-confidence implementation or secret-boundary defect, but withheld release approval because the ledger was contaminated and its recovered history could not be independently authenticated.
- **Current reconstruction — OWNER REVIEW REQUIRED:** no owner approval is claimed by this file or the provenance index.

## Environment and verification limitations

- Historical commands consistently report installed Node 24.18.0 with pinned pnpm 10.14.0 under a development-only exception. **Official Node 22 verification is not claimed.**
- Historical browser output reports Playwright 1.62.0 and Chrome for Testing 151.0.7922.34. This reconstruction did not rerun browser E2E.
- Exact test counts changed across phases as tests were added. Counts above belong only to their attributed agent output/entry and must not be combined into a synthetic final count.
- Persisted agent outputs and transcripts are local tooling artifacts. Their presence supports attribution but does not provide signatures, trusted timestamps, owner custody, or proof that omitted output never existed.
- No exact recoverable pre-overwrite `beforeContent` hash was established. The conflicting 128,294-byte and 128,172-byte claims remain unresolved.
- This provenance repair does not modify or reassess production/test code, dependencies, engines, lockfiles, legacy artifacts, or generated `dist` output.

## Standing security constraints

These constraints are conclusions consistently represented by current static review and the historical evidence; they remain requirements, not a blanket security certification:

- Legacy migration is import-only; the legacy source must not be overwritten or deleted by Task 7.
- Passwords remain in the trusted vault document and dedicated local worker; background start/retry receives only an opaque credential token.
- Authorization remains bound to the exact trusted extension document/tab/frame and rejects popup/content/forged contexts.
- No passwords, OTP seeds/codes, keys, tokens, Ente credentials, decrypted records, roots, fingerprints, or arbitrary internal errors may enter logs, messages, UI projections, or this evidence ledger.
- Activation and recovery authenticate the exact expected root and target generation; status/lease alone is never evidence of completion.
- Unexpected roots and unverifiable/tampered durable state fail conservatively rather than being overwritten.
- JavaScript buffer clearing is best-effort and is not represented as guaranteed physical-memory zeroization.
- Steam handling remains `static-inference-only; runtime parity is not claimed`.
- The non-CAS storage limitation remains explicit.

## Owner review checklist

1. Confirm the preserved contaminated artifact hash/size against the manifest.
2. Review lines 1,701–2,009 of the preserved artifact and the named compact agent outputs against this summary.
3. Decide whether any additional owner-controlled command logs or original `beforeContent` payload exist.
4. Independently rerun the release verification matrix in the required Node 22 environment if release policy requires it.
5. Record approval or corrections outside this sealed payload, then reseal a revised payload rather than editing evidence silently.
