import type { VaultItem, VaultItemKind } from "@shardpass/domain";
import { parseSecurityResponseForRequest } from "@shardpass/messaging";
import { Button, HealthGauge } from "@shardpass/ui";
import {
  CreditCard,
  FolderClosed,
  Globe,
  KeyRound,
  Lock,
  StickyNote,
  User,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { ExtensionPlatform } from "../../platform/extension-platform";
import { faviconUrl } from "../../platform/favicon";
import { passwordStrength } from "../../vault-access/password-strength";
import { computeHealth } from "../health/health-report";
import { computeHealthScore } from "../health/health-score";
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
  onOpenHealth: () => void;
  onOpenGenerator: () => void;
  onOpenImport: () => void;
  onNewLogin: () => void;
}

const KINDS: readonly Readonly<{ kind: VaultItemKind; label: string; icon: LucideIcon }>[] = [
  { kind: "login", label: "Logins", icon: Globe },
  { kind: "otp", label: "One-time codes", icon: KeyRound },
  { kind: "note", label: "Notes", icon: StickyNote },
  { kind: "card", label: "Cards", icon: CreditCard },
  { kind: "identity", label: "Identities", icon: User },
  { kind: "secret", label: "Secrets", icon: Lock },
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
/** Quick strength is cheap, but a vault of thousands still deserves a bound per render. */
const STRENGTH_BATCH = 2_000;

/** The vault at a glance: a health score, what is in it, what needs a look, what changed last. */
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
  const weak = useMemo(
    () =>
      report.logins
        .slice(0, STRENGTH_BATCH)
        .filter((login) => passwordStrength(login.password).level < 2).length,
    [report.logins],
  );
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

  const loginIds = useMemo(() => new Set(report.logins.map((login) => login.id)), [report.logins]);
  const breachedCount = [...(breached ?? [])].filter((id) => loginIds.has(id)).length;
  const reusedCount = report.reused.reduce((sum, group) => sum + group.logins.length, 0);
  const health = computeHealthScore({
    logins: report.logins.length,
    weak,
    reused: reusedCount,
    breached: breachedCount,
    unsecured: report.unsecured.length,
    withoutTwoFactor: report.withoutTwoFactor.length,
  });
  const counts = new Map<VaultItemKind, number>();
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  const recent = [...items]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, RECENT);
  const attention: readonly Readonly<{ label: string; count: number }>[] = [
    { label: "Breached passwords", count: breachedCount },
    { label: "Weak passwords", count: weak },
    { label: "Reused passwords", count: reusedCount },
    { label: "Unencrypted sites", count: report.unsecured.length },
    { label: "No second factor", count: report.withoutTwoFactor.length },
    { label: "Passkeys available", count: report.passkeyReady.length },
  ];
  const findings = attention.filter((entry) => entry.count > 0);

  return (
    <div className={styles.view}>
      <header className={styles.header}>
        <h3 id="overview-heading" className={styles.heading}>
          Overview
        </h3>
        <p className={styles.copy}>
          {items.length === 0
            ? "An empty vault. Save a login, or import from another manager."
            : `${items.length.toLocaleString("en-US")} ${items.length === 1 ? "item" : "items"} in ${folderCount.toLocaleString("en-US")} ${folderCount === 1 ? "folder" : "folders"}.`}
        </p>
      </header>

      <div className={styles.stats}>
        <section className={`${styles.card} ${styles.gaugeCard}`} aria-labelledby="overview-health">
          <h4 id="overview-health" className={styles.cardTitle}>
            Health
          </h4>
          <HealthGauge score={health.score} caption={health.caption} size="lg" />
          <p className={styles.quiet}>
            {report.logins.length === 0
              ? "The score reflects your password logins; there are none yet."
              : findings.length === 0
                ? `All ${report.logins.length.toLocaleString("en-US")} password logins look fine.`
                : findings
                    .map((entry) => `${entry.count} ${entry.label.toLowerCase()}`)
                    .join(" · ")}
          </p>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={onOpenHealth}>
              Open health check
            </Button>
          </div>
        </section>

        {KINDS.map(({ kind, label, icon: Icon }) => (
          <section key={kind} className={`${styles.card} ${styles.stat}`} aria-label={label}>
            <span className={styles.statIcon} aria-hidden="true">
              <Icon size={18} />
            </span>
            <span className={styles.statValue}>
              {(counts.get(kind) ?? 0).toLocaleString("en-US")}
            </span>
            <span className={styles.statLabel}>{label}</span>
          </section>
        ))}
        <section className={`${styles.card} ${styles.stat}`} aria-label="Folders">
          <span className={styles.statIcon} aria-hidden="true">
            <FolderClosed size={18} />
          </span>
          <span className={styles.statValue}>{folderCount.toLocaleString("en-US")}</span>
          <span className={styles.statLabel}>Folders</span>
        </section>
      </div>

      <div className={styles.panels}>
        <section className={`${styles.card} ${styles.panel}`} aria-labelledby="overview-attention">
          <h4 id="overview-attention" className={styles.cardTitle}>
            Needs a look
          </h4>
          {findings.length === 0 ? (
            <p className={styles.quiet}>
              {breached === null ? "Looking…" : "Nothing at the moment."}
            </p>
          ) : (
            <ul className={styles.list}>
              {findings.map((entry) => (
                <li key={entry.label} className={styles.row}>
                  <button type="button" className={styles.open} onClick={onOpenHealth}>
                    <span className={styles.rowLabel}>{entry.label}</span>
                    <span className={styles.rowCount}>{entry.count.toLocaleString("en-US")}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`${styles.card} ${styles.panel}`} aria-labelledby="overview-recent">
          <h4 id="overview-recent" className={styles.cardTitle}>
            Recently changed
          </h4>
          {recent.length === 0 ? (
            <p className={styles.quiet}>Nothing yet.</p>
          ) : (
            <ul className={styles.list}>
              {recent.map((item) => {
                const icon = item.kind === "login" ? faviconUrl(item.urls[0]) : undefined;
                return (
                  <li key={item.id} className={styles.row}>
                    <button
                      type="button"
                      className={styles.open}
                      onClick={() => onOpenItem(item.id)}
                    >
                      <span className={styles.rowIcon} aria-hidden="true">
                        {icon !== undefined ? (
                          <img
                            className={styles.favicon}
                            src={icon}
                            alt=""
                            width={16}
                            height={16}
                          />
                        ) : (
                          <Globe size={16} />
                        )}
                      </span>
                      <span className={styles.rowText}>
                        <span className={styles.rowLabel}>{itemDisplayName(item)}</span>
                        <span className={styles.rowSub}>
                          {itemDisplaySubtitle(item) ?? KIND_LABEL[item.kind]}
                        </span>
                      </span>
                      <span className={styles.rowWhen}>{whenLabel(item.updatedAt)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className={`${styles.card} ${styles.panel}`} aria-labelledby="overview-actions">
          <h4 id="overview-actions" className={styles.cardTitle}>
            Quick actions
          </h4>
          <div className={styles.quickActions}>
            <Button onClick={onNewLogin}>New login</Button>
            <Button variant="secondary" onClick={onOpenGenerator}>
              Generate a password
            </Button>
            <Button variant="secondary" onClick={onOpenImport}>
              Import from another manager
            </Button>
            <Button variant="secondary" onClick={onOpenHealth}>
              Run the health check
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
