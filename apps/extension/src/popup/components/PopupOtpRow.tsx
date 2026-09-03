import type { ItemListItemProjection, OtpCodeProjection } from "@shardpass/messaging";
import { ItemRow } from "@shardpass/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ExtensionPlatform } from "../../platform/extension-platform";
import { OtpCountdown } from "../otp/OtpCountdown";
import { scheduleClipboardClear } from "../../vault/components/detail/clipboard";
import styles from "./PopupOtpRow.module.css";

export interface PopupOtpRowProps {
  item: ItemListItemProjection;
  now?: () => number;
  onFeedback: (message: string) => void;
  platform: Pick<
    ExtensionPlatform,
    "openVaultPage" | "sendOtpMessage" | "writeAuthoritativeClipboardText"
  >;
}

type CodeState =
  | { status: "loading" }
  | { status: "hotp" }
  | { status: "unavailable" }
  | { status: "ready"; code: OtpCodeProjection };

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const value = (error as { code?: unknown }).code;
  return typeof value === "string" ? value : undefined;
}

export function PopupOtpRow({ item, now = Date.now, onFeedback, platform }: PopupOtpRowProps) {
  const [state, setState] = useState<CodeState>({ status: "loading" });
  const [copying, setCopying] = useState(false);
  const mounted = useRef(true);
  const generation = useRef(0);

  const fetchCode = useCallback(() => {
    const token = ++generation.current;
    void platform.sendOtpMessage({ version: 1, kind: "otp.getCode", itemId: item.id }).then(
      (response) => {
        if (!mounted.current || generation.current !== token) return;
        if (response.kind === "otp.codeResult") setState({ status: "ready", code: response });
        else setState({ status: "unavailable" });
      },
      (error: unknown) => {
        if (!mounted.current || generation.current !== token) return;
        setState({ status: errorCode(error) === "OTP_HOTP_REQUIRED" ? "hotp" : "unavailable" });
      },
    );
  }, [item.id, platform]);

  useEffect(() => {
    mounted.current = true;
    fetchCode();
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [fetchCode]);

  useEffect(() => {
    if (state.status !== "ready") return;
    const delay = Math.max(250, state.code.expiresAt - now());
    const timer = setTimeout(fetchCode, delay);
    return () => clearTimeout(timer);
  }, [fetchCode, now, state]);

  function openVault(): void {
    void platform.openVaultPage().catch(() => undefined);
  }

  function copy(): void {
    if (state.status !== "ready" || copying) return;
    const currentCode = state.code;
    if (now() >= currentCode.expiresAt || currentCode.revision !== item.revision) {
      onFeedback("Code unavailable. Try again.");
      return;
    }
    setCopying(true);
    let resolvePayload: (value: string) => void = () => undefined;
    let rejectPayload: (reason?: unknown) => void = () => undefined;
    const authoritativePayload = new Promise<string>((resolve, reject) => {
      resolvePayload = resolve;
      rejectPayload = reject;
    });
    void authoritativePayload.catch(() => undefined);
    const clipboardOperation = platform
      .writeAuthoritativeClipboardText(authoritativePayload)
      // A one-time code is stale within a minute anyway; do not leave it on the clipboard.
      .then(() => scheduleClipboardClear());
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
      .then(() => onFeedback("Code copied"))
      .catch(() => onFeedback("Copy failed. Try again."))
      .finally(() => setCopying(false));
  }

  const rightContent =
    state.status === "ready" ? (
      <span className={styles.codeArea}>
        <span className={styles.code}>{state.code.code}</span>
        <OtpCountdown
          remaining={Math.max(0, Math.ceil((state.code.expiresAt - now()) / 1_000))}
          period={state.code.period}
          urgentAt={6}
        />
      </span>
    ) : state.status === "hotp" ? (
      <span className={styles.hint}>Vault only</span>
    ) : state.status === "unavailable" ? (
      <span className={styles.hint}>Unavailable</span>
    ) : (
      <span className={styles.codePlaceholder} aria-hidden="true">
        ——— ———
      </span>
    );

  return (
    <ItemRow
      kind="otp"
      name={item.name}
      {...(item.subtitle === undefined ? {} : { subtitle: item.subtitle })}
      rightContent={rightContent}
      onClick={state.status === "ready" ? copy : openVault}
    />
  );
}
