export type WasmDescriptor = Readonly<{ module?: string; name: string; kind: string }>;
export type SodiumWasmInventory = Readonly<{
  magicHex: string;
  wasmSha256: string;
  imports: WasmDescriptor[];
  exports: WasmDescriptor[];
}>;
export type SodiumIdentity = SodiumWasmInventory &
  Readonly<{
    containingModuleSha256: string;
    payloadCount: number;
    importsSha256: string;
    exportsSha256: string;
  }>;

export function extractEmbeddedSodiumWasm(
  source: string,
  kind?: "auto" | "installed" | "packaged",
): Readonly<{ payloadCount: number; payload: string; bytes: Uint8Array }>;
export function inventorySodiumWasm(bytes: Uint8Array): SodiumWasmInventory;
export function inspectSodiumContainingModule(
  source: string,
  kind?: "auto" | "installed" | "packaged",
): SodiumIdentity;
export function verifyApprovedSodiumIdentity(
  source: string,
  approved: Record<string, unknown>,
  containingModuleKind: "installed" | "packaged",
): SodiumIdentity;
