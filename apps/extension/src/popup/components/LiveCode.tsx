import type { ExtensionPlatform } from "../../platform/extension-platform";
import { useOtpCode } from "../hooks/useOtpCode";
import { OtpCountdown } from "../otp/OtpCountdown";
import styles from "./LiveCode.module.css";

export interface LiveCodeProps {
  platform: Pick<ExtensionPlatform, "sendOtpMessage">;
  itemId: string;
  size?: "row" | "display";
  now?: () => number;
  /** Called with the current code when the person activates it; undefined hides the button. */
  onCopy?: (code: string) => void;
}

/** The current one-time code with its countdown; the row size fits a list, display fits detail. */
export function LiveCode({ platform, itemId, size = "row", now = Date.now, onCopy }: LiveCodeProps) {
  const state = useOtpCode(platform, itemId, now);
  const large = size === "display";
  if (state.status === "hotp")
    return <span className={styles.hint}>Counter-based: use the vault</span>;
  if (state.status === "unavailable") return <span className={styles.hint}>Unavailable</span>;
  if (state.status === "loading")
    return (
      <span className={`${styles.code} ${large ? styles.large : ""} ${styles.placeholder}`} aria-hidden="true">
        {large ? "··· ···" : "······"}
      </span>
    );
  const code = state.code;
  const remaining = Math.max(0, Math.ceil((code.expiresAt - now()) / 1_000));
  const grouped = code.code.length === 6 ? `${code.code.slice(0, 3)} ${code.code.slice(3)}` : code.code;
  const body = (
    <>
      <span className={`${styles.code} ${large ? styles.large : ""}`}>{grouped}</span>
      <OtpCountdown remaining={remaining} period={code.period} urgentAt={6} />
    </>
  );
  return onCopy ? (
    <button
      type="button"
      className={`${styles.copy} ${large ? styles.copyLarge : ""}`}
      aria-label={`Copy code ${code.code}`}
      title="Copy code"
      onClick={() => onCopy(code.code)}
    >
      {body}
    </button>
  ) : (
    <span className={styles.static}>{body}</span>
  );
}
