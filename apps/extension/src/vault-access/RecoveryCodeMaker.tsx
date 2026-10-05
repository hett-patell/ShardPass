import { DEFAULT_ARGON2ID_PARAMETERS } from "@shardpass/crypto";
import { Button } from "@shardpass/ui";
import { Copy, Download, Printer } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ExtensionPlatform } from "../platform/extension-platform";
import { copyWithAutoClear } from "../vault/components/detail/clipboard";
import { encodeBase64 } from "./key-transport";
import { formatRecoveryCode, generateRecoveryCode } from "./recovery-code";
import styles from "./RecoveryCodeMaker.module.css";
import type { DerivePageKey } from "./VaultAccess";

export interface RecoveryCodeMakerProps {
  platform: Pick<ExtensionPlatform, "sendMessage">;
  deriveKey: DerivePageKey;
  /** A code is already set: the button replaces it, and says so. */
  replacing?: boolean;
  /** The new code is saved in the vault and the person has said they stored it. */
  onDone: () => void;
  /** Shown beside the main button: "Not now" during setup, nothing in Settings. */
  onSkip?: () => void;
}

function today(): string {
  return new Date().toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Makes a recovery code and shows it exactly once. The code is generated on this page and
 * only a key derived from it reaches the background, which wraps the vault's data key under
 * that key. Leaving this screen is the last time the code exists anywhere ShardPass can see.
 */
export function RecoveryCodeMaker({
  platform,
  deriveKey,
  replacing = false,
  onDone,
  onSkip,
}: RecoveryCodeMakerProps) {
  const [code, setCode] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [stored, setStored] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const shown = useRef<HTMLDivElement>(null);

  // The download link holds the code; it goes when the code does.
  useEffect(
    () => () => {
      if (downloadUrl !== null) URL.revokeObjectURL(downloadUrl);
    },
    [downloadUrl],
  );

  const make = async () => {
    setWorking(true);
    setError("");
    const fresh = generateRecoveryCode();
    let key: Uint8Array | null = null;
    try {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      key = await deriveKey(fresh, DEFAULT_ARGON2ID_PARAMETERS, salt);
      const response = (await platform.sendMessage({
        version: 1,
        kind: "vault.setRecovery",
        recoveryKey: encodeBase64(key),
        kdf: { ...DEFAULT_ARGON2ID_PARAMETERS, salt: encodeBase64(salt) },
      })) as { kind?: unknown; state?: unknown } | undefined;
      if (response?.kind === "vault.ok" && response.state === "unlocked") {
        setCode(fresh);
        const text =
          `ShardPass recovery code\n\n${formatRecoveryCode(fresh)}\n\n` +
          `Made on ${today()}. With this code and this browser profile, the vault can be ` +
          `opened and given a new master password. Keep it somewhere only you can reach.\n`;
        setDownloadUrl(URL.createObjectURL(new Blob([text], { type: "text/plain" })));
        requestAnimationFrame(() => shown.current?.focus());
      } else setError("The recovery code could not be saved. Try again.");
    } catch {
      setError("The recovery code could not be saved. Try again.");
    } finally {
      key?.fill(0);
      setWorking(false);
    }
  };

  if (code === null)
    return (
      <div className={styles.maker}>
        {error !== "" ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <div className={styles.actions}>
          <Button onClick={() => void make()} loading={working}>
            {replacing ? "Make a new recovery code" : "Make a recovery code"}
          </Button>
          {onSkip !== undefined ? (
            <Button variant="ghost" onClick={onSkip} disabled={working}>
              Not now
            </Button>
          ) : null}
        </div>
        {replacing ? (
          <p className={styles.note}>
            The code you have now stops working once the new one is made.
          </p>
        ) : null}
      </div>
    );

  return (
    <div className={styles.maker}>
      <div className={styles.sheet} ref={shown} tabIndex={-1} aria-label="Your recovery code">
        <p className={styles.sheetTitle}>ShardPass recovery code</p>
        <p className={styles.code}>{formatRecoveryCode(code)}</p>
        <p className={styles.sheetNote}>
          Made on {today()}. With this code and this browser profile, the vault can be opened and
          given a new master password.
        </p>
      </div>
      <p className={styles.note}>
        This is the only time it is shown. Write it down, print it, or save the file somewhere only
        you can reach, not in this vault.
      </p>
      <div className={styles.actions}>
        <Button
          variant="secondary"
          onClick={() =>
            void copyWithAutoClear(formatRecoveryCode(code)).then(
              () => setCopied(true),
              () => setError("Copying is not allowed here. Write the code down instead."),
            )
          }
        >
          <Copy size={14} aria-hidden="true" />
          {copied ? "Copied" : "Copy"}
        </Button>
        {downloadUrl !== null ? (
          <a className={styles.download} href={downloadUrl} download="shardpass-recovery-code.txt">
            <Download size={14} aria-hidden="true" />
            Save as a file
          </a>
        ) : null}
        <Button variant="secondary" onClick={() => window.print()}>
          <Printer size={14} aria-hidden="true" />
          Print
        </Button>
      </div>
      {error !== "" ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <label className={styles.confirm}>
        <input
          type="checkbox"
          checked={stored}
          onChange={(event) => setStored(event.target.checked)}
        />
        I have stored this code somewhere safe
      </label>
      <Button
        disabled={!stored}
        onClick={() => {
          setCode(null);
          onDone();
        }}
      >
        Done
      </Button>
    </div>
  );
}
