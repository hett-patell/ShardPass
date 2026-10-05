import type { VaultItem } from "@shardpass/domain";
import { parseItemCrudResponseForRequest, RECENTLY_DELETED_DAYS } from "@shardpass/messaging";
import { Button } from "@shardpass/ui";
import { RotateCcw } from "lucide-react";
import { useState } from "react";

import type { ExtensionPlatform } from "../../../platform/extension-platform";
import { itemDisplayName, itemDisplaySubtitle } from "../../item-support";
import { DeleteItemDialog } from "../DeleteItemDialog";
import styles from "./Detail.module.css";

const KIND_NAMES: Record<VaultItem["kind"], string> = {
  login: "Login",
  otp: "One-time code",
  note: "Note",
  card: "Card",
  identity: "Identity",
  secret: "Secret",
};

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export interface DeletedItemDetailProps {
  item: VaultItem;
  platform: Pick<ExtensionPlatform, "sendMessage">;
  /** After a restore or a removal: the item has left Recently deleted either way. */
  onChanged: (outcome: "restored" | "purged") => void;
}

/**
 * An item in Recently deleted. Nothing in it can be copied or edited -- it is on its way
 * out -- so the pane says what it was, when it goes, and offers the two ways out of here.
 */
export function DeletedItemDetail({ item, platform, onChanged }: DeletedItemDetailProps) {
  const [busy, setBusy] = useState<"restore" | "purge" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const name = itemDisplayName(item);
  const subtitle = itemDisplaySubtitle(item);
  const deletedAt = item.deletedAt ?? new Date().toISOString();
  const purgeOn = new Date(Date.parse(deletedAt) + RECENTLY_DELETED_DAYS * 86_400_000);

  const run = (action: "restore" | "purge") => {
    setBusy(action);
    setError("");
    const request = {
      version: 1 as const,
      kind: "item.bulk" as const,
      action,
      itemIds: [item.id],
    };
    platform.sendMessage(request).then(
      (candidate) => {
        setBusy(null);
        const parsed = parseItemCrudResponseForRequest(request, candidate);
        if (parsed.success && parsed.data.kind === "item.bulkResult") {
          setConfirming(false);
          onChanged(action === "restore" ? "restored" : "purged");
        } else
          setError(
            action === "restore"
              ? "Could not restore this item. Try again."
              : "Could not delete this item. Try again.",
          );
      },
      () => {
        setBusy(null);
        setError("The background did not answer. Try again.");
      },
    );
  };

  return (
    <div className={styles.detail}>
      <header className={styles.header}>
        <h2 className={styles.title} tabIndex={-1}>
          {name}
        </h2>
        <p className={styles.valueMuted}>
          {KIND_NAMES[item.kind]}
          {subtitle === undefined ? "" : `, ${subtitle}`}
        </p>
      </header>
      <p className={styles.deletedNotice}>
        Deleted on {longDate(deletedAt)}. It stays here until {longDate(purgeOn.toISOString())},
        then it is removed for good. Restore it to use or edit it again.
      </p>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button
          onClick={() => run("restore")}
          loading={busy === "restore"}
          disabled={busy !== null}
        >
          <RotateCcw size={14} aria-hidden="true" />
          Restore
        </Button>
        <Button
          variant="ghost"
          className={styles.delete}
          disabled={busy !== null}
          onClick={() => setConfirming(true)}
        >
          Delete now
        </Button>
      </div>
      {confirming ? (
        <DeleteItemDialog
          itemName={name}
          title="Delete for good?"
          description={
            <>
              <strong>{name}</strong> will be removed from this device now. It cannot be restored
              afterwards.
            </>
          }
          confirmLabel="Delete for good"
          submitting={busy === "purge"}
          error={error}
          onCancel={() => {
            if (busy !== null) return;
            setConfirming(false);
            setError("");
          }}
          onConfirm={() => run("purge")}
        />
      ) : null}
    </div>
  );
}
