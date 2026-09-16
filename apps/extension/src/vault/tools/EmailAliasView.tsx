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
  type Address = Readonly<{ address: string; createdAt: number; site?: string | undefined }>;
  const [addresses, setAddresses] = useState<readonly Address[]>([]);
  const [addressesLoaded, setAddressesLoaded] = useState(false);

  // The addresses minted so far, kept by the background beside the token.
  useEffect(() => {
    if (!active || addressesLoaded) return;
    let mounted = true;
    const request = { version: 1 as const, kind: "alias.listDuck" as const };
    platform.sendMessage(request).then(
      (candidate) => {
        if (!mounted) return;
        const parsed = parseAliasResponseForRequest(request, candidate);
        if (parsed.success && parsed.data.kind === "alias.duckList")
          setAddresses(parsed.data.addresses);
        setAddressesLoaded(true);
      },
      () => {
        if (mounted) setAddressesLoaded(true);
      },
    );
    return () => {
      mounted = false;
    };
  }, [active, addressesLoaded, platform]);

  const forget = async (address: string) => {
    const request = { version: 1 as const, kind: "alias.forgetDuck" as const, address };
    try {
      const candidate = await platform.sendMessage(request);
      const parsed = parseAliasResponseForRequest(request, candidate);
      if (parsed.success && parsed.data.kind === "alias.duckList")
        setAddresses(parsed.data.addresses);
    } catch {
      setError("Could not remove the address from the list. Try again.");
    }
  };

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
      if (parsed.success) setConnected(false);
      else setError(errorText(candidate, "Could not remove the token. Try again."));
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
        setAddresses((current) => [{ address, createdAt: Date.now() }, ...current]);
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
      {addresses.length > 0 ? (
        <>
          <h3 className={styles.settingsCardTitle}>Your addresses</h3>
          <ul className={detailStyles.table} aria-label="Addresses made so far">
            {addresses.map((entry) => (
              <li key={entry.address} className={detailStyles.tableRow}>
                <span className={detailStyles.tableLabel}>
                  {entry.site ?? new Date(entry.createdAt).toLocaleDateString("en-US")}
                </span>
                <span className={detailStyles.tableValue}>{entry.address}</span>
                <CopyButton label={`Copy ${entry.address}`} value={entry.address} />
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Forget ${entry.address}`}
                  onClick={() => void forget(entry.address)}
                >
                  Forget
                </Button>
              </li>
            ))}
          </ul>
          <p className={styles.settingsCardCopy}>
            Forgetting an address here only shortens this list; switch it off at duckduckgo.com to
            stop its mail.
          </p>
        </>
      ) : null}
    </section>
  );
}
