# Execution Evidence Provenance Index

The former execution ledger was materially contaminated by unrelated repeated editorial content and transport markers. Its later Task 7-looking history, including a disclosed overwrite/recovery, cannot be independently authenticated from owner-controlled evidence. The contaminated bytes were preserved before this index replaced the working path.

Owner review is required. Neither the reconstruction nor this index claims owner approval.

## Evidence files

- [Preserved contaminated ledger](recovery/project1-task7-contaminated-execution-ledger-2026-08-10.md) — `132626` bytes; SHA-256 `3618d7fe35b05393852463f200df0576533f5115bb996faee51ae3a41566b44b`; copied byte-for-byte, verified with matching source/copy hashes and `cmp`, then marked read-only (`0444`) as intent.
- [Clean Project 1 Task 7 reconstruction](project1-task7-execution-ledger.md) — `17321` bytes; SHA-256 `261b8c8de2daf6436e59662555d78e19f0c8b60da087fc59d2ac8b41ed8ad559`; reconstruction awaiting owner review.
- [Recovery manifest](recovery/MANIFEST.md) — records sealed-payload boundaries, contamination ranges, custody checks, and unresolved limitations.

The clean ledger hash is stored in the separate manifest because embedding a file's own digest would alter the hashed payload. Do not silently edit or delete the preserved artifact. Any correction to the clean ledger must be reviewed and resealed with recomputed size/hash.
