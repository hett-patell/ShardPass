import { useRef } from "react";
import { createPortal } from "react-dom";

import type { ExtensionPlatform } from "../../platform/extension-platform";
import { RecoveryCodeMaker } from "../../vault-access/RecoveryCodeMaker";
import { derivePageKey } from "../../vault-access/VaultAccess";
import styles from "./detail/Detail.module.css";
import { useModalDialog } from "./useModalDialog";

export interface RecoveryOfferDialogProps {
  platform: Pick<ExtensionPlatform, "sendMessage">;
  onClose: () => void;
}

/**
 * Offered once, straight after a vault is created: the one moment a person is already
 * thinking about what happens if the master password is lost. Declining is fine; Settings
 * makes a code at any time.
 */
export function RecoveryOfferDialog({ platform, onClose }: RecoveryOfferDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useModalDialog(dialogRef, { onCancel: onClose });

  return createPortal(
    <dialog
      ref={dialogRef}
      className={`${styles.dialog} ${styles.dialogWide}`}
      aria-labelledby="recovery-offer-heading"
      aria-describedby="recovery-offer-description"
      {...({ closedby: "closerequest" } as Record<string, string>)}
    >
      <h3 id="recovery-offer-heading">Make a recovery code</h3>
      <p id="recovery-offer-description">
        If you forget your master password, a recovery code is the only way back into this vault.
        Make one now and keep it somewhere outside this browser, on paper or in a file only you can
        reach. You can also make one later in Settings.
      </p>
      <RecoveryCodeMaker
        platform={platform}
        deriveKey={derivePageKey}
        onDone={onClose}
        onSkip={onClose}
      />
    </dialog>,
    document.body,
  );
}
