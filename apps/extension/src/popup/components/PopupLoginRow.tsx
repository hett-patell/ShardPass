import type { ItemListItemProjection } from "@shardpass/messaging";
import { parseLoginFillResponseForRequest } from "@shardpass/messaging";
import { ItemRow } from "@shardpass/ui";
import { ChevronRight, KeyRound, User } from "lucide-react";
import { useState, type MouseEvent } from "react";

import type { ExtensionPlatform } from "../../platform/extension-platform";
import { scheduleClipboardClear } from "../../vault/components/detail/clipboard";
import styles from "./PopupLoginRow.module.css";

export interface PopupLoginRowProps {
  item: ItemListItemProjection;
  platform: Pick<
    ExtensionPlatform,
    "openVaultPage" | "sendMessage" | "writeAuthoritativeClipboardText"
  >;
  onFeedback: (message: string) => void;
}

/**
 * A login in the popup: the row opens the vault page; the two buttons copy the username
 * (already in the projection) or the password (released by `login.reveal` against the
 * revision the list saw, so a concurrent edit is refused rather than copied blind).
 */
export function PopupLoginRow({ item, platform, onFeedback }: PopupLoginRowProps) {
  const [busy, setBusy] = useState(false);
  const username = item.subtitle;

  function openVault(): void {
    void platform.openVaultPage().catch(() => undefined);
  }

  function copy(event: MouseEvent, what: "username" | "password"): void {
    event.stopPropagation();
    if (busy) return;
    if (what === "username" && !username) return;
    setBusy(true);
    const payload =
      what === "username"
        ? Promise.resolve(username ?? "")
        : (() => {
            const request = {
              version: 1 as const,
              kind: "login.reveal" as const,
              itemId: item.id,
              expectedRevision: item.revision,
            };
            return platform.sendMessage(request).then((candidate) => {
              const parsed = parseLoginFillResponseForRequest(request, candidate);
              if (!parsed.success || parsed.data.kind !== "login.fillRelease")
                throw new Error("password unavailable");
              return parsed.data.password;
            });
          })();
    void payload.catch(() => undefined);
    void platform
      .writeAuthoritativeClipboardText(payload)
      .then(() => {
        scheduleClipboardClear();
        onFeedback(what === "username" ? "Username copied" : "Password copied");
      })
      .catch(() => onFeedback("Copy failed. Try again."))
      .finally(() => setBusy(false));
  }

  return (
    <ItemRow
      kind="login"
      name={item.name}
      {...(username === undefined ? {} : { subtitle: username })}
      onClick={openVault}
      rightContent={<ChevronRight size={14} aria-hidden="true" />}
      actions={
        <span className={styles.actions}>
          {username ? (
            <button
              type="button"
              className={styles.action}
              aria-label={`Copy username for ${item.name}`}
              title="Copy username"
              disabled={busy}
              onClick={(event) => copy(event, "username")}
            >
              <User size={14} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className={styles.action}
            aria-label={`Copy password for ${item.name}`}
            title="Copy password"
            disabled={busy}
            onClick={(event) => copy(event, "password")}
          >
            <KeyRound size={14} aria-hidden="true" />
          </button>
        </span>
      }
    />
  );
}
