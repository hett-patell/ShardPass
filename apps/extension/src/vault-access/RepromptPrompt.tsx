import { Button, PasswordInput } from "@shardpass/ui";
import { useState } from "react";

import type { ExtensionPlatform } from "../platform/extension-platform";
import { confirmReprompt, type RepromptOutcome } from "./reprompt";
import styles from "./RepromptPrompt.module.css";
import type { DerivePageKey } from "./VaultAccess";

export interface RepromptPromptProps {
  platform: Pick<ExtensionPlatform, "sendMessage">;
  itemId: string;
  /** What the person was about to do, for the heading: "view", "copy", "fill", "edit". */
  action?: string;
  onGranted: () => void;
  onCancel?: () => void;
  deriveKey?: DerivePageKey;
}

const MESSAGES: Record<Exclude<RepromptOutcome, "granted">, string> = {
  wrong: "That is not your master password.",
  throttled: "Too many attempts. Wait a moment, then try again.",
  failed: "Could not check the password. Try again.",
};

/** The master password, asked for again before one item is used; the vault stays open. */
export function RepromptPrompt({
  platform,
  itemId,
  action = "use",
  onGranted,
  onCancel,
  deriveKey,
}: RepromptPromptProps) {
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (password === "" || working) return;
    setWorking(true);
    setError("");
    const outcome = await confirmReprompt(platform, password, itemId, deriveKey);
    setWorking(false);
    if (outcome === "granted") {
      setPassword("");
      onGranted();
      return;
    }
    setError(MESSAGES[outcome]);
  };

  return (
    <form
      className={styles.prompt}
      aria-labelledby="reprompt-heading"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h3 id="reprompt-heading" className={styles.heading}>
        Master password needed
      </h3>
      <p className={styles.copy}>This item asks for your master password before you {action} it.</p>
      <label className={styles.field}>
        Master password
        <PasswordInput
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      {error !== "" ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.actions}>
        {onCancel !== undefined ? (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={working}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" loading={working} disabled={password === ""}>
          Continue
        </Button>
      </div>
    </form>
  );
}
