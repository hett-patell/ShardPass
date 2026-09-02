import type { OtpItem, VaultItem } from "@shardpass/domain";

import type { ExtensionPlatform } from "../../platform/extension-platform";
import { CardDetail } from "./detail/CardDetail";
import { IdentityDetail } from "./detail/IdentityDetail";
import { LoginDetail } from "./detail/LoginDetail";
import { NoteDetail } from "./detail/NoteDetail";
import { OtpDetail } from "./detail/OtpDetail";
import { SecretDetail } from "./detail/SecretDetail";

export interface ItemDetailPanelProps {
  item: VaultItem;
  platform: ExtensionPlatform;
  /** Full OTP item set, used by LoginDetail to resolve and preview a linked OTP. */
  otpItems: readonly OtpItem[];
  onUpdate: () => void;
  onDeleted: () => void;
}

/** Dispatches to the per-kind detail/edit surface for the selected vault item. */
export function ItemDetailPanel({ item, platform, otpItems, onUpdate, onDeleted }: ItemDetailPanelProps) {
  switch (item.kind) {
    case "login":
      return (
        <LoginDetail
          item={item}
          platform={platform}
          otpItems={otpItems}
          onUpdate={onUpdate}
          onDeleted={onDeleted}
        />
      );
    case "otp":
      return <OtpDetail item={item} platform={platform} onUpdate={onUpdate} onDeleted={onDeleted} />;
    case "note":
      return <NoteDetail item={item} platform={platform} onUpdate={onUpdate} onDeleted={onDeleted} />;
    case "card":
      return <CardDetail item={item} platform={platform} onUpdate={onUpdate} onDeleted={onDeleted} />;
    case "identity":
      return <IdentityDetail item={item} platform={platform} onUpdate={onUpdate} onDeleted={onDeleted} />;
    case "secret":
      return <SecretDetail item={item} platform={platform} onUpdate={onUpdate} onDeleted={onDeleted} />;
  }
}
