import type { LoginItem, OtpItem } from "@shardpass/domain";
import { useState } from "react";

import type { ExtensionPlatform } from "../../../platform/extension-platform";
import { LoginForm } from "../forms/LoginForm";
import { CopyButton } from "./CopyButton";
import styles from "./Detail.module.css";
import { DetailActions } from "./DetailActions";
import { RevealField } from "./RevealField";
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

export function LoginDetail({ item, platform, otpItems, onUpdate, onDeleted }: LoginDetailProps) {
  const [editing, setEditing] = useState(false);
  const linkedOtp =
    item.linkedOtpId === undefined ? null : (otpItems.find((otp) => otp.id === item.linkedOtpId) ?? null);
  const liveCodeItemId = linkedOtp !== null && linkedOtp.otpType !== "hotp" ? linkedOtp.id : null;
  const { code, remaining } = useOtpLiveCode(platform, liveCodeItemId, liveCodeItemId !== null && !editing);

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

  return (
    <div className={styles.detail}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>LOGIN</p>
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

      {item.urls.length > 0 ? (
        <div className={styles.fieldGroup}>
          <span className={styles.label}>{item.urls.length > 1 ? "URLs" : "URL"}</span>
          <div className={styles.linkList}>
            {item.urls.map((url) => (
              <div key={url} className={styles.row}>
                <a
                  className={`${styles.rowValue} ${styles.link}`}
                  href={normalizeUrl(url)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {url}
                </a>
                <CopyButton label={`Copy ${url}`} value={url} />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {linkedOtp ? (
        <div className={styles.fieldGroup}>
          <span className={styles.label}>Linked OTP</span>
          <div className={styles.linkedOtp}>
            <span className={styles.linkedOtpName}>{linkedOtp.issuer || linkedOtp.label}</span>
            {linkedOtp.otpType === "hotp" ? (
              <span className={styles.valueMuted}>HOTP — open the OTP item to view</span>
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
