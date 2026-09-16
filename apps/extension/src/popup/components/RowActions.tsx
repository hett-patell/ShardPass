import type { ItemListItemProjection } from "@shardpass/messaging";
import { Button } from "@shardpass/ui";
import { KeyRound } from "lucide-react";

import type { ExtensionPlatform } from "../../platform/extension-platform";
import { LiveCode } from "./LiveCode";
import { QuickAction } from "./QuickAction";
import styles from "./RowActions.module.css";

export interface RowActionsProps {
  item: ItemListItemProjection;
  platform: Pick<ExtensionPlatform, "sendOtpMessage">;
  onCopyPassword: (item: ItemListItemProjection) => void;
  onCopyCode: (item: ItemListItemProjection, code: string) => void;
  /** Present when the login can be filled into the open tab. */
  onFill?: (item: ItemListItemProjection) => void;
  filling?: boolean;
}

/**
 * The quick actions a row earns from its kind: a live code for one-time codes, copy password
 * for logins, and Fill when the login belongs to the open tab. Shared by every list in the
 * popup so search results are as useful as the category lists.
 */
export function RowActions({
  item,
  platform,
  onCopyPassword,
  onCopyCode,
  onFill,
  filling = false,
}: RowActionsProps) {
  if (item.kind === "otp")
    return (
      <LiveCode platform={platform} itemId={item.id} onCopy={(code) => onCopyCode(item, code)} />
    );
  if (item.kind !== "login") return null;
  return (
    <>
      {item.signInWith === undefined ? (
        <QuickAction
          aria-label={`Copy password for ${item.name}`}
          title="Copy password"
          onClick={() => onCopyPassword(item)}
        >
          <KeyRound size={15} />
        </QuickAction>
      ) : null}
      {onFill ? (
        <Button className={styles.fill} loading={filling} onClick={() => onFill(item)}>
          Fill
        </Button>
      ) : null}
    </>
  );
}
