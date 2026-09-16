import type { PasswordGenRequest } from "@shardpass/messaging";
import { PasswordGenResponseSchema } from "@shardpass/messaging";
import { Button, StatusBadge, type Status } from "@shardpass/ui";
import { Copy, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ExtensionPlatform } from "../../platform/extension-platform";
import styles from "./GeneratorScreen.module.css";

export interface GeneratorScreenProps {
  platform: Pick<ExtensionPlatform, "sendMessage">;
  onCopy: (value: string, label: string) => void;
  /** Which tab opens first; "random" when not given. */
  initialMode?: GeneratorMode;
}

export type GeneratorMode = "random" | "passphrase" | "username";
type Mode = GeneratorMode;
type UsernameKind = "word" | "random" | "plus" | "catchall";
const usernameKindOptions: readonly { value: UsernameKind; label: string }[] = [
  { value: "word", label: "Two words and a number" },
  { value: "random", label: "Random letters" },
  { value: "plus", label: "Plus-address on my e-mail" },
  { value: "catchall", label: "Address on my catch-all domain" },
];
type Separator = "hyphen" | "space" | "period" | "none";

const GENERATE_SETTLE_MS = 120;

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
export function GeneratorScreen({
  platform,
  onCopy,
  initialMode = "random",
}: GeneratorScreenProps) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [length, setLength] = useState(20);
  const [uppercase, setUppercase] = useState(true);
  const [lowercase, setLowercase] = useState(true);
  const [digits, setDigits] = useState(true);
  const [symbols, setSymbols] = useState(true);
  const [excludeAmbiguous, setExcludeAmbiguous] = useState(false);
  const [wordCount, setWordCount] = useState(4);
  const [separator, setSeparator] = useState<Separator>("hyphen");
  const [capitalize, setCapitalize] = useState(false);
  const [usernameKind, setUsernameKind] = useState<UsernameKind>("word");
  const [email, setEmail] = useState("");
  const [domain, setDomain] = useState("");
  const [password, setPassword] = useState("");
  const [entropyBits, setEntropyBits] = useState(0);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const settingsLoaded = useRef(false);
  // Fields already typed into: a saved value that arrives later must not replace what was written.
  const edited = useRef({ email: false, domain: false });

  // The saved address and domain are fetched once, the first time the username tab opens.
  useEffect(() => {
    if (mode !== "username" || settingsLoaded.current) return;
    settingsLoaded.current = true;
    platform
      .sendMessage({ version: 1, kind: "password.getGeneratorSettings" })
      .then((candidate) => {
        const parsed = PasswordGenResponseSchema.safeParse(candidate);
        if (parsed.success && parsed.data.kind === "password.generatorSettings") {
          if (!edited.current.email) setEmail(parsed.data.email);
          if (!edited.current.domain) setDomain(parsed.data.domain);
        }
      })
      .catch(() => undefined);
  }, [mode, platform]);

  const saveSettings = useCallback(
    (next: { email: string; domain: string }) => {
      platform
        .sendMessage({ version: 1, kind: "password.setGeneratorSettings", ...next })
        .catch(() => undefined);
    },
    [platform],
  );

  const usernameNeeds =
    mode === "username" && usernameKind === "plus" && email.trim() === ""
      ? "Enter the e-mail address the plus-addresses should build on."
      : mode === "username" && usernameKind === "catchall" && domain.trim() === ""
        ? "Enter the domain that catches all addresses."
        : "";

  const buildRequest = useCallback((): PasswordGenRequest => {
    if (mode === "username")
      return {
        version: 1,
        kind: "password.generateUsername",
        usernameKind,
        ...(email.trim() === "" ? {} : { email: email.trim() }),
        ...(domain.trim() === "" ? {} : { domain: domain.trim() }),
      };
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
    usernameKind,
    email,
    domain,
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
    if (usernameNeeds !== "") {
      setPassword("");
      setEntropyBits(0);
      return;
    }
    const what = mode === "username" ? "a username" : "a password";
    platform.sendMessage(buildRequest()).then(
      (candidate) => {
        if (token !== generation.current) return;
        const parsed = PasswordGenResponseSchema.safeParse(candidate);
        if (parsed.success && parsed.data.kind === "password.generateResult") {
          setPassword(parsed.data.password);
          setEntropyBits(parsed.data.entropyBits);
        } else if (parsed.success && parsed.data.kind === "password.generateUsernameResult") {
          setPassword(parsed.data.username);
          setEntropyBits(parsed.data.entropyBits);
        } else setError(`Could not generate ${what}. Try again.`);
      },
      () => {
        if (token === generation.current) setError(`Could not generate ${what}. Try again.`);
      },
    );
  }, [buildRequest, mode, platform, usernameNeeds]);

  // Options settle first: a slider drag would otherwise flicker through dozens of
  // passwords and send a request per pixel.
  useEffect(() => {
    const timer = setTimeout(regenerate, GENERATE_SETTLE_MS);
    return () => {
      clearTimeout(timer);
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
        <button
          type="button"
          role="tab"
          className={styles.tab}
          aria-selected={mode === "username"}
          onClick={() => setMode("username")}
        >
          Username
        </button>
      </div>

      <output
        className={styles.preview}
        aria-label={mode === "username" ? "Generated username" : "Generated password"}
        aria-live="polite"
      >
        {password === ""
          ? usernameNeeds !== ""
            ? ""
            : "\u2026"
          : Array.from(password).map((character, index) => (
              <span
                // The character is the text, as before; only its class is in the markup, so
                // nothing about the value lands in an attribute.
                key={`${String(index)}:${character}`}
                className={
                  /[0-9]/u.test(character)
                    ? styles.digit
                    : /[\p{L}]/u.test(character)
                      ? styles.letter
                      : styles.symbol
                }
              >
                {character}
              </span>
            ))}
      </output>

      <div className={styles.meta}>
        {mode === "username" ? (
          <span>{password ? `${Math.round(entropyBits)} bits of entropy` : usernameNeeds}</span>
        ) : (
          <>
            <StatusBadge status={grade.status}>{password ? grade.word : "Generating"}</StatusBadge>
            <span>{password ? `${Math.round(entropyBits)} bits of entropy` : ""}</span>
          </>
        )}
      </div>

      <div className={styles.actions}>
        <Button
          disabled={password.length === 0}
          onClick={() => onCopy(password, mode === "username" ? "Username" : "Password")}
        >
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
        {mode === "username" ? (
          <>
            <label className={styles.selectRow}>
              <span>Kind</span>
              <select
                className={styles.select}
                value={usernameKind}
                onChange={(event) => setUsernameKind(event.target.value as UsernameKind)}
              >
                {usernameKindOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {usernameKind === "plus" ? (
              <label className={styles.selectRow}>
                <span>My e-mail</span>
                <input
                  className={styles.select}
                  type="email"
                  autoComplete="off"
                  placeholder="me@example.com"
                  value={email}
                  onChange={(event) => {
                    edited.current.email = true;
                    setEmail(event.target.value);
                  }}
                  onBlur={() => saveSettings({ email: email.trim(), domain: domain.trim() })}
                />
              </label>
            ) : null}
            {usernameKind === "catchall" ? (
              <label className={styles.selectRow}>
                <span>My domain</span>
                <input
                  className={styles.select}
                  type="text"
                  autoComplete="off"
                  placeholder="example.com"
                  value={domain}
                  onChange={(event) => {
                    edited.current.domain = true;
                    setDomain(event.target.value);
                  }}
                  onBlur={() => saveSettings({ email: email.trim(), domain: domain.trim() })}
                />
              </label>
            ) : null}
            <p className={styles.hint}>
              {usernameKind === "plus"
                ? "Mail to me+tag@… lands in your inbox; each site gets its own tag, so you can see who shared your address."
                : usernameKind === "catchall"
                  ? "Needs a domain whose mail all reaches you. Each site gets a fresh address."
                  : "Sign-up forms offer one of these when you pick the username field."}
            </p>
          </>
        ) : mode === "random" ? (
          <>
            <label className={styles.sliderRow}>
              <span className={styles.sliderLabel}>
                <span>Length</span>
                <span>{length}</span>
              </span>
              <input
                type="range"
                min={8}
                max={64}
                value={length}
                onChange={(event) => setLength(Number(event.target.value))}
              />
            </label>
            <div className={styles.checkGrid}>
              <label className={styles.checkField}>
                <input
                  type="checkbox"
                  checked={uppercase}
                  onChange={() => toggleClass(uppercase, setUppercase)}
                />
                Uppercase
              </label>
              <label className={styles.checkField}>
                <input
                  type="checkbox"
                  checked={lowercase}
                  onChange={() => toggleClass(lowercase, setLowercase)}
                />
                Lowercase
              </label>
              <label className={styles.checkField}>
                <input
                  type="checkbox"
                  checked={digits}
                  onChange={() => toggleClass(digits, setDigits)}
                />
                Digits
              </label>
              <label className={styles.checkField}>
                <input
                  type="checkbox"
                  checked={symbols}
                  onChange={() => toggleClass(symbols, setSymbols)}
                />
                Symbols
              </label>
            </div>
            <label className={styles.checkField}>
              <input
                type="checkbox"
                checked={excludeAmbiguous}
                onChange={(event) => setExcludeAmbiguous(event.target.checked)}
              />
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
              <input
                type="range"
                min={3}
                max={10}
                value={wordCount}
                onChange={(event) => setWordCount(Number(event.target.value))}
              />
            </label>
            <label className={styles.selectRow}>
              <span>Separator</span>
              <select
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
            </label>
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
    </div>
  );
}
