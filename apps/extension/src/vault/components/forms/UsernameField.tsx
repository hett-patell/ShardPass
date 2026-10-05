import { parseAliasResponseForRequest, PasswordGenResponseSchema } from "@shardpass/messaging";
import { IconButton } from "@shardpass/ui";
import { AtSign, Wand2 } from "lucide-react";
import { useEffect, useId, useState } from "react";

import type { ExtensionPlatform } from "../../../platform/extension-platform";
import styles from "./Form.module.css";

export interface UsernameFieldProps {
  value: string;
  error?: string | undefined;
  maxLength: number;
  onChange: (value: string) => void;
  /** The login's first website, so a suggestion can be made for that site. */
  site: string | undefined;
  /** Asks the background; without it the field is a plain input. */
  platform?: Pick<ExtensionPlatform, "sendMessage"> | undefined;
}

/** The host of a typed website, or undefined while it is not one yet. */
export function siteOf(url: string | undefined): string | undefined {
  if (url === undefined || url.trim() === "") return undefined;
  try {
    const parsed = new URL(
      /^[a-z][a-z0-9+.-]*:/iu.test(url.trim()) ? url.trim() : `https://${url.trim()}`,
    );
    return parsed.hostname === "" ? undefined : parsed.hostname;
  } catch {
    return undefined;
  }
}

/**
 * The username, with two ways to fill it in: a suggestion in the style the person set up in
 * the username generator (a plus-address on their e-mail, an address on their catch-all
 * domain, or two words and a number), and -- when DuckDuckGo is connected -- a new private
 * @duck.com address. Suggestions are made in the background, as everywhere else.
 */
export function UsernameField({
  value,
  error,
  maxLength,
  onChange,
  site,
  platform,
}: UsernameFieldProps) {
  const inputId = `username-field-${useId()}`;
  const errorId = error ? `${inputId}-error` : undefined;
  const [duck, setDuck] = useState(false);
  const [working, setWorking] = useState<"suggest" | "alias" | null>(null);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    if (platform === undefined) return;
    let live = true;
    const request = { version: 1 as const, kind: "alias.getStatus" as const };
    platform.sendMessage(request).then(
      (candidate) => {
        const parsed = parseAliasResponseForRequest(request, candidate);
        if (live && parsed.success && parsed.data.kind === "alias.status")
          setDuck(parsed.data.duckduckgo);
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [platform]);

  const suggest = async () => {
    if (platform === undefined) return;
    setWorking("suggest");
    setProblem("");
    try {
      const settings = PasswordGenResponseSchema.safeParse(
        await platform.sendMessage({ version: 1, kind: "password.getGeneratorSettings" }),
      );
      const saved =
        settings.success && settings.data.kind === "password.generatorSettings"
          ? settings.data
          : { email: "", domain: "" };
      const usernameKind = saved.email !== "" ? "plus" : saved.domain !== "" ? "catchall" : "word";
      const answer = PasswordGenResponseSchema.safeParse(
        await platform.sendMessage({
          version: 1,
          kind: "password.generateUsername",
          usernameKind,
          ...(site === undefined ? {} : { site }),
        }),
      );
      if (answer.success && answer.data.kind === "password.generateUsernameResult")
        onChange(answer.data.username);
      else setProblem("No username could be suggested. Try again.");
    } catch {
      setProblem("No username could be suggested. Try again.");
    } finally {
      setWorking(null);
    }
  };

  const alias = () => {
    if (platform === undefined) return;
    setWorking("alias");
    setProblem("");
    const request = {
      version: 1 as const,
      kind: "alias.generateDuck" as const,
      ...(site === undefined ? {} : { site }),
    };
    platform.sendMessage(request).then(
      (candidate) => {
        setWorking(null);
        const parsed = parseAliasResponseForRequest(request, candidate);
        if (parsed.success && parsed.data.kind === "alias.generated") onChange(parsed.data.address);
        else setProblem("DuckDuckGo did not make an address. Try again in a moment.");
      },
      () => {
        setWorking(null);
        setProblem("DuckDuckGo could not be reached. Try again.");
      },
    );
  };

  const problemId = problem ? `${inputId}-problem` : undefined;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={inputId}>
        Username
      </label>
      <div className={styles.row}>
        <input
          id={inputId}
          className={styles.textInput}
          value={value}
          maxLength={maxLength}
          autoComplete="username"
          spellCheck={false}
          aria-describedby={[errorId, problemId].filter(Boolean).join(" ") || undefined}
          aria-invalid={error ? true : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        {platform !== undefined ? (
          <IconButton
            aria-label="Suggest a username"
            title={site === undefined ? "Suggest a username" : `Suggest a username for ${site}`}
            disabled={working !== null}
            onClick={() => void suggest()}
          >
            <Wand2 size={16} />
          </IconButton>
        ) : null}
        {platform !== undefined && duck ? (
          <IconButton
            aria-label="Use a new @duck.com address"
            title="Make a private @duck.com address that forwards to your inbox"
            disabled={working !== null}
            onClick={alias}
          >
            <AtSign size={16} />
          </IconButton>
        ) : null}
      </div>
      {error ? (
        <p id={errorId} className={styles.fieldError} role="alert">
          {error}
        </p>
      ) : null}
      {problem ? (
        <p id={problemId} className={styles.fieldError} role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
