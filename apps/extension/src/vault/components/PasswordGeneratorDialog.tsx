import type { GeneratePasswordRequest } from "@shardpass/messaging";
import { GeneratePasswordResponseSchema } from "@shardpass/messaging";
import { Button, StatusBadge, type Status } from "@shardpass/ui";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { ExtensionPlatform } from "../../platform/extension-platform";
import { CopyButton } from "./detail/CopyButton";
import styles from "./PasswordGeneratorDialog.module.css";

export interface PasswordGeneratorDialogProps {
  platform: Pick<ExtensionPlatform, "sendMessage">;
  onUse: (password: string) => void;
  onClose: () => void;
}

type Mode = "random" | "passphrase";
type Separator = "hyphen" | "space" | "period" | "none";

const separatorOptions: readonly { value: Separator; label: string }[] = [
  { value: "hyphen", label: "Hyphen (-)" },
  { value: "space", label: "Space" },
  { value: "period", label: "Period (.)" },
  { value: "none", label: "None" },
];

function strengthStatus(entropyBits: number): Status {
  if (entropyBits >= 80) return "success";
  if (entropyBits >= 50) return "warning";
  return "error";
}

/**
 * A Random/Passphrase password generator dialog. Options mirror
 * GeneratePasswordRequestSchema; every option change (and every Regenerate click)
 * requests a fresh password from the background's password.generate handler — the
 * actual CSPRNG generation happens there, not in this UI.
 */
export function PasswordGeneratorDialog({ platform, onUse, onClose }: PasswordGeneratorDialogProps) {
  const [mode, setMode] = useState<Mode>("random");
  const [length, setLength] = useState(20);
  const [uppercase, setUppercase] = useState(true);
  const [lowercase, setLowercase] = useState(true);
  const [digits, setDigits] = useState(true);
  const [symbols, setSymbols] = useState(false);
  const [excludeAmbiguous, setExcludeAmbiguous] = useState(false);
  const [wordCount, setWordCount] = useState(4);
  const [separator, setSeparator] = useState<Separator>("hyphen");
  const [capitalize, setCapitalize] = useState(false);
  const [password, setPassword] = useState("");
  const [entropyBits, setEntropyBits] = useState(0);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const buildRequest = useCallback((): GeneratePasswordRequest => {
    return mode === "random"
      ? {
          version: 1,
          kind: "password.generate",
          mode,
          length,
          uppercase,
          lowercase,
          digits,
          symbols,
          excludeAmbiguous,
        }
      : { version: 1, kind: "password.generate", mode, wordCount, separator, capitalize };
  }, [
    mode,
    length,
    uppercase,
    lowercase,
    digits,
    symbols,
    excludeAmbiguous,
    wordCount,
    separator,
    capitalize,
  ]);

  const regenerate = useCallback(() => {
    const token = ++generation.current;
    setError("");
    platform.sendMessage(buildRequest()).then(
      (candidate) => {
        if (token !== generation.current) return;
        const parsed = GeneratePasswordResponseSchema.safeParse(candidate);
        if (parsed.success) {
          setPassword(parsed.data.password);
          setEntropyBits(parsed.data.entropyBits);
        } else {
          setError("Could not generate a password. Try again.");
        }
      },
      () => {
        if (token === generation.current) setError("Could not generate a password. Try again.");
      },
    );
  }, [buildRequest, platform]);

  useEffect(() => {
    regenerate();
  }, [regenerate]);

  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  const enabledClassCount = [uppercase, lowercase, digits, symbols].filter(Boolean).length;
  const toggleClass = (current: boolean, setValue: (value: boolean) => void) => {
    if (current && enabledClassCount <= 1) return;
    setValue(!current);
  };

  return createPortal(
    <div className={styles.backdrop}>
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-generator-heading"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <h3 id="password-generator-heading">Generate password</h3>

        <div className={styles.tabs} role="tablist" aria-label="Generator mode">
          <button
            type="button"
            role="tab"
            className={styles.tab}
            aria-selected={mode === "random"}
            onClick={() => setMode("random")}
          >
            Random
          </button>
          <button
            type="button"
            role="tab"
            className={styles.tab}
            aria-selected={mode === "passphrase"}
            onClick={() => setMode("passphrase")}
          >
            Passphrase
          </button>
        </div>

        <div className={styles.preview}>
          <span className={styles.previewValue}>{password || "—"}</span>
          <CopyButton label="Copy generated password" value={password} />
        </div>

        <div className={styles.entropyRow}>
          <StatusBadge status={strengthStatus(entropyBits)}>
            {Math.round(entropyBits)} bits of entropy
          </StatusBadge>
          <Button variant="ghost" onClick={regenerate}>
            <RefreshCw size={14} aria-hidden="true" /> Regenerate
          </Button>
        </div>

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

        <div className={styles.options}>
          {mode === "random" ? (
            <>
              <div className={styles.sliderRow}>
                <span className={styles.sliderLabel}>
                  <span>Length</span>
                  <span>{length}</span>
                </span>
                <input
                  type="range"
                  min={8}
                  max={128}
                  value={length}
                  onChange={(event) => setLength(Number(event.target.value))}
                  aria-label="Password length"
                />
              </div>
              <div className={styles.checkGrid}>
                <label className={styles.checkField}>
                  <input
                    type="checkbox"
                    checked={uppercase}
                    onChange={() => toggleClass(uppercase, setUppercase)}
                  />
                  Uppercase (A-Z)
                </label>
                <label className={styles.checkField}>
                  <input
                    type="checkbox"
                    checked={lowercase}
                    onChange={() => toggleClass(lowercase, setLowercase)}
                  />
                  Lowercase (a-z)
                </label>
                <label className={styles.checkField}>
                  <input type="checkbox" checked={digits} onChange={() => toggleClass(digits, setDigits)} />
                  Digits (0-9)
                </label>
                <label className={styles.checkField}>
                  <input
                    type="checkbox"
                    checked={symbols}
                    onChange={() => toggleClass(symbols, setSymbols)}
                  />
                  Symbols (!@#…)
                </label>
              </div>
              <label className={styles.checkField}>
                <input
                  type="checkbox"
                  checked={excludeAmbiguous}
                  onChange={(event) => setExcludeAmbiguous(event.target.checked)}
                />
                Exclude ambiguous characters (0, O, 1, l, I)
              </label>
            </>
          ) : (
            <>
              <div className={styles.sliderRow}>
                <span className={styles.sliderLabel}>
                  <span>Word count</span>
                  <span>{wordCount}</span>
                </span>
                <input
                  type="range"
                  min={3}
                  max={10}
                  value={wordCount}
                  onChange={(event) => setWordCount(Number(event.target.value))}
                  aria-label="Word count"
                />
              </div>
              <label className={styles.checkField} htmlFor="passphrase-separator">
                Separator
              </label>
              <select
                id="passphrase-separator"
                className={styles.select}
                value={separator}
                onChange={(event) => setSeparator(event.target.value as Separator)}
              >
                {separatorOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <label className={styles.checkField}>
                <input
                  type="checkbox"
                  checked={capitalize}
                  onChange={(event) => setCapitalize(event.target.checked)}
                />
                Capitalize each word
              </label>
            </>
          )}
        </div>

        <div className={styles.actions}>
          <Button ref={closeButtonRef} variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={password.length === 0}
            onClick={() => {
              onUse(password);
              onClose();
            }}
          >
            Use password
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
