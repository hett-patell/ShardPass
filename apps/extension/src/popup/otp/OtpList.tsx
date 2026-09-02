import type { OtpListItemProjection } from "@shardpass/messaging";
import { useEffect, useRef, useState } from "react";

import type { OtpUiExtensionPlatform } from "../../platform/extension-platform";
import { OtpRow } from "./OtpRow";
import styles from "./OtpList.module.css";
import { useOtpList } from "./useOtpList";

export interface OtpListProps {
  platform: OtpUiExtensionPlatform;
  active: boolean;
  now?: () => number;
}

const listError = "OTP items unavailable. Try again.";
const copyError = "Copy failed. Try again.";
const codeUnavailable = "Code unavailable. Try again.";

export function OtpList({ platform, active, now = Date.now }: OtpListProps) {
  const state = useOtpList(platform, active, now);
  const [feedback, setFeedback] = useState("");
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const copyingIdRef = useRef<string | null>(null);
  const copyToken = useRef(0);

  useEffect(() => {
    if (!active) {
      copyToken.current += 1;
      setFeedback("");
      copyingIdRef.current = null;
      setCopyingId(null);
    }
  }, [active]);

  const openVault = () => {
    void platform.openVaultPage().catch(() => undefined);
  };

  const copy = (item: OtpListItemProjection) => {
    const currentCode = state.status === "ready" ? state.codes.get(item.id) : undefined;
    if (
      copyingIdRef.current !== null ||
      item.otpType === "hotp" ||
      currentCode === undefined ||
      now() >= currentCode.expiresAt ||
      currentCode.revision !== item.revision
    ) {
      setFeedback(codeUnavailable);
      return;
    }
    copyingIdRef.current = item.id;
    const token = ++copyToken.current;
    setCopyingId(item.id);
    setFeedback("");
    let resolvePayload: (value: string) => void = () => undefined;
    let rejectPayload: (reason?: unknown) => void = () => undefined;
    const authoritativePayload = new Promise<string>((resolve, reject) => {
      resolvePayload = resolve;
      rejectPayload = reject;
    });
    void authoritativePayload.catch(() => undefined);
    const clipboardOperation = platform.writeAuthoritativeClipboardText(authoritativePayload);
    void platform
      .sendOtpMessage({
        version: 1,
        kind: "otp.copyCode",
        itemId: item.id,
        expectedRevision: item.revision,
      })
      .then((response) => {
        if (
          response.kind !== "otp.codeResult" ||
          response.itemId !== item.id ||
          response.revision !== item.revision ||
          now() >= response.expiresAt
        )
          throw new Error("authoritative code unavailable");
        resolvePayload(response.code);
      })
      .catch(rejectPayload);
    void clipboardOperation
      .then(() => {
        if (token === copyToken.current) setFeedback("Code copied");
      })
      .catch(() => {
        if (token === copyToken.current) setFeedback(copyError);
      })
      .finally(() => {
        if (token === copyToken.current) {
          copyingIdRef.current = null;
          setCopyingId(null);
        }
      });
  };

  if (!active || state.status === "locked") return null;

  return (
    <section className={styles.region} aria-labelledby="otp-list-heading">
      <header className={styles.heading}>
        <div>
          <p className={styles.kicker}>VAULT / OTP</p>
          <h2 id="otp-list-heading">One-time codes</h2>
        </div>
        {state.status === "ready" ? (
          <span className={styles.count}>{state.totalCount} ITEMS</span>
        ) : null}
      </header>

      {state.status === "loading" ? <p className={styles.state}>Loading OTP items…</p> : null}
      {state.status === "error" ? (
        <p className={styles.error} role="alert">
          {listError}
        </p>
      ) : null}
      {state.status === "ready" && state.items.length === 0 ? (
        <div className={styles.empty}>
          <strong>No OTP items yet</strong>
          <span>Add an item in the full vault.</span>
        </div>
      ) : null}
      {state.status === "ready" && state.items.length > 0 ? (
        <ul className={styles.list}>
          {state.items.map((item) => (
            <OtpRow
              key={item.id}
              item={item}
              code={state.codes.get(item.id)}
              time={state.time}
              copying={copyingId === item.id}
              onCopy={(selected) => void copy(selected)}
              onOpenVault={openVault}
            />
          ))}
        </ul>
      ) : null}
      {state.status === "ready" && state.totalCount > state.items.length ? (
        <p className={styles.remainingCount}>
          {(state.totalCount - state.items.length).toLocaleString("en-US")} MORE ITEMS
        </p>
      ) : null}
      <p className={styles.feedback} role="status" aria-live="polite">
        {feedback}
      </p>
    </section>
  );
}
