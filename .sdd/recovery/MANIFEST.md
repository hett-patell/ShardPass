# Task 7 Provenance Recovery Manifest

Prepared 2026-08-10 for owner review. This manifest records sealed payload boundaries; it does not authenticate the former ledger history or grant owner approval.

## Preserved contaminated artifact

- Path: [`project1-task7-contaminated-execution-ledger-2026-08-10.md`](project1-task7-contaminated-execution-ledger-2026-08-10.md)
- Byte size: `132626`
- SHA-256: `3618d7fe35b05393852463f200df0576533f5115bb996faee51ae3a41566b44b`
- Custody: copied directly from `.sdd/execution-ledger.md` before replacement; source and copy hashes/sizes matched and `cmp` reported byte equality both immediately after copying and immediately before replacement.
- Read-only intent: copy mode was set to `0444`. This documents intent only; it is not an immutable-filesystem or cryptographic-access-control guarantee.

## Clean reconstructed payload

- Path: [`../project1-task7-execution-ledger.md`](../project1-task7-execution-ledger.md)
- Byte size: `17321`
- SHA-256: `261b8c8de2daf6436e59662555d78e19f0c8b60da087fc59d2ac8b41ed8ad559`
- Boundary: the hash covers the exact bytes of the clean ledger file only. The digest is stored here because embedding a file's own digest would change the bytes being hashed.
- Status: reconstruction awaiting owner review; not owner-approved.

## Contamination and recovery limitations

- Preserved lines 1–1,700 are unrelated editorial/transport contamination; transport markers occur at lines 1, 293, 585, 877, 1,169, and 1,461. Repeated full blocks occupy lines 2–292, 294–584, 586–876, 878–1,168, and 1,170–1,460; lines 1,462–1,700 are another partial repetition.
- ShardPass Task 7-looking entries occupy preserved lines 1,701–2,009. Relevance does not establish authenticity or completeness.
- A persisted agent result reports a recovered `beforeContent` prefix of 128,294 bytes; the preserved ledger's own later disclosure reports 128,172 bytes. No detached exact payload with a trustworthy pre-overwrite SHA-256 was established. Neither value is authenticated by this manifest.
- Persisted ZCode agent outputs were used only as provenance sources. They are not owner-signed, and no claim is made that their timestamps or contents are independently immutable.
