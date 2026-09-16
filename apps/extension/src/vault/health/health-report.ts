import type { LoginItem, VaultItem } from "@shardpass/domain";

import { acceptsPasskeys } from "./passkey-sites";

export type ReusedGroup = Readonly<{ logins: readonly LoginItem[] }>;

export interface HealthReport {
  /** Live logins with a password, the material every section is drawn from. */
  readonly logins: readonly LoginItem[];
  /** Groups of two or more logins sharing one password. */
  readonly reused: readonly ReusedGroup[];
  /** Logins saved for a plain http:// site. */
  readonly unsecured: readonly LoginItem[];
  /** Password logins with no one-time code of their own or linked to them. */
  readonly withoutTwoFactor: readonly LoginItem[];
  /** Logins for sites known to accept passkeys that have none saved yet. */
  readonly passkeyReady: readonly LoginItem[];
  /** Logins left out because their secrets are withheld until the master password is given again. */
  readonly skipped: number;
}

/**
 * What the vault can say about its own logins without a network: which passwords are
 * shared, which sites are unencrypted, which accounts have no second factor here. Weak
 * and breached passwords need the estimator and the breach check, which the view adds.
 */
export function computeHealth(
  items: readonly VaultItem[],
  redactedIds: ReadonlySet<string> = new Set(),
): HealthReport {
  const logins: LoginItem[] = [];
  let skipped = 0;
  for (const item of items) {
    if (item.kind !== "login" || item.archivedAt !== undefined || item.deletedAt !== undefined)
      continue;
    if (redactedIds.has(item.id)) {
      skipped += 1;
      continue;
    }
    if (item.password === "") continue;
    logins.push(item);
  }
  const byPassword = new Map<string, LoginItem[]>();
  for (const login of logins) {
    const group = byPassword.get(login.password);
    if (group === undefined) byPassword.set(login.password, [login]);
    else group.push(login);
  }
  const reused = [...byPassword.values()]
    .filter((group) => group.length > 1)
    .sort((left, right) => right.length - left.length)
    .map((group) => ({ logins: group }));
  const unsecured = logins.filter((login) =>
    login.urls.some((url) => /^http:\/\//iu.test(url.trim())),
  );
  const withoutTwoFactor = logins.filter(
    (login) =>
      login.signInWith === undefined &&
      (login.totp ?? "").trim() === "" &&
      login.linkedOtpId === undefined,
  );
  const passkeyReady = logins.filter(
    (login) => (login.passkeys ?? []).length === 0 && acceptsPasskeys(login.urls),
  );
  return { logins, reused, unsecured, withoutTwoFactor, passkeyReady, skipped };
}
