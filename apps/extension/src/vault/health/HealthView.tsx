import type { LoginItem, VaultItem } from "@shardpass/domain";
import { parseSecurityResponseForRequest } from "@shardpass/messaging";
import { Button } from "@shardpass/ui";
import { useEffect, useMemo, useState } from "react";

import type { ExtensionPlatform } from "../../platform/extension-platform";
import {
  createStrengthEstimator,
  type StrengthEstimator,
} from "../../vault-access/strength-estimator";
import { computeHealth } from "./health-report";
import styles from "./HealthView.module.css";

export interface HealthViewProps {
  platform: Pick<ExtensionPlatform, "sendMessage">;
  items: readonly VaultItem[];
  redactedIds: ReadonlySet<string>;
  /** The view is on screen; the slow parts (estimates, checks) run only then. */
  active: boolean;
  onOpenItem: (itemId: string) => void;
  estimator?: StrengthEstimator;
}

/** At most this many logins get a full strength estimate per pass; the rest wait for the next. */
const ESTIMATE_BATCH = 400;
/** Breach checks are one network call per unique password prefix; this caps a run. */
const BREACH_BATCH = 200;

type BreachRun =
  | Readonly<{ state: "idle" }>
  | Readonly<{ state: "running"; done: number; total: number }>
  | Readonly<{ state: "done"; found: readonly Readonly<{ login: LoginItem; count: number }>[] }>
  | Readonly<{ state: "disabled" }>
  | Readonly<{ state: "failed" }>;

/**
 * The vault's health: weak, reused, breached and unencrypted-site logins, and those with no
 * second factor. Every section names its logins and opens them; nothing is changed here.
 */
export function HealthView({
  platform,
  items,
  redactedIds,
  active,
  onOpenItem,
  estimator,
}: HealthViewProps) {
  const report = useMemo(() => computeHealth(items, redactedIds), [items, redactedIds]);
  const [weakness, setWeakness] = useState<ReadonlyMap<string, number>>(new Map());
  const [breach, setBreach] = useState<BreachRun>({ state: "idle" });
  const [ownEstimator] = useState(() => estimator ?? createStrengthEstimator());
  useEffect(() => () => ownEstimator.dispose(), [ownEstimator]);

  // Strength, on the worker, for logins not yet judged; a password judged once stays judged.
  useEffect(() => {
    if (!active) return;
    let live = true;
    const pending = report.logins
      .filter((login) => !weakness.has(login.password))
      .slice(0, ESTIMATE_BATCH);
    if (pending.length === 0) return;
    void (async () => {
      const next = new Map(weakness);
      for (const login of pending) {
        if (!live) return;
        const estimate = await ownEstimator.estimate(login.password, [login.username, login.name]);
        next.set(login.password, estimate.level);
      }
      if (live) setWeakness(next);
    })();
    return () => {
      live = false;
    };
  }, [active, ownEstimator, report.logins, weakness]);

  const weak = report.logins.filter((login) => (weakness.get(login.password) ?? 3) < 2);
  const judged = report.logins.filter((login) => weakness.has(login.password)).length;

  const runBreachCheck = async () => {
    const targets = report.logins.slice(0, BREACH_BATCH);
    setBreach({ state: "running", done: 0, total: targets.length });
    const found: Array<Readonly<{ login: LoginItem; count: number }>> = [];
    let done = 0;
    for (const login of targets) {
      const request = {
        version: 1 as const,
        kind: "security.checkItem" as const,
        itemId: login.id,
      };
      let candidate: unknown;
      try {
        candidate = await platform.sendMessage(request);
      } catch {
        setBreach({ state: "failed" });
        return;
      }
      const parsed = parseSecurityResponseForRequest(request, candidate);
      if (!parsed.success || parsed.data.kind !== "security.breachResult") {
        const code = (candidate as { error?: { code?: unknown } } | null)?.error?.code;
        setBreach(code === "BREACH_CHECK_DISABLED" ? { state: "disabled" } : { state: "failed" });
        return;
      }
      if (parsed.data.count > 0) found.push({ login, count: parsed.data.count });
      done += 1;
      setBreach({ state: "running", done, total: targets.length });
    }
    setBreach({ state: "done", found });
  };

  const row = (login: LoginItem, note?: string) => (
    <li key={login.id} className={styles.row}>
      <button type="button" className={styles.open} onClick={() => onOpenItem(login.id)}>
        <span className={styles.name}>{login.name}</span>
        {login.username !== "" ? <span className={styles.subtitle}>{login.username}</span> : null}
      </button>
      {note !== undefined ? <span className={styles.note}>{note}</span> : null}
    </li>
  );

  return (
    <section className={styles.view} aria-labelledby="health-heading">
      <header className={styles.header}>
        <h3 id="health-heading" className={styles.heading}>
          Vault health
        </h3>
        <p className={styles.copy}>
          {report.logins.length} {report.logins.length === 1 ? "login" : "logins"} with a password.
          {report.skipped > 0
            ? ` ${report.skipped} ${report.skipped === 1 ? "asks" : "ask"} for the master password first and ${report.skipped === 1 ? "was" : "were"} left out.`
            : ""}
        </p>
      </header>

      <div className={styles.grid}>
        <section className={styles.card} aria-labelledby="health-weak">
          <h4 id="health-weak" className={styles.cardTitle}>
            Weak passwords <span className={styles.count}>{weak.length}</span>
          </h4>
          {judged < report.logins.length ? (
            <p className={styles.quiet} role="status">
              Checking… {judged} of {report.logins.length}
            </p>
          ) : null}
          {weak.length === 0 && judged === report.logins.length ? (
            <p className={styles.quiet}>None found.</p>
          ) : null}
          <ul className={styles.list}>{weak.map((login) => row(login))}</ul>
        </section>

        <section className={styles.card} aria-labelledby="health-reused">
          <h4 id="health-reused" className={styles.cardTitle}>
            Reused passwords <span className={styles.count}>{report.reused.length}</span>
          </h4>
          {report.reused.length === 0 ? (
            <p className={styles.quiet}>Every password is used once.</p>
          ) : null}
          {report.reused.map((group, index) => (
            <ul
              key={index}
              className={styles.list}
              aria-label={`Shared by ${group.logins.length} logins`}
            >
              {group.logins.map((login) => row(login, `shared by ${group.logins.length}`))}
            </ul>
          ))}
        </section>

        <section className={styles.card} aria-labelledby="health-breached">
          <h4 id="health-breached" className={styles.cardTitle}>
            Breached passwords
            {breach.state === "done" ? (
              <span className={styles.count}>{breach.found.length}</span>
            ) : null}
          </h4>
          {breach.state === "idle" ? (
            <p className={styles.quiet}>
              Checks each password against Have I Been Pwned, one hash prefix at a time.
            </p>
          ) : breach.state === "running" ? (
            <p className={styles.quiet} role="status">
              Checking… {breach.done} of {breach.total}
            </p>
          ) : breach.state === "disabled" ? (
            <p className={styles.quiet}>Turn on breach checks in Settings first.</p>
          ) : breach.state === "failed" ? (
            <p className={styles.quiet}>The check could not finish. Try again later.</p>
          ) : breach.found.length === 0 ? (
            <p className={styles.quiet}>None of these passwords appear in known breaches.</p>
          ) : null}
          {breach.state === "done" ? (
            <ul className={styles.list}>
              {breach.found.map(({ login, count }) =>
                row(login, `seen ${count.toLocaleString("en-US")} times`),
              )}
            </ul>
          ) : null}
          <div>
            <Button
              variant="secondary"
              onClick={() => void runBreachCheck()}
              loading={breach.state === "running"}
            >
              {breach.state === "done" ? "Check again" : "Check now"}
            </Button>
          </div>
        </section>

        <section className={styles.card} aria-labelledby="health-unsecured">
          <h4 id="health-unsecured" className={styles.cardTitle}>
            Unencrypted sites <span className={styles.count}>{report.unsecured.length}</span>
          </h4>
          {report.unsecured.length === 0 ? (
            <p className={styles.quiet}>Every saved site uses https.</p>
          ) : null}
          <ul className={styles.list}>{report.unsecured.map((login) => row(login, "http://"))}</ul>
        </section>

        <section className={styles.card} aria-labelledby="health-2fa">
          <h4 id="health-2fa" className={styles.cardTitle}>
            No second factor here{" "}
            <span className={styles.count}>{report.withoutTwoFactor.length}</span>
          </h4>
          <p className={styles.quiet}>
            Logins with no one-time code stored or linked. The site may still offer one.
          </p>
          <ul className={styles.list}>{report.withoutTwoFactor.map((login) => row(login))}</ul>
        </section>
      </div>
    </section>
  );
}
