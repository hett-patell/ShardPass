import type { ItemListItemProjection } from "@shardpass/messaging";
import { ItemRow } from "@shardpass/ui";
import { ChevronRight } from "lucide-react";

import type { ExtensionPlatform } from "../../platform/extension-platform";

export interface PopupLoginRowProps {
  item: ItemListItemProjection;
  platform: Pick<ExtensionPlatform, "openVaultPage">;
}

// Filling the active tab from the popup (Task 6's login-fill message) needs the
// active tab's identity, which the popup does not resolve on its own — for now every
// login row opens the full vault to view or edit, same as the other non-OTP kinds.
export function PopupLoginRow({ item, platform }: PopupLoginRowProps) {
  function openVault(): void {
    void platform.openVaultPage().catch(() => undefined);
  }

  return (
    <ItemRow
      kind="login"
      name={item.name}
      {...(item.subtitle === undefined ? {} : { subtitle: item.subtitle })}
      onClick={openVault}
      rightContent={<ChevronRight size={14} aria-hidden="true" />}
    />
  );
}
