import type { LoginItem, OtpItem } from "@shardpass/domain";
import { useState } from "react";

import type { ExtensionPlatform } from "../../../platform/extension-platform";
import { LoginForm, MATCH_MODE_LABELS } from "../forms/LoginForm";
import { CopyButton } from "./CopyButton";
import styles from "./Detail.module.css";
import { DetailActions } from "./DetailActions";
import { RevealField } from "./RevealField";
import { useInlineTotp } from "./useInlineTotp";
import { useOtpLiveCode } from "./useOtpLiveCode";

export interface LoginDetailProps {
  item: LoginItem;
  platform: ExtensionPlatform;
  otpItems: readonly OtpItem[];
  onUpdate: () => void;
  onDeleted: () => void;
}

function normalizeUrl(url: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//iu.test(url) ? url : `https://${url}`;
}

function formatChangedAt(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

export function LoginDetail({ item, platform, otpItems, onUpdate, onDeleted }: LoginDetailProps) {
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const linkedOtp =
    item.linkedOtpId === undefined ? null : (otpItems.find((otp) => otp.id === item.linkedOtpId) ?? null);
  const liveCodeItemId = linkedOtp !== null && linkedOtp.otpType !== "hotp" ? linkedOtp.id : null;
  const { code, remaining } = useOtpLiveCode(platform, liveCodeItemId, liveCodeItemId !== null && !editing);
  const inline = useInlineTotp(item, !editing);

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
        <h2 className={styles.title}>{item.name}</h2>
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

      <RevealField label="Password" value={item.password} />

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
                    <span className={styles.badge} title={`Autofill match: ${MATCH_MODE_LABELS[mode]}`}>
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
            if (field.type === "hidden") return <RevealField key={key} label={field.name} value={field.value} />;
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
                  {field.value ? <CopyButton label={`Copy ${field.name}`} value={field.value} /> : null}
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
              <span className={styles.valueMuted}>Counter-based — open the entry to view a code</span>
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

      {item.notes ? (
        <div className={styles.fieldGroup}>
          <span className={styles.label}>Notes</span>
          <p className={styles.value}>{item.notes}</p>
        </div>
      ) : null}

      <DetailActions
        itemId={item.id}
        itemName={item.name}
        platform={platform}
        onEdit={() => setEditing(true)}
        onDeleted={onDeleted}
      />
    </div>
  );
}
