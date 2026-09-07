import type { GeneratePasswordRequest } from "@shardpass/messaging";
import { GeneratePasswordResponseSchema } from "@shardpass/messaging";
import { Button, StatusBadge, type Status } from "@shardpass/ui";
import { Copy, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ExtensionPlatform } from "../../platform/extension-platform";
import styles from "./GeneratorScreen.module.css";

export interface GeneratorScreenProps {
  platform: Pick<ExtensionPlatform, "sendMessage">;
  onCopy: (value: string, label: string) => void;
}

type Mode = "random" | "passphrase";
type Separator = "hyphen" | "space" | "period" | "none";

const separatorOptions: readonly { value: Separator; label: string }[] = [
  { value: "hyphen", label: "Hyphen (-)" },
  { value: "space", label: "Space" },
  { value: "period", label: "Period (.)" },
  { value: "none", label: "None" },
];

function strength(entropyBits: number): { status: Status; word: string } {
  if (entropyBits >= 80) return { status: "success", word: "Strong" };
  if (entropyBits >= 50) return { status: "warning", word: "Fair" };
  return { status: "error", word: "Weak" };
}

/**
 * The popup's password generator: the same options as the vault dialog, laid out as a
 * screen, with Copy as the main action because that is what the popup is for -- a sign-up
 * form is open in the tab behind it. Generation itself happens in the background (CSPRNG).
 */
export function GeneratorScreen({ platform, onCopy }: GeneratorScreenProps) {
  const [mode, setMode] = useState<Mode>("random");
  const [length, setLength] = useState(20);
  const [uppercase, setUppercase] = useState(true);
  const [lowercase, setLowercase] = useState(true);
  const [digits, setDigits] = useState(true);
  const [symbols, setSymbols] = useState(true);
  const [excludeAmbiguous, setExcludeAmbiguous] = useState(false);
  const [wordCount, setWordCount] = useState(4);
  const [separator, setSeparator] = useState<Separator>("hyphen");
  const [capitalize, setCapitalize] = useState(false);
  const [password, setPassword] = useState("");
  const [entropyBits, setEntropyBits] = useState(0);
  const [error, setError] = useState("");
  const generation = useRef(0);

  const buildRequest = useCallback((): GeneratePasswordRequest => {
    return mode === "random"
      ? { version: 1, kind: "password.generate", mode, length, uppercase, lowercase, digits, symbols, excludeAmbiguous }
      : { version: 1, kind: "password.generate", mode, wordCount, separator, capitalize };
  }, [mode, length, uppercase, lowercase, digits, symbols, excludeAmbiguous, wordCount, separator, capitalize]);

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
        } else setError("Could not generate a password. Try again.");
      },
      () => {
        if (token === generation.current) setError("Could not generate a password. Try again.");
      },
    );
  }, [buildRequest, platform]);

  useEffect(() => {
    regenerate();
    return () => {
      generation.current += 1;
    };
  }, [regenerate]);

  const enabledClassCount = [uppercase, lowercase, digits, symbols].filter(Boolean).length;
  const toggleClass = (current: boolean, setValue: (value: boolean) => void) => {
    if (current && enabledClassCount <= 1) return;
    setValue(!current);
  };
  const grade = strength(entropyBits);

  return (
    <div className={styles.screen}>
      <div className={styles.tabs} role="tablist" aria-label="Generator mode">
        <button type="button" role="tab" className={styles.tab} aria-selected={mode === "random"} onClick={() => setMode("random")}>
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

      <output className={styles.preview} aria-label="Generated password" aria-live="polite">
        {password || "\u2026"}
      </output>

      <div className={styles.meta}>
        <StatusBadge status={grade.status}>{password ? grade.word : "Generating"}</StatusBadge>
        <span>{password ? `${Math.round(entropyBits)} bits of entropy` : ""}</span>
      </div>

      <div className={styles.actions}>
        <Button disabled={password.length === 0} onClick={() => onCopy(password, "Password")}>
          <Copy size={14} aria-hidden="true" /> Copy
        </Button>
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
            <label className={styles.sliderRow}>
              <span className={styles.sliderLabel}>
                <span>Length</span>
                <span>{length}</span>
              </span>
              <input type="range" min={8} max={64} value={length} onChange={(event) => setLength(Number(event.target.value))} />
            </label>
            <div className={styles.checkGrid}>
              <label className={styles.checkField}>
                <input type="checkbox" checked={uppercase} onChange={() => toggleClass(uppercase, setUppercase)} />
                Uppercase
              </label>
              <label className={styles.checkField}>
                <input type="checkbox" checked={lowercase} onChange={() => toggleClass(lowercase, setLowercase)} />
                Lowercase
              </label>
              <label className={styles.checkField}>
                <input type="checkbox" checked={digits} onChange={() => toggleClass(digits, setDigits)} />
                Digits
              </label>
              <label className={styles.checkField}>
                <input type="checkbox" checked={symbols} onChange={() => toggleClass(symbols, setSymbols)} />
                Symbols
              </label>
            </div>
            <label className={styles.checkField}>
              <input type="checkbox" checked={excludeAmbiguous} onChange={(event) => setExcludeAmbiguous(event.target.checked)} />
              Avoid look-alikes (0 O 1 l I)
            </label>
          </>
        ) : (
          <>
            <label className={styles.sliderRow}>
              <span className={styles.sliderLabel}>
                <span>Words</span>
                <span>{wordCount}</span>
              </span>
              <input type="range" min={3} max={10} value={wordCount} onChange={(event) => setWordCount(Number(event.target.value))} />
            </label>
            <label className={styles.selectRow}>
              <span>Separator</span>
              <select className={styles.select} value={separator} onChange={(event) => setSeparator(event.target.value as Separator)}>
                {separatorOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.checkField}>
              <input type="checkbox" checked={capitalize} onChange={(event) => setCapitalize(event.target.checked)} />
              Capitalize each word
            </label>
          </>
        )}
      </div>
    </div>
  );
}
