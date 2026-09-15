import type { LoginItem, OtpItem, Folder } from "@shardpass/domain";
import { SIGN_IN_PROVIDER_LABELS } from "@shardpass/domain";
import { useState } from "react";

import type { ExtensionPlatform } from "../../../platform/extension-platform";
import { DeleteItemDialog } from "../DeleteItemDialog";
import { LoginForm, MATCH_MODE_LABELS } from "../forms/LoginForm";
import { updateItem } from "../forms/submit-item";
import { CopyButton } from "./CopyButton";
import styles from "./Detail.module.css";
import { useFocusAfterEdit } from "./useFocusAfterEdit";
import { DetailActions } from "./DetailActions";
import { RevealField } from "./RevealField";
import { useInlineTotp } from "./useInlineTotp";
import { useOtpLiveCode } from "./useOtpLiveCode";

export interface LoginDetailProps {
  item: LoginItem;
  platform: ExtensionPlatform;
  otpItems: readonly OtpItem[];
  folders: readonly Folder[];
  onUpdate: () => void;
  onDeleted: () => void;
}

function normalizeUrl(url: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//iu.test(url) ? url : `https://${url}`;
}

type Passkey = NonNullable<LoginItem["passkeys"]>[number];

function formatChangedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function LoginDetail({
  item,
  platform,
  otpItems,
  folders,
  onUpdate,
  onDeleted,
}: LoginDetailProps) {
  const [editing, setEditing] = useState(false);
  const titleRef = useFocusAfterEdit(editing);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [passkeyToRemove, setPasskeyToRemove] = useState<Passkey | null>(null);
  const [removingPasskey, setRemovingPasskey] = useState(false);
  const [passkeyError, setPasskeyError] = useState("");
  const linkedOtp =
    item.linkedOtpId === undefined
      ? null
      : (otpItems.find((otp) => otp.id === item.linkedOtpId) ?? null);
  const liveCodeItemId = linkedOtp !== null && linkedOtp.otpType !== "hotp" ? linkedOtp.id : null;
  const { code, remaining } = useOtpLiveCode(
    platform,
    liveCodeItemId,
    liveCodeItemId !== null && !editing,
  );
  const inline = useInlineTotp(item, !editing);

  const confirmRemovePasskey = async () => {
    if (passkeyToRemove === null) return;
    setRemovingPasskey(true);
    setPasskeyError("");
    const kept = (item.passkeys ?? []).filter(
      (candidate) => candidate.credentialId !== passkeyToRemove.credentialId,
    );
    const result = await updateItem(platform, item.id, item.revision, {
      passkeys: kept.length === 0 ? undefined : kept,
    });
    setRemovingPasskey(false);
    if (result.status === "saved") {
      setPasskeyToRemove(null);
      onUpdate();
      return;
    }
    setPasskeyError(
      result.status === "conflict"
        ? "This item changed elsewhere. Reload and try again."
        : "Could not remove the passkey. Try again.",
    );
  };

  if (editing) {
    return (
      <LoginForm
        item={item}
        platform={platform}
        otpItems={otpItems}
        onSaved={() => {
          setEditing(false);
          onUpdate();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const customFields = item.customFields ?? [];
  const history = item.passwordHistory ?? [];

  return (
    <div className={styles.detail}>
      <header className={styles.header}>
        <h2 ref={titleRef} tabIndex={-1} className={styles.title}>
          {item.name}
        </h2>
      </header>

      {item.tags.length > 0 ? (
        <div className={styles.tagRow}>
          {item.tags.map((tag) => (
            <span key={tag} className={styles.tag}>
              {tag}
            </span>
          ))}
        </div>
      ) : null}

      <div className={styles.fieldGroup}>
        <span className={styles.label}>Username</span>
        <div className={styles.row}>
          <span className={styles.rowValue}>{item.username || "—"}</span>
          {item.username ? <CopyButton label="Copy username" value={item.username} /> : null}
        </div>
      </div>

      {item.signInWith !== undefined ? (
        <div className={styles.fieldGroup}>
          <span className={styles.label}>Signs in with</span>
          <div className={styles.row}>
            <span className={styles.rowValue}>{SIGN_IN_PROVIDER_LABELS[item.signInWith]}</span>
          </div>
        </div>
      ) : null}
      {item.signInWith === undefined || item.password !== "" ? (
        <RevealField label="Password" value={item.password} />
      ) : null}

      {history.length > 0 ? (
        <div className={styles.fieldGroup}>
          <button
            type="button"
            className={styles.disclosure}
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((open) => !open)}
          >
            {historyOpen ? "Hide" : "Show"} password history ({history.length})
          </button>
          {historyOpen ? (
            <ul className={styles.historyList} aria-label="Previous passwords">
              {history.map((entry, index) => (
                <li key={`${entry.changedAt}-${index}`} className={styles.historyRow}>
                  <RevealField
                    label={`Replaced ${formatChangedAt(entry.changedAt)}`}
                    value={entry.password}
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {item.totp ? (
        <div className={styles.fieldGroup}>
          <span className={styles.label}>One-time code</span>
          {inline.invalid ? (
            <span className={styles.valueMuted}>The stored secret is not a valid TOTP secret.</span>
          ) : inline.code === null ? (
            <span className={styles.valueMuted}>Generating code…</span>
          ) : (
            <div className={styles.row}>
              <span className={styles.otpCode}>{inline.code}</span>
              <span className={styles.otpCountdown} data-urgent={String(inline.remaining <= 6)}>
                {inline.remaining}s
              </span>
              <CopyButton label="Copy one-time code" value={inline.code} />
            </div>
          )}
        </div>
      ) : null}

      {item.urls.length > 0 ? (
        <div className={styles.fieldGroup}>
          <span className={styles.label}>{item.urls.length > 1 ? "Websites" : "Website"}</span>
          <div className={styles.linkList}>
            {item.urls.map((url, index) => {
              const mode = item.urlMatches?.[index] ?? "domain";
              return (
                <div key={`${url}-${index}`} className={styles.row}>
                  <a
                    className={`${styles.rowValue} ${styles.link}`}
                    href={normalizeUrl(url)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {url}
                  </a>
                  {mode !== "domain" ? (
                    <span
                      className={styles.badge}
                      title={`Autofill match: ${MATCH_MODE_LABELS[mode]}`}
                    >
                      {MATCH_MODE_LABELS[mode]}
                    </span>
                  ) : null}
                  <CopyButton label={`Copy ${url}`} value={url} />
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {customFields.length > 0 ? (
        <div className={styles.section}>
          {customFields.map((field, index) => {
            const key = `${field.name}-${index}`;
            if (field.type === "hidden")
              return <RevealField key={key} label={field.name} value={field.value} />;
            if (field.type === "linked")
              return (
                <div key={key} className={styles.fieldGroup}>
                  <span className={styles.label}>{field.name}</span>
                  <span className={styles.valueMuted}>
                    Autofills the {field.linkedTo} into a form field named “{field.name}”.
                  </span>
                </div>
              );
            if (field.type === "boolean")
              return (
                <div key={key} className={styles.fieldGroup}>
                  <span className={styles.label}>{field.name}</span>
                  <span className={styles.value}>{field.value === "true" ? "On" : "Off"}</span>
                </div>
              );
            return (
              <div key={key} className={styles.fieldGroup}>
                <span className={styles.label}>{field.name}</span>
                <div className={styles.row}>
                  <span className={styles.rowValue}>{field.value || "—"}</span>
                  {field.value ? (
                    <CopyButton label={`Copy ${field.name}`} value={field.value} />
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {linkedOtp ? (
        <div className={styles.fieldGroup}>
          <span className={styles.label}>Linked authenticator entry</span>
          <div className={styles.linkedOtp}>
            <span className={styles.linkedOtpName}>{linkedOtp.issuer || linkedOtp.label}</span>
            {linkedOtp.otpType === "hotp" ? (
              <span className={styles.valueMuted}>
                Counter-based — open the entry to view a code
              </span>
            ) : code === null ? (
              <span className={styles.valueMuted}>Loading code…</span>
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
        </div>
      ) : null}

      {(item.passkeys ?? []).length > 0 ? (
        <div className={styles.fieldGroup}>
          <span className={styles.label}>Passkeys</span>
          <div className={styles.section}>
            {(item.passkeys ?? []).map((passkey) => (
              <div key={passkey.credentialId} className={styles.row}>
                <span className={styles.rowValue}>
                  <span className={styles.value}>{passkey.rpName ?? passkey.rpId}</span>{" "}
                  <span className={styles.valueMuted}>
                    {passkey.userName} · created {new Date(passkey.createdAt).toLocaleDateString()}
                    {passkey.lastUsedAt
                      ? ` · used ${new Date(passkey.lastUsedAt).toLocaleDateString()}`
                      : ""}
                  </span>
                </span>
                <button
                  type="button"
                  className={styles.link}
                  aria-label={`Remove passkey for ${passkey.rpId}`}
                  onClick={() => {
                    setPasskeyError("");
                    setPasskeyToRemove(passkey);
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          {passkeyToRemove !== null ? (
            <DeleteItemDialog
              itemName={passkeyToRemove.rpId}
              title="Remove passkey"
              description={
                <>
                  Remove the passkey for <strong>{passkeyToRemove.rpId}</strong>? Sites that only
                  accept this passkey will no longer sign you in with it.
                </>
              }
              confirmLabel="Remove passkey"
              submitting={removingPasskey}
              error={passkeyError}
              onCancel={() => {
                if (removingPasskey) return;
                setPasskeyToRemove(null);
                setPasskeyError("");
              }}
              onConfirm={() => void confirmRemovePasskey()}
            />
          ) : null}
        </div>
      ) : null}

      {item.notes ? (
        <div className={styles.fieldGroup}>
          <span className={styles.label}>Notes</span>
          <p className={styles.value}>{item.notes}</p>
        </div>
      ) : null}

      <DetailActions
        item={item}
        folders={folders}
        onUpdate={onUpdate}
        platform={platform}
        onEdit={() => setEditing(true)}
        onDeleted={onDeleted}
      />
    </div>
  );
}
