import { parseSecurityResponseForRequest } from "@shardpass/messaging";
import { Button } from "@shardpass/ui";
import { useState } from "react";

import type { ExtensionPlatform } from "../../../platform/extension-platform";
import styles from "./Detail.module.css";

export interface BreachCheckRowProps {
  itemId: string;
  platform: Pick<ExtensionPlatform, "sendMessage">;
}

type Outcome =
  | Readonly<{ state: "idle" }>
  | Readonly<{ state: "checking" }>
  | Readonly<{ state: "clear" }>
  | Readonly<{ state: "found"; count: number }>
  | Readonly<{ state: "disabled" }>
  | Readonly<{ state: "failed" }>;

function errorCodeOf(candidate: unknown): string | undefined {
  const envelope = candidate as { kind?: unknown; error?: { code?: unknown } } | null;
  return envelope?.kind === "error" && typeof envelope.error?.code === "string"
    ? envelope.error.code
    : undefined;
}

/** One click checks this login's password against known breaches; the verdict stays until the item changes. */
export function BreachCheckRow({ itemId, platform }: BreachCheckRowProps) {
  const [outcome, setOutcome] = useState<Outcome>({ state: "idle" });

  const check = () => {
    setOutcome({ state: "checking" });
    const request = { version: 1 as const, kind: "security.checkItem" as const, itemId };
    platform.sendMessage(request).then(
      (candidate) => {
        const parsed = parseSecurityResponseForRequest(request, candidate);
        if (parsed.success && parsed.data.kind === "security.breachResult") {
          setOutcome(
            parsed.data.count > 0
              ? { state: "found", count: parsed.data.count }
              : { state: "clear" },
          );
          return;
        }
        setOutcome(
          errorCodeOf(candidate) === "BREACH_CHECK_DISABLED"
            ? { state: "disabled" }
            : { state: "failed" },
        );
      },
      () => setOutcome({ state: "failed" }),
    );
  };

  return (
    <div className={styles.fieldGroup}>
      <span className={styles.label}>Breaches</span>
      <div className={styles.row}>
        <span className={styles.rowValue} role="status">
          {outcome.state === "idle"
            ? "Not checked yet."
            : outcome.state === "checking"
              ? "Checking…"
              : outcome.state === "clear"
                ? "Not found in known breaches."
                : outcome.state === "found"
                  ? `Seen ${outcome.count.toLocaleString("en-US")} ${outcome.count === 1 ? "time" : "times"} in known breaches. Change this password.`
                  : outcome.state === "disabled"
                    ? "Turn on breach checks in Settings to use this."
                    : "The check could not run. Try again later."}
        </span>
        <Button variant="secondary" onClick={check} loading={outcome.state === "checking"}>
          Check
        </Button>
      </div>
    </div>
  );
}
