import type { OtpCodeProjection, OtpListItemProjection } from "@shardpass/messaging";
import { Button } from "@shardpass/ui";

import { OtpCountdown } from "./OtpCountdown";
import styles from "./OtpList.module.css";

export interface OtpRowProps {
  item: OtpListItemProjection;
  code: OtpCodeProjection | undefined;
  time: number;
  copying: boolean;
  onCopy(item: OtpListItemProjection): void;
  onOpenVault(): void;
}

function displayName(item: OtpListItemProjection): string {
  return item.issuer || item.label;
}

export function OtpRow(props: OtpRowProps) {
  const { item, code, time, copying } = props;
  const name = displayName(item);
  const otpTypeLabel =
    item.otpType === "totp" ? "TOTP" : item.otpType === "hotp" ? "HOTP" : "STEAM";
  const remaining =
    code === undefined ? 0 : Math.max(0, Math.ceil((code.expiresAt - time) / 1_000));
  const period = code?.period ?? 30;

  return (
    <li className={styles.row} aria-label={`${name}, ${item.label}, ${otpTypeLabel} item`}>
      <span className={styles.marker} aria-hidden="true" />
      <div className={styles.identity}>
        <div className={styles.identityLine}>
          <strong>{name}</strong>
          <span className={styles.type}>{otpTypeLabel}</span>
        </div>
        {item.issuer ? <span className={styles.label}>{item.label}</span> : null}
        {item.tags.length > 0 ? <span className={styles.tags}>{item.tags.join(" · ")}</span> : null}
      </div>
      <div className={styles.codeArea}>
        {item.otpType === "hotp" ? (
          <span className={styles.hotpGuidance}>Available in full vault</span>
        ) : code === undefined ? (
          <span className={styles.codePlaceholder} aria-hidden="true">
            ——— ———
          </span>
        ) : (
          <>
            <span className={styles.code} aria-hidden="true">
              {code.code}
            </span>
            <OtpCountdown remaining={remaining} period={period} urgentAt={6} />
          </>
        )}
      </div>
      <div className={styles.actions}>
        {item.otpType === "hotp" ? null : (
          <Button
            className={styles.rowAction}
            variant="secondary"
            disabled={code === undefined || copying}
            onClick={() => props.onCopy(item)}
            aria-label={`Copy code for ${name}`}
          >
            Copy
          </Button>
        )}
        <Button
          className={styles.rowAction}
          variant="ghost"
          onClick={() => props.onOpenVault()}
          aria-label={item.otpType === "hotp" ? `Open ${name} in vault` : `Edit ${name} in vault`}
        >
          {item.otpType === "hotp" ? "Open" : "Edit"}
        </Button>
      </div>
    </li>
  );
}
