import type { ItemListItemProjection } from "@shardpass/messaging";
import { ItemRow } from "@shardpass/ui";
import { ChevronRight } from "lucide-react";
import { useState } from "react";

import type { ExtensionPlatform } from "../../platform/extension-platform";
import type { VaultItemsStatus } from "../hooks/useVaultItems";
import styles from "./PopupItemList.module.css";
import { PopupLoginRow } from "./PopupLoginRow";
import { PopupOtpRow } from "./PopupOtpRow";

export interface PopupItemListProps {
  items: readonly ItemListItemProjection[];
  platform: Pick<
    ExtensionPlatform,
    "openVaultPage" | "sendMessage" | "sendOtpMessage" | "writeAuthoritativeClipboardText"
  >;
  status: VaultItemsStatus;
}

export function PopupItemList({ items, platform, status }: PopupItemListProps) {
  const [feedback, setFeedback] = useState("");

  function openVault(): void {
    void platform.openVaultPage().catch(() => undefined);
  }

  return (
    <div className={styles.region}>
      {status === "loading" ? <p className={styles.state}>Loading items…</p> : null}
      {status === "error" ? (
        <p className={styles.error} role="alert">
          Items unavailable. Try again.
        </p>
      ) : null}
      {status === "ready" && items.length === 0 ? (
        <div className={styles.empty}>
          <strong>No items yet</strong>
          <span>Add an item to get started.</span>
        </div>
      ) : null}
      {status === "ready" && items.length > 0 ? (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.id}>
              {item.kind === "otp" ? (
                <PopupOtpRow item={item} platform={platform} onFeedback={setFeedback} />
              ) : item.kind === "login" ? (
                <PopupLoginRow item={item} platform={platform} onFeedback={setFeedback} />
              ) : (
                <ItemRow
                  kind={item.kind}
                  name={item.name}
                  {...(item.subtitle === undefined ? {} : { subtitle: item.subtitle })}
                  onClick={openVault}
                  rightContent={<ChevronRight size={14} aria-hidden="true" />}
                />
              )}
            </li>
          ))}
        </ul>
      ) : null}
      <p className={styles.feedback} role="status" aria-live="polite">
        {feedback}
      </p>
    </div>
  );
}
