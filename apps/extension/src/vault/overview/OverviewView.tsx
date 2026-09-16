import type { LoginItem, VaultItem, VaultItemKind } from "@shardpass/domain";
import { parseSecurityResponseForRequest } from "@shardpass/messaging";
import { Button, HealthGauge } from "@shardpass/ui";
import { Globe } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { ExtensionPlatform } from "../../platform/extension-platform";
import { faviconUrl } from "../../platform/favicon";
import { createStrengthEstimator } from "../../vault-access/strength-estimator";
import { computeHealth } from "../health/health-report";
import { computeHealthScore } from "../health/health-score";
// The health page owns the finding ids; a second copy here would drift from the cards.
import type { HealthFocus } from "../health/HealthView";
import { itemDisplayName, itemDisplaySubtitle } from "../item-support";
import styles from "./OverviewView.module.css";

export interface OverviewViewProps {
  platform: Pick<ExtensionPlatform, "sendMessage">;
  /** Live items: not archived, not deleted. */
  items: readonly VaultItem[];
  folderCount: number;
  redactedIds: ReadonlySet<string>;
  active: boolean;
  onOpenItem: (itemId: string) => void;
  onOpenHealth: (focus?: HealthFocus) => void;
  onOpenGenerator: () => void;
  onOpenImport: () => void;
  onNewLogin: () => void;
}

/** The sidebar's colour per kind, so one colour means the same thing in both places. */
const KINDS: readonly Readonly<{ kind: VaultItemKind; label: string; tint: string }>[] = [
  { kind: "login", label: "Logins", tint: "#0ea5e9" },
  { kind: "otp", label: "One-time codes", tint: "#8b5cf6" },
  { kind: "note", label: "Notes", tint: "#eab308" },
  { kind: "card", label: "Cards", tint: "#2563eb" },
  { kind: "identity", label: "Identities", tint: "#22c55e" },
  { kind: "secret", label: "Secrets", tint: "#64748b" },
];

const RECENT = 6;
const KIND_LABEL: Record<VaultItemKind, string> = {
  login: "Login",
  otp: "One-time code",
  note: "Note",
  card: "Card",
  identity: "Identity",
  secret: "Secret",
};

type Severity = "critical" | "warning" | "opportunity";

interface Finding {
  readonly focus: HealthFocus;
  readonly severity: Severity;
  readonly count: number;
  readonly title: string;
  readonly detail: string;
  readonly action: string;
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, opportunity: 2 };

/** "today", "yesterday", "3 days ago", else the date: enough to place a change. */
function whenLabel(iso: string, now = Date.now()): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return "";
  const days = Math.floor((now - at) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Two of the accounts a finding covers, then how many more. A count alone says how much work
 * there is; the names say whether it is work worth doing now.
 */
function namesOf(logins: readonly LoginItem[]): string {
  const names = logins.map((login) => itemDisplayName(login)).filter((name) => name !== "");
  if (names.length === 0) return "";
  if (names.length === 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  const rest = names.length - 2;
  return `${names[0]}, ${names[1]} and ${rest} ${rest === 1 ? "other" : "others"}`;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** Passwords judged per pass on the worker; a vault of thousands takes a few passes. */
const STRENGTH_BATCH = 200;

/** What the vault is holding, what it wants you to fix first, and what changed last. */
export function OverviewView({
  platform,
  items,
  folderCount,
  redactedIds,
  active,
  onOpenItem,
  onOpenHealth,
  onOpenGenerator,
  onOpenImport,
  onNewLogin,
}: OverviewViewProps) {
  const report = useMemo(() => computeHealth(items, redactedIds), [items, redactedIds]);
  // Strength on the same worker the health view uses, so both pages agree on "weak".
  const [ownEstimator] = useState(() => createStrengthEstimator());
  useEffect(() => () => ownEstimator.dispose(), [ownEstimator]);
  const [weakness, setWeakness] = useState<ReadonlyMap<string, number>>(new Map());
  useEffect(() => {
    if (!active) return;
    let live = true;
    const pending = report.logins
      .filter((login) => !weakness.has(login.password))
      .slice(0, STRENGTH_BATCH);
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
  const weakLogins = report.logins.filter((login) => (weakness.get(login.password) ?? 3) < 2);
  const [breached, setBreached] = useState<ReadonlySet<string> | null>(null);

  // Remembered breach verdicts, once per visit; nothing is checked from here.
  useEffect(() => {
    if (!active || breached !== null) return;
    let live = true;
    const request = { version: 1 as const, kind: "security.listResults" as const };
    platform.sendMessage(request).then(
      (candidate) => {
        if (!live) return;
        const parsed = parseSecurityResponseForRequest(request, candidate);
        setBreached(
          new Set(
            parsed.success && parsed.data.kind === "security.results"
              ? parsed.data.results
                  .filter((result) => !result.stale && result.count > 0)
                  .map((result) => result.itemId)
              : [],
          ),
        );
      },
      () => {
        if (live) setBreached(new Set());
      },
    );
    return () => {
      live = false;
    };
  }, [active, breached, platform]);

  const breachedLogins = report.logins.filter((login) => breached?.has(login.id) === true);
  const reusedLogins = report.reused.flatMap((group) => group.logins);
  const health = computeHealthScore({
    logins: report.logins.length,
    weak: weakLogins.length,
    reused: reusedLogins.length,
    breached: breachedLogins.length,
    unsecured: report.unsecured.length,
    withoutTwoFactor: report.withoutTwoFactor.length,
  });

  const counts = new Map<VaultItemKind, number>();
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  const present = KINDS.map((kind) => ({ ...kind, count: counts.get(kind.kind) ?? 0 })).filter(
    (kind) => kind.count > 0,
  );
  const absent = KINDS.filter((kind) => (counts.get(kind.kind) ?? 0) === 0);

  const recent = [...items]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, RECENT);

  // Ordered by what it costs to ignore, not by how many there are: a single breached password
  // outranks a dozen weak ones. "No second factor" is deliberately not here -- it matches
  // nearly every login in most vaults, so as a queue row it says nothing about where to start.
  const findings: readonly Finding[] = (
    [
      {
        focus: "breached",
        severity: "critical",
        count: breachedLogins.length,
        title: plural(breachedLogins.length, "Breached password", "Breached passwords"),
        detail: `${namesOf(breachedLogins)} appeared in a known breach.`,
        action: "Replace",
      },
      {
        focus: "weak",
        severity: "warning",
        count: weakLogins.length,
        title: plural(weakLogins.length, "Weak password", "Weak passwords"),
        detail: `${namesOf(weakLogins)} could be guessed quickly.`,
        action: "Strengthen",
      },
      {
        focus: "reused",
        severity: "warning",
        count: reusedLogins.length,
        title: plural(reusedLogins.length, "Reused password", "Reused passwords"),
        detail: `${namesOf(reusedLogins)} share a password with another account.`,
        action: "Make unique",
      },
      {
        focus: "unsecured",
        severity: "warning",
        count: report.unsecured.length,
        title: plural(report.unsecured.length, "Unencrypted site", "Unencrypted sites"),
        detail: `${namesOf(report.unsecured)} ${plural(report.unsecured.length, "is", "are")} saved for a plain http:// address.`,
        action: "Check",
      },
      {
        focus: "passkeys",
        severity: "opportunity",
        count: report.passkeyReady.length,
        title: plural(
          report.passkeyReady.length,
          "Site accepts a passkey",
          "Sites accept passkeys",
        ),
        detail: `${namesOf(report.passkeyReady)} would take a passkey, which cannot be phished.`,
        action: "Set one up",
      },
    ] satisfies readonly Finding[]
  )
    .filter((finding) => finding.count > 0)
    .sort(
      (left, right) =>
        SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity] ||
        right.count - left.count ||
        left.title.localeCompare(right.title),
    );

  if (items.length === 0) {
    return (
      <div className={styles.view}>
        <section className={styles.welcome} aria-labelledby="overview-heading">
          <h3 id="overview-heading" className={styles.welcomeHeading}>
            Your vault is empty.
          </h3>
          <p className={styles.welcomeCopy}>
            Bring everything over from the manager you are leaving, or save the first login
            yourself. Either way it is encrypted here and stays on this device.
          </p>
          <div className={styles.actions}>
            <Button onClick={onOpenImport}>Import from another manager</Button>
            <Button variant="secondary" onClick={onNewLogin}>
              Save a login
            </Button>
          </div>
        </section>
      </div>
    );
  }

  const lastChange = recent[0] === undefined ? "" : whenLabel(recent[0].updatedAt);

  return (
    <div className={styles.view}>
      <header className={styles.header}>
        <div>
          <h3 id="overview-heading" className={styles.heading}>
            Overview
          </h3>
          <p className={styles.state}>
            <span className={styles.figure}>{items.length.toLocaleString("en-US")}</span>{" "}
            {plural(items.length, "item", "items")}
            {folderCount > 0
              ? ` in ${folderCount.toLocaleString("en-US")} ${plural(folderCount, "folder", "folders")}`
              : ""}
            {lastChange === "" ? "." : `, last changed ${lastChange}.`}
          </p>
        </div>
        <div className={styles.actions}>
          <Button onClick={onNewLogin}>New login</Button>
          <Button variant="secondary" onClick={onOpenGenerator}>
            Generate a password
          </Button>
        </div>
      </header>

      <div className={styles.board}>
        <section className={styles.queue} aria-labelledby="overview-queue">
          <div className={styles.queueHead}>
            <h4 id="overview-queue" className={styles.cardTitle}>
              {findings.length === 0 ? "Nothing needs attention" : "What to fix first"}
            </h4>
            <p className={styles.quiet}>
              {report.logins.length === 0
                ? "The score judges password logins, and there are none yet."
                : findings.length === 0
                  ? `All ${report.logins.length.toLocaleString("en-US")} password ${plural(report.logins.length, "login holds", "logins hold")} up.`
                  : `Across ${report.logins.length.toLocaleString("en-US")} password ${plural(report.logins.length, "login", "logins")}.`}
            </p>
          </div>

          {findings.length === 0 ? (
            <p className={styles.allClear}>
              <span className={styles.dot} data-severity="clear" aria-hidden="true" />
              {breached === null
                ? "Checking the passwords you have had checked before…"
                : "No breached, weak or reused passwords among them."}
            </p>
          ) : (
            <ul className={styles.list}>
              {findings.map((finding) => (
                <li key={finding.focus}>
                  <button
                    type="button"
                    className={styles.row}
                    onClick={() => onOpenHealth(finding.focus)}
                  >
                    <span
                      className={styles.dot}
                      data-severity={finding.severity}
                      aria-hidden="true"
                    />
                    <span className={styles.count}>{finding.count.toLocaleString("en-US")}</span>
                    <span className={styles.rowText}>
                      <span className={styles.rowTitle}>{finding.title}</span>
                      <span className={styles.rowDetail}>{finding.detail}</span>
                    </span>
                    <span className={styles.rowAction}>{finding.action}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className={styles.footnotes}>
            {report.withoutTwoFactor.length > 0 ? (
              <p className={styles.footnote}>
                {report.withoutTwoFactor.length.toLocaleString("en-US")}{" "}
                {plural(report.withoutTwoFactor.length, "login has", "logins have")} no second
                factor saved here.{" "}
                <button type="button" className={styles.link} onClick={() => onOpenHealth("2fa")}>
                  See which
                </button>
              </p>
            ) : null}
            {report.skipped > 0 ? (
              <p className={styles.footnote}>
                {report.skipped.toLocaleString("en-US")}{" "}
                {plural(report.skipped, "item is", "items are")} left out until you give your master
                password again.
              </p>
            ) : null}
          </div>
        </section>

        <div className={styles.side}>
          <section className={styles.score} aria-labelledby="overview-score">
            <h4 id="overview-score" className={styles.cardTitle}>
              Vault health
            </h4>
            <HealthGauge score={health.score} caption={health.caption} />
          </section>

          <section className={styles.composition} aria-labelledby="overview-composition">
            <h4 id="overview-composition" className={styles.cardTitle}>
              What is in the vault
            </h4>
            {present.length > 1 ? (
              <div className={styles.bar} aria-hidden="true">
                {present.map((kind) => (
                  <span
                    key={kind.kind}
                    className={styles.segment}
                    style={{ flexGrow: kind.count, background: kind.tint }}
                  />
                ))}
              </div>
            ) : null}
            <dl className={styles.legend}>
              {present.map((kind) => (
                <div className={styles.legendRow} key={kind.kind}>
                  <dt className={styles.legendLabel}>
                    <span
                      className={styles.swatch}
                      style={{ background: kind.tint }}
                      aria-hidden="true"
                    />
                    {kind.label}
                  </dt>
                  <dd className={styles.legendCount}>{kind.count.toLocaleString("en-US")}</dd>
                </div>
              ))}
            </dl>
            {absent.length > 0 ? (
              <p className={styles.quiet}>
                Empty so far: {absent.map((kind) => kind.label.toLowerCase()).join(", ")}.
              </p>
            ) : null}
          </section>
        </div>
      </div>

      <section className={styles.recent} aria-labelledby="overview-recent">
        <h4 id="overview-recent" className={styles.cardTitle}>
          Recently changed
        </h4>
        <ul className={styles.recentList}>
          {recent.map((item) => {
            const icon = item.kind === "login" ? faviconUrl(item.urls[0]) : undefined;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className={`${styles.row} ${styles.recentRow}`}
                  onClick={() => onOpenItem(item.id)}
                >
                  <span className={styles.rowIcon} aria-hidden="true">
                    {icon !== undefined ? (
                      <img className={styles.favicon} src={icon} alt="" width={16} height={16} />
                    ) : (
                      <Globe size={16} />
                    )}
                  </span>
                  <span className={styles.rowText}>
                    <span className={styles.rowTitle}>{itemDisplayName(item)}</span>
                    <span className={styles.rowDetail}>
                      {itemDisplaySubtitle(item) ?? KIND_LABEL[item.kind]}
                    </span>
                  </span>
                  <span className={styles.rowWhen}>{whenLabel(item.updatedAt)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
