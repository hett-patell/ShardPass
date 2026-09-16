import type { LoginItem, VaultItem } from "@shardpass/domain";
import { parseSecurityResponseForRequest } from "@shardpass/messaging";
import { Button, HealthGauge } from "@shardpass/ui";
import {
  ArrowRight,
  Copy,
  Fingerprint,
  KeyRound,
  LockOpen,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { ExtensionPlatform } from "../../platform/extension-platform";
import {
  createStrengthEstimator,
  type StrengthEstimator,
} from "../../vault-access/strength-estimator";
import { computeHealthScore } from "./health-score";
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
  | Readonly<{ state: "disabled" }>
  | Readonly<{ state: "failed" }>;
/** A remembered verdict for one login; stale once its password changed after the check. */
type Verdict = Readonly<{ count: number; checkedAt: number; stale: boolean }>;

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
  // Verdicts the background remembers, read once per visit, then updated as checks run.
  const [verdicts, setVerdicts] = useState<ReadonlyMap<string, Verdict>>(new Map());
  const [verdictsLoaded, setVerdictsLoaded] = useState(false);

  useEffect(() => {
    if (!active || verdictsLoaded) return;
    let live = true;
    const request = { version: 1 as const, kind: "security.listResults" as const };
    platform.sendMessage(request).then(
      (candidate) => {
        if (!live) return;
        const parsed = parseSecurityResponseForRequest(request, candidate);
        if (parsed.success && parsed.data.kind === "security.results")
          setVerdicts(
            new Map(
              parsed.data.results.map((result) => [
                result.itemId,
                { count: result.count, checkedAt: result.checkedAt, stale: result.stale },
              ]),
            ),
          );
        setVerdictsLoaded(true);
      },
      () => {
        if (live) setVerdictsLoaded(true);
      },
    );
    return () => {
      live = false;
    };
  }, [active, platform, verdictsLoaded]);
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

  const verdictFor = (login: LoginItem): Verdict | undefined => {
    const verdict = verdicts.get(login.id);
    return verdict !== undefined && !verdict.stale ? verdict : undefined;
  };
  const unchecked = report.logins.filter((login) => verdictFor(login) === undefined);
  const checkedCount = report.logins.length - unchecked.length;
  const found = report.logins.flatMap((login) => {
    const verdict = verdictFor(login);
    return verdict !== undefined && verdict.count > 0 ? [{ login, count: verdict.count }] : [];
  });

  /** Checks what has no verdict yet, or everything again; each verdict is remembered as it lands. */
  const runBreachCheck = async (mode: "unchecked" | "all") => {
    const targets = (mode === "all" ? report.logins : unchecked).slice(0, BREACH_BATCH);
    setBreach({ state: "running", done: 0, total: targets.length });
    let done = 0;
    for (const login of targets) {
      const request = {
        version: 1 as const,
        kind: "security.checkItem" as const,
        itemId: login.id,
        ...(mode === "all" ? { force: true } : {}),
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
      const { count, checkedAt } = parsed.data;
      setVerdicts((current) => new Map(current).set(login.id, { count, checkedAt, stale: false }));
      done += 1;
      setBreach({ state: "running", done, total: targets.length });
    }
    setBreach({ state: "idle" });
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

  const score = computeHealthScore({
    logins: report.logins.length,
    weak: weak.length,
    reused: report.reused.reduce((sum, group) => sum + group.logins.length, 0),
    breached: found.length,
    unsecured: report.unsecured.length,
    withoutTwoFactor: report.withoutTwoFactor.length,
  });
  // How the judged passwords spread across the four strength levels, for the bar.
  const spread = [0, 0, 0, 0];
  for (const login of report.logins) {
    const level = weakness.get(login.password);
    if (level !== undefined) {
      const slot = Math.max(0, Math.min(3, level));
      spread[slot] = (spread[slot] ?? 0) + 1;
    }
  }
  const reusedLogins = report.reused.flatMap((group) => group.logins);

  return (
    <section className={styles.view} aria-labelledby="health-heading">
      <header className={styles.hero}>
        <div className={styles.heroText}>
          <h3 id="health-heading" className={styles.heading}>
            Vault health
          </h3>
          <p className={styles.copy}>
            One score for how safe your logins are, from what the vault can see on its own and what
            you let it check. Fix the flagged items to raise it.
          </p>
          <p className={styles.quiet}>
            {report.logins.length} {report.logins.length === 1 ? "login" : "logins"} with a
            password.
            {report.skipped > 0
              ? ` ${report.skipped} ${report.skipped === 1 ? "asks" : "ask"} for the master password first and ${report.skipped === 1 ? "was" : "were"} left out.`
              : ""}
          </p>
        </div>
        <HealthGauge score={score.score} caption={score.caption} size="lg" />
      </header>

      <section className={styles.strengthCard} aria-labelledby="health-strength">
        <h4 id="health-strength" className={styles.cardTitle}>
          Overall password strength
        </h4>
        {judged === 0 ? (
          <p className={styles.quiet} role="status">
            {report.logins.length === 0 ? "No passwords to judge." : "Judging…"}
          </p>
        ) : (
          <>
            <div
              className={styles.strengthBar}
              role="img"
              aria-label={`${spread[3]} strong, ${spread[2]} fair, ${spread[1]} weak, ${spread[0]} very weak`}
            >
              {([3, 2, 1, 0] as const).map((level) =>
                (spread[level] ?? 0) > 0 ? (
                  <span
                    key={level}
                    className={styles.strengthSegment}
                    data-level={level}
                    style={{ flexGrow: spread[level] ?? 0 }}
                  />
                ) : null,
              )}
            </div>
            <p className={styles.legend}>
              <span data-level="3">{spread[3]} strong</span>
              <span data-level="2">{spread[2]} fair</span>
              <span data-level="1">{spread[1]} weak</span>
              <span data-level="0">{spread[0]} very weak</span>
              {judged < report.logins.length ? (
                <span role="status">
                  Judging… {judged} of {report.logins.length}
                </span>
              ) : null}
            </p>
          </>
        )}
      </section>

      <div className={styles.grid}>
        <StatCard
          id="health-breached"
          tone="danger"
          icon={<ShieldAlert size={40} />}
          count={checkedCount > 0 ? found.length : null}
          title="Breached passwords"
          description={
            breach.state === "disabled"
              ? "Turn on breach checks in Settings first."
              : breach.state === "failed"
                ? "The check could not finish. Try again later."
                : breach.state === "running"
                  ? `Checking… ${breach.done} of ${breach.total}`
                  : checkedCount === 0
                    ? "Each password is checked against Have I Been Pwned by hash prefix, once, and remembered until it changes."
                    : `${checkedCount} of ${report.logins.length} checked${unchecked.length > 0 ? `, ${unchecked.length} not yet` : ""}.${found.length === 0 ? " None appear in known breaches." : " Change these passwords."}`
          }
          rows={found.map(({ login, count }) =>
            row(login, `seen ${count.toLocaleString("en-US")} times`),
          )}
          actions={
            <>
              {unchecked.length > 0 || checkedCount === 0 ? (
                <Button
                  variant="secondary"
                  onClick={() => void runBreachCheck("unchecked")}
                  loading={breach.state === "running"}
                  disabled={!verdictsLoaded}
                >
                  {checkedCount === 0 ? "Check now" : `Check ${unchecked.length} unchecked`}
                </Button>
              ) : null}
              {checkedCount > 0 ? (
                <Button
                  variant="ghost"
                  onClick={() => void runBreachCheck("all")}
                  disabled={breach.state === "running"}
                >
                  Check all again
                </Button>
              ) : null}
            </>
          }
        />
        <StatCard
          id="health-weak"
          tone="warning"
          icon={<KeyRound size={40} />}
          count={weak.length}
          title="Weak passwords"
          description={
            judged < report.logins.length
              ? `Judging… ${judged} of ${report.logins.length}`
              : weak.length === 0
                ? "Every password would take a long time to guess."
                : "Short or guessable. Replace them with generated passwords."
          }
          rows={weak.map((login) => row(login))}
        />
        <StatCard
          id="health-reused"
          tone="warning"
          icon={<Copy size={40} />}
          count={reusedLogins.length}
          title="Reused passwords"
          description={
            reusedLogins.length === 0
              ? "Every password is used once."
              : `${report.reused.length} ${report.reused.length === 1 ? "password is" : "passwords are"} shared between sites. One leak opens them all.`
          }
          rows={report.reused.flatMap((group) =>
            group.logins.map((login) => row(login, `shared by ${group.logins.length}`)),
          )}
        />
        <StatCard
          id="health-passkeys"
          tone="accent"
          icon={<Fingerprint size={40} />}
          count={report.passkeyReady.length}
          title="Passkeys available"
          description={
            report.passkeyReady.length === 0
              ? "No saved site on the list of known passkey sites is still without one."
              : "These sites accept passkeys, a stronger sign-in than a password. Add one from the site's security settings."
          }
          rows={report.passkeyReady.map((login) => row(login))}
        />
        <StatCard
          id="health-unsecured"
          tone="neutral"
          icon={<LockOpen size={40} />}
          count={report.unsecured.length}
          title="Unencrypted sites"
          description={
            report.unsecured.length === 0
              ? "Every saved site uses https."
              : "Saved as plain http://. The password travels unencrypted when you sign in there."
          }
          rows={report.unsecured.map((login) => row(login, "http://"))}
        />
        <StatCard
          id="health-2fa"
          tone="neutral"
          icon={<ShieldCheck size={40} />}
          count={report.withoutTwoFactor.length}
          title="No second factor here"
          description="Logins with no one-time code stored or linked. The site may still offer one."
          rows={report.withoutTwoFactor.map((login) => row(login))}
        />
      </div>
    </section>
  );
}

const PREVIEW_ROWS = 5;

type StatCardProps = Readonly<{
  id: string;
  tone: "danger" | "warning" | "accent" | "neutral";
  icon: ReactNode;
  /** null while the number is not known yet. */
  count: number | null;
  title: string;
  description: string;
  rows: readonly ReactNode[];
  actions?: ReactNode;
}>;

/** One finding: the number first, what it means, a few rows, and the rest on request. */
function StatCard({ id, tone, icon, count, title, description, rows, actions }: StatCardProps) {
  const [open, setOpen] = useState(false);
  const shown = open ? rows : rows.slice(0, PREVIEW_ROWS);
  return (
    <section className={styles.statCard} data-tone={tone} aria-labelledby={id}>
      <div className={styles.statHead}>
        <span className={styles.bigNumber}>
          {count === null ? "–" : count.toLocaleString("en-US")}
        </span>
        <span className={styles.cardIcon} aria-hidden="true">
          {icon}
        </span>
      </div>
      <h4 id={id} className={styles.cardTitle}>
        {title}
      </h4>
      <p className={styles.quiet}>{description}</p>
      {shown.length > 0 ? <ul className={styles.list}>{shown}</ul> : null}
      {actions !== undefined ? <div className={styles.actions}>{actions}</div> : null}
      {rows.length > PREVIEW_ROWS ? (
        <button type="button" className={styles.showItems} onClick={() => setOpen(!open)}>
          {open ? "Show fewer" : `Show all ${rows.length} items`}
          <ArrowRight size={14} aria-hidden="true" />
        </button>
      ) : null}
    </section>
  );
}
