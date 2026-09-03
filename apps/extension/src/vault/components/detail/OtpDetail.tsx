import type { OtpItem } from "@shardpass/domain";
import type { OtpEditableInput, OtpResponse } from "@shardpass/messaging";
import { Button, StatusBadge } from "@shardpass/ui";
import { useRef, useState } from "react";

import type { ExtensionPlatform } from "../../../platform/extension-platform";
import { DeleteOtpDialog } from "../../otp/DeleteOtpDialog";
import { OtpEditor } from "../../otp/OtpEditor";
import { CopyButton } from "./CopyButton";
import styles from "./Detail.module.css";
import { useOtpLiveCode } from "./useOtpLiveCode";

export interface OtpDetailProps {
  item: OtpItem;
  platform: ExtensionPlatform;
  onUpdate: () => void;
  onDeleted: () => void;
}

const otpTypeLabel: Record<OtpItem["otpType"], string> = {
  totp: "TOTP",
  hotp: "HOTP",
  steam: "Steam",
};

const deleteUnavailable = "Could not delete this item. Try again.";

function editableValue(item: OtpItem): OtpEditableInput {
  return {
    issuer: item.issuer,
    label: item.label,
    secret: item.secret,
    otpType: item.otpType,
    algorithm: item.algorithm,
    digits: item.digits,
    period: item.period,
    ...(item.counter === undefined ? {} : { counter: item.counter }),
    favorite: item.favorite,
    tags: [...item.tags],
    note: item.note,
  };
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const candidate = (error as { code?: unknown }).code;
  return typeof candidate === "string" ? candidate : undefined;
}

/**
 * OTP detail/edit surface for the three-panel vault layout. Reuses the existing
 * OtpEditor for the edit form (per the task brief, OtpEditor itself is not
 * rewritten) and the existing DeleteOtpDialog for delete confirmation, wiring both
 * to the item's own otp.update/otp.delete round trip instead of the list-oriented
 * useOtpVault hook. Live TOTP/Steam codes are fetched directly since HOTP counters
 * must never be advanced just by viewing an item.
 */
export function OtpDetail({ item, platform, onUpdate, onDeleted }: OtpDetailProps) {
  const [editing, setEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [attempted, setAttempted] = useState<OtpEditableInput | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const deleteOpener = useRef<HTMLButtonElement | null>(null);

  const liveCodeEligible = item.otpType !== "hotp";
  const { code, remaining } = useOtpLiveCode(
    platform,
    liveCodeEligible ? item.id : null,
    liveCodeEligible && !editing,
  );

  const submit = async (value: OtpEditableInput) => {
    setSubmitting(true);
    setConflict(false);
    try {
      const response: OtpResponse = await platform.sendOtpMessage({
        version: 1,
        kind: "otp.update",
        itemId: item.id,
        expectedRevision: item.revision,
        input: value,
      });
      if (response.kind === "otp.mutationResult") {
        setAttempted(null);
        setEditing(false);
        onUpdate();
      }
    } catch (error) {
      if (errorCode(error) === "OTP_CONFLICT") {
        setAttempted(value);
        setConflict(true);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const confirmDelete = async () => {
    setSubmitting(true);
    setDeleteError("");
    try {
      const response: OtpResponse = await platform.sendOtpMessage({
        version: 1,
        kind: "otp.delete",
        itemId: item.id,
        expectedRevision: item.revision,
      });
      if (response.kind === "otp.deleteResult") {
        setDeleteOpen(false);
        onDeleted();
      } else {
        setDeleteError(deleteUnavailable);
      }
    } catch (failure) {
      // Name the refusal: a bare "try again" hides conflicts and locks from the person fixing it.
      const code = (failure as { code?: unknown })?.code;
      setDeleteError(typeof code === "string" ? `${deleteUnavailable} (${code})` : deleteUnavailable);
    } finally {
      setSubmitting(false);
    }
  };

  const name = item.issuer || item.label;

  if (editing) {
    return (
      <OtpEditor
        mode="edit"
        value={attempted ?? editableValue(item)}
        revision={item.revision}
        submitting={submitting}
        conflict={conflict}
        onSubmit={submit}
        onCancel={() => {
          setEditing(false);
          setAttempted(null);
          setConflict(false);
        }}
        onDelete={(opener) => {
          deleteOpener.current = opener;
          setDeleteOpen(true);
        }}
      />
    );
  }

  return (
    <div className={styles.detail}>
      <header className={styles.header}>
        <h2 className={styles.title}>{name}</h2>
        {item.issuer ? <p className={styles.valueMuted}>{item.label}</p> : null}
      </header>

      <div className={styles.tagRow}>
        <StatusBadge status="neutral">{otpTypeLabel[item.otpType]}</StatusBadge>
        {item.tags.map((tag) => (
          <span key={tag} className={styles.tag}>
            {tag}
          </span>
        ))}
      </div>

      <div className={styles.fieldGroup}>
        <span className={styles.label}>Code</span>
        {item.otpType === "hotp" ? (
          <p className={styles.valueMuted}>
            Counter-based codes are generated during autofill. Use Edit to view or change the
            configuration.
          </p>
        ) : code === null ? (
          <p className={styles.valueMuted}>Loading code…</p>
        ) : (
          <div className={styles.row}>
            <span className={styles.otpCode}>{code.code}</span>
            <span className={styles.otpCountdown} data-urgent={String(remaining <= 6)}>
              {remaining}s
            </span>
            <CopyButton label="Copy code" value={code.code} />
          </div>
        )}
      </div>

      {item.note ? (
        <div className={styles.fieldGroup}>
          <span className={styles.label}>Note</span>
          <p className={styles.value}>{item.note}</p>
        </div>
      ) : null}

      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button
          variant="destructive"
          onClick={(event) => {
            deleteOpener.current = event.currentTarget;
            setDeleteOpen(true);
          }}
        >
          Delete
        </Button>
      </div>

      {deleteError ? (
        <p className={styles.error} role="alert">
          {deleteError}
        </p>
      ) : null}

      {deleteOpen ? (
        <DeleteOtpDialog
          label={name}
          submitting={submitting}
          onCancel={() => {
            if (submitting) return;
            setDeleteOpen(false);
            deleteOpener.current?.focus();
          }}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </div>
  );
}
