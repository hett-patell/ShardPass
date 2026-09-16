import { parseAliasResponseForRequest } from "@shardpass/messaging";
import { Button, PasswordInput } from "@shardpass/ui";
import { useEffect, useState } from "react";

import type { ExtensionPlatform } from "../../platform/extension-platform";
import { CopyButton } from "../components/detail/CopyButton";
import detailStyles from "../components/detail/Detail.module.css";
import styles from "../VaultApp.module.css";

export interface EmailAliasViewProps {
  platform: Pick<ExtensionPlatform, "sendMessage">;
  /** The view is on screen; the status is read the first time it is. */
  active: boolean;
}

function errorText(candidate: unknown, fallback: string): string {
  const message = (candidate as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof message === "string" && message !== "" ? message : fallback;
}

/**
 * DuckDuckGo Email Protection: a private @duck.com address per site, forwarded to the
 * person's inbox with trackers removed. The token is sealed under the vault key.
 */
export function EmailAliasView({ platform, active }: EmailAliasViewProps) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [addresses, setAddresses] = useState<string[]>([]);

  useEffect(() => {
    if (!active || connected !== null) return;
    let mounted = true;
    const request = { version: 1 as const, kind: "alias.getStatus" as const };
    platform.sendMessage(request).then(
      (candidate) => {
        if (!mounted) return;
        const parsed = parseAliasResponseForRequest(request, candidate);
        setConnected(
          parsed.success && parsed.data.kind === "alias.status" ? parsed.data.duckduckgo : false,
        );
      },
      () => {
        if (mounted) setConnected(false);
      },
    );
    return () => {
      mounted = false;
    };
  }, [active, connected, platform]);

  const connect = async () => {
    const trimmed = token.trim();
    if (trimmed === "") {
      setError("Paste the token first.");
      return;
    }
    setBusy(true);
    setError("");
    const request = { version: 1 as const, kind: "alias.setDuckToken" as const, token: trimmed };
    try {
      const candidate = await platform.sendMessage(request);
      const parsed = parseAliasResponseForRequest(request, candidate);
      if (parsed.success && parsed.data.kind === "alias.status" && parsed.data.duckduckgo) {
        setToken("");
        setConnected(true);
      } else setError(errorText(candidate, "The token could not be saved. Is the vault unlocked?"));
    } catch {
      setError("The token could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError("");
    const request = { version: 1 as const, kind: "alias.clearDuckToken" as const };
    try {
      const candidate = await platform.sendMessage(request);
      const parsed = parseAliasResponseForRequest(request, candidate);
      if (parsed.success) {
        setConnected(false);
        setAddresses([]);
      } else setError(errorText(candidate, "Could not remove the token. Try again."));
    } catch {
      setError("Could not remove the token. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const generate = async () => {
    setBusy(true);
    setError("");
    const request = { version: 1 as const, kind: "alias.generateDuck" as const };
    try {
      const candidate = await platform.sendMessage(request);
      const parsed = parseAliasResponseForRequest(request, candidate);
      if (parsed.success && parsed.data.kind === "alias.generated") {
        const address = parsed.data.address;
        setAddresses((current) => [address, ...current].slice(0, 20));
      } else setError(errorText(candidate, "DuckDuckGo did not answer. Try again."));
    } catch {
      setError("DuckDuckGo did not answer. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.settingsCard} aria-labelledby="aliases-heading">
      <h2 id="aliases-heading" className={styles.settingsCardTitle}>
        Email aliases
      </h2>
      <p className={styles.settingsCardCopy}>
        DuckDuckGo Email Protection forwards mail sent to a private @duck.com address to your own
        inbox, with trackers removed. Give each site its own address, and switch one off at
        duckduckgo.com when it starts getting spam.
      </p>
      {connected === null ? (
        <p className={styles.settingsCardCopy}>Checking…</p>
      ) : connected ? (
        <>
          <p className={styles.settingsCardCopy} role="status">
            Connected to DuckDuckGo. Sign-up forms offer a new address on the username field.
          </p>
          <div className={styles.settingsActions}>
            <Button type="button" onClick={() => void generate()} loading={busy}>
              New @duck.com address
            </Button>
            <Button type="button" variant="ghost" onClick={() => void disconnect()} disabled={busy}>
              Disconnect
            </Button>
          </div>
          {addresses.length > 0 ? (
            <ul className={detailStyles.table} aria-label="Addresses made this session">
              {addresses.map((address) => (
                <li key={address} className={detailStyles.tableRow}>
                  <span className={detailStyles.tableValue}>{address}</span>
                  <CopyButton label={`Copy ${address}`} value={address} />
                </li>
              ))}
            </ul>
          ) : null}
          <p className={styles.settingsCardCopy}>
            ShardPass keeps none of these: save an address on the login you use it for.
          </p>
        </>
      ) : (
        <form
          className={styles.settingsForm}
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) void connect();
          }}
        >
          <ol className={styles.settingsSteps}>
            <li>Sign up for Email Protection at duckduckgo.com/email.</li>
            <li>Open duckduckgo.com/email/settings/autofill.</li>
            <li>
              In the browser's developer tools, Network tab, generate a private address and copy the
              value of its Authorization header (after "Bearer").
            </li>
          </ol>
          <label className={styles.settingsLabel}>
            Token
            <PasswordInput
              autoComplete="off"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </label>
          <p className={styles.settingsCardCopy}>
            The token is stored sealed under your vault key and is sent only to DuckDuckGo.
          </p>
          <div className={styles.settingsActions}>
            <Button type="submit" loading={busy}>
              Connect
            </Button>
          </div>
        </form>
      )}
      {error !== "" ? (
        <p className={styles.settingsError} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
