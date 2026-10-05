import { parseAliasResponseForRequest } from "@shardpass/messaging";
import { Button } from "@shardpass/ui";
import { AtSign, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import type { ExtensionPlatform } from "../../platform/extension-platform";
import styles from "./AliasPanel.module.css";

export interface AliasPanelProps {
  platform: Pick<ExtensionPlatform, "sendMessage">;
  /** The open tab's site, remembered beside the address so the vault can say what it was for. */
  site?: string | undefined;
  onCopy: (value: string, label: string) => void;
  /** Opens the vault's Email aliases page, where DuckDuckGo is connected. */
  onSetUp: () => void;
}

type Status = "checking" | "unavailable" | "ready";

/**
 * A private @duck.com address for the sign-up form behind the popup. Each press mints a real
 * address at DuckDuckGo, so nothing here regenerates on its own: one press, one address.
 */
export function AliasPanel({ platform, site, onCopy, onSetUp }: AliasPanelProps) {
  const [status, setStatus] = useState<Status>("checking");
  const [address, setAddress] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    const request = { version: 1 as const, kind: "alias.getStatus" as const };
    platform.sendMessage(request).then(
      (candidate) => {
        if (!live) return;
        const parsed = parseAliasResponseForRequest(request, candidate);
        setStatus(
          parsed.success && parsed.data.kind === "alias.status" && parsed.data.duckduckgo
            ? "ready"
            : "unavailable",
        );
      },
      () => live && setStatus("unavailable"),
    );
    return () => {
      live = false;
    };
  }, [platform]);

  const make = () => {
    setWorking(true);
    setError("");
    const request = {
      version: 1 as const,
      kind: "alias.generateDuck" as const,
      ...(site === undefined || site === "" ? {} : { site }),
    };
    platform.sendMessage(request).then(
      (candidate) => {
        setWorking(false);
        const parsed = parseAliasResponseForRequest(request, candidate);
        if (parsed.success && parsed.data.kind === "alias.generated") {
          setAddress(parsed.data.address);
          onCopy(parsed.data.address, "Address");
        } else setError("DuckDuckGo did not make an address. Try again in a moment.");
      },
      () => {
        setWorking(false);
        setError("DuckDuckGo could not be reached. Check the connection and try again.");
      },
    );
  };

  if (status === "checking") return null;

  return (
    <section className={styles.panel} aria-labelledby="alias-heading">
      <h3 id="alias-heading" className={styles.heading}>
        <AtSign size={14} aria-hidden="true" />
        Email alias
      </h3>
      {status === "unavailable" ? (
        <p className={styles.hint}>
          A private @duck.com address forwards to your inbox, so a site never learns your real one.{" "}
          <button type="button" className={styles.link} onClick={onSetUp}>
            Connect DuckDuckGo in the vault
          </button>
        </p>
      ) : (
        <>
          {address !== "" ? (
            <div className={styles.result}>
              <output className={styles.address} aria-label="New email alias">
                {address}
              </output>
              <Button variant="ghost" onClick={() => onCopy(address, "Address")}>
                <Copy size={14} aria-hidden="true" /> Copy
              </Button>
            </div>
          ) : null}
          <Button variant="secondary" loading={working} onClick={make}>
            {address === "" ? "New @duck.com address" : "Another address"}
          </Button>
          <p className={styles.hint}>
            {site === undefined || site === ""
              ? "Each address is new and is copied as soon as it is made."
              : `Made for ${site} and copied as soon as it is made.`}
          </p>
          {error !== "" ? (
            <p className={styles.error} role="alert">
              {error}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
