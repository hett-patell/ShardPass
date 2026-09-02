import { ITEM_SCHEMA_VERSION } from "@shardpass/domain";

/** Metadata fields shared by every VaultItem kind, freshly minted for an import. */
export interface NewItemBase {
  id: string;
  schemaVersion: typeof ITEM_SCHEMA_VERSION;
  revision: 1;
  createdAt: string;
  updatedAt: string;
  favorite: boolean;
  tags: string[];
}

export function newItemBase(): NewItemBase {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    schemaVersion: ITEM_SCHEMA_VERSION,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    favorite: false,
    tags: [],
  };
}
