import { parseSecurityResponseForRequest } from "@shardpass/messaging";
import { useEffect, useState } from "react";

import type { ExtensionPlatform } from "../../platform/extension-platform";
import styles from "../VaultApp.module.css";

export interface BreachCheckSettingsProps {
  platform: Pick<ExtensionPlatform, "sendMessage">;
  /** The settings view is on screen; the preference is read the first time it is. */
  active: boolean;
}

/** The one network feature the vault has, off until asked for, with what it sends spelled out. */
export function BreachCheckSettings({ platform, active }: BreachCheckSettingsProps) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!active || enabled !== null) return;
    let mounted = true;
    const request = { version: 1 as const, kind: "security.getSettings" as const };
    platform.sendMessage(request).then(
      (candidate) => {
        if (!mounted) return;
        const parsed = parseSecurityResponseForRequest(request, candidate);
        setEnabled(
          parsed.success && parsed.data.kind === "security.settings"
            ? parsed.data.breachChecks
            : false,
        );
      },
      () => {
        if (mounted) setEnabled(false);
      },
    );
    return () => {
      mounted = false;
    };
  }, [active, enabled, platform]);

  const toggle = (next: boolean) => {
    setError("");
    setEnabled(next);
    const request = {
      version: 1 as const,
      kind: "security.setBreachChecks" as const,
      enabled: next,
    };
    platform.sendMessage(request).then(
      (candidate) => {
        const parsed = parseSecurityResponseForRequest(request, candidate);
        if (!parsed.success || parsed.data.kind !== "security.settings") {
          setEnabled(!next);
          setError("Could not save this setting. Try again.");
        }
      },
      () => {
        setEnabled(!next);
        setError("Could not save this setting. Try again.");
      },
    );
  };

  return (
    <section className={styles.settingsCard} aria-labelledby="breach-check-heading">
      <h3 id="breach-check-heading" className={styles.settingsCardTitle}>
        Breach checks
      </h3>
      <p className={styles.settingsCardCopy}>
        Checks a password against Have I Been Pwned when you ask. Only the first five characters of
        the password&apos;s hash are sent; the password itself never leaves this device.
      </p>
      <label className={styles.settingsToggle}>
        <input
          type="checkbox"
          checked={enabled === true}
          disabled={enabled === null}
          onChange={(event) => toggle(event.target.checked)}
        />
        Allow breach checks
      </label>
      {error !== "" ? (
        <p className={styles.settingsError} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
