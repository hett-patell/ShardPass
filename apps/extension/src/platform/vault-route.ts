import { VAULT_ITEM_KINDS, type VaultItemKind } from "@shardpass/domain";

/**
 * Where the vault page should land when another surface opens it. Carried in the URL hash
 * (never a secret: a view name, an item kind, or an item id), so an already-open vault tab
 * can be moved there without a reload and a fresh one boots straight into it.
 */
export type VaultPageTarget =
  | {
      view:
        | "overview"
        | "settings"
        | "ente"
        | "import"
        | "health"
        | "generator"
        | "usernames"
        | "aliases";
    }
  | { newItem: VaultItemKind }
  | { item: string };

const ITEM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export function vaultPageHash(target?: VaultPageTarget): string {
  if (target === undefined) return "";
  if ("view" in target) {
    if (target.view === "import") return "#/settings/import";
    if (target.view === "generator" || target.view === "usernames" || target.view === "aliases")
      return `#/tools/${target.view}`;
    return `#/${target.view}`;
  }
  if ("newItem" in target) return `#/new/${target.newItem}`;
  return ITEM_ID.test(target.item) ? `#/item/${target.item}` : "";
}

export function parseVaultPageHash(hash: string): VaultPageTarget | null {
  const path = hash.startsWith("#") ? hash.slice(1) : hash;
  switch (path) {
    case "/settings":
      return { view: "settings" };
    case "/settings/import":
      return { view: "import" };
    case "/ente":
      return { view: "ente" };
    case "/health":
      return { view: "health" };
    case "/overview":
      return { view: "overview" };
    case "/tools/generator":
      return { view: "generator" };
    case "/tools/usernames":
      return { view: "usernames" };
    case "/tools/aliases":
      return { view: "aliases" };
    default:
      break;
  }
  const created = /^\/new\/([a-z]+)$/u.exec(path);
  if (created !== null) {
    const kind = created[1] ?? "";
    return (VAULT_ITEM_KINDS as readonly string[]).includes(kind)
      ? { newItem: kind as VaultItemKind }
      : null;
  }
  const item = /^\/item\/([0-9a-f-]{36})$/iu.exec(path);
  if (item !== null && item[1] !== undefined && ITEM_ID.test(item[1]))
    return { item: item[1].toLowerCase() };
  return null;
}
