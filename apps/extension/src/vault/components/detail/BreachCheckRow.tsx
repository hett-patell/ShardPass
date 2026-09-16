import { parseSecurityResponseForRequest } from "@shardpass/messaging";
import { Button } from "@shardpass/ui";
import { useEffect, useState } from "react";

import type { ExtensionPlatform } from "../../../platform/extension-platform";
import styles from "./Detail.module.css";

export interface BreachCheckRowProps {
  itemId: string;
  platform: Pick<ExtensionPlatform, "sendMessage">;
}

type Outcome =
  | Readonly<{ state: "loading" }>
  | Readonly<{ state: "idle" }>
  | Readonly<{ state: "checking" }>
  | Readonly<{ state: "clear"; checkedAt: number }>
  | Readonly<{ state: "found"; count: number; checkedAt: number }>
  | Readonly<{ state: "stale"; checkedAt: number }>
  | Readonly<{ state: "disabled" }>
  | Readonly<{ state: "failed" }>;

function errorCodeOf(candidate: unknown): string | undefined {
  const envelope = candidate as { kind?: unknown; error?: { code?: unknown } } | null;
  return envelope?.kind === "error" && typeof envelope.error?.code === "string"
    ? envelope.error.code
    : undefined;
}

/** "today", "yesterday", "12 days ago": enough to know whether a verdict is worth trusting. */
function ago(checkedAt: number, now = Date.now()): string {
  const days = Math.max(0, Math.round((now - checkedAt) / 86_400_000));
  return days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

/**
 * This login's password against known breaches. The background remembers the verdict until
 * the password changes, so opening the item shows it without another check.
 */
export function BreachCheckRow({ itemId, platform }: BreachCheckRowProps) {
  const [outcome, setOutcome] = useState<Outcome>({ state: "loading" });

  useEffect(() => {
    let live = true;
    setOutcome({ state: "loading" });
    const request = { version: 1 as const, kind: "security.listResults" as const, itemId };
    platform.sendMessage(request).then(
      (candidate) => {
        if (!live) return;
        const parsed = parseSecurityResponseForRequest(request, candidate);
        const verdict =
          parsed.success && parsed.data.kind === "security.results"
            ? parsed.data.results.find((result) => result.itemId === itemId)
            : undefined;
        if (verdict === undefined) setOutcome({ state: "idle" });
        else if (verdict.stale) setOutcome({ state: "stale", checkedAt: verdict.checkedAt });
        else if (verdict.count > 0)
          setOutcome({ state: "found", count: verdict.count, checkedAt: verdict.checkedAt });
        else setOutcome({ state: "clear", checkedAt: verdict.checkedAt });
      },
      () => {
        // The background did not answer at all: say so rather than "not checked yet".
        if (live) setOutcome({ state: "failed" });
      },
    );
    return () => {
      live = false;
    };
  }, [itemId, platform]);

  const check = (force: boolean) => {
    setOutcome({ state: "checking" });
    const request = {
      version: 1 as const,
      kind: "security.checkItem" as const,
      itemId,
      ...(force ? { force: true } : {}),
    };
    platform.sendMessage(request).then(
      (candidate) => {
        const parsed = parseSecurityResponseForRequest(request, candidate);
        if (parsed.success && parsed.data.kind === "security.breachResult") {
          const { count, checkedAt } = parsed.data;
          setOutcome(
            count > 0 ? { state: "found", count, checkedAt } : { state: "clear", checkedAt },
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

  const settled = outcome.state === "clear" || outcome.state === "found";
  return (
    <div className={styles.fieldGroup}>
      <span className={styles.label}>Breaches</span>
      <div className={styles.row}>
        <span className={styles.rowValue} role="status">
          {outcome.state === "loading"
            ? "…"
            : outcome.state === "idle"
              ? "Not checked yet."
              : outcome.state === "checking"
                ? "Checking…"
                : outcome.state === "clear"
                  ? `Not found in known breaches (checked ${ago(outcome.checkedAt)}).`
                  : outcome.state === "found"
                    ? `Seen ${outcome.count.toLocaleString("en-US")} ${outcome.count === 1 ? "time" : "times"} in known breaches (checked ${ago(outcome.checkedAt)}). Change this password.`
                    : outcome.state === "stale"
                      ? `The password changed since it was checked ${ago(outcome.checkedAt)}.`
                      : outcome.state === "disabled"
                        ? "Turn on breach checks in Settings to use this."
                        : "The check could not run. Try again later."}
        </span>
        <Button
          variant="secondary"
          onClick={() => check(settled)}
          loading={outcome.state === "checking" || outcome.state === "loading"}
        >
          {settled ? "Check again" : "Check"}
        </Button>
      </div>
    </div>
  );
}
