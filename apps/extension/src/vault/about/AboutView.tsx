import { Button, ShardPassMark } from "@shardpass/ui";
import { Code2, ExternalLink, Globe, Star, UserPlus } from "lucide-react";

import styles from "./AboutView.module.css";

const WEBSITE = "https://networkshard.com";
const GITHUB_USER = "https://github.com/hett-patell";
const GITHUB_REPOS = "https://github.com/hett-patell?tab=repositories";

/** The version the browser loaded, when the page runs inside the extension. */
function loadedVersion(): string | null {
  const runtime = (
    globalThis as { chrome?: { runtime?: { getManifest?: () => { version?: unknown } } } }
  ).chrome?.runtime;
  try {
    const version = runtime?.getManifest?.().version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

/** Who made ShardPass, where to follow it, and what it promises about your data. */
export function AboutView() {
  const version = loadedVersion();
  return (
    <section className={styles.view} aria-labelledby="about-heading">
      <header className={styles.hero}>
        <ShardPassMark width={56} height={56} aria-hidden="true" />
        <div>
          <h3 id="about-heading" className={styles.heading}>
            ShardPass
          </h3>
          <p className={styles.copy}>
            A local-first password manager for the browser.
            {version !== null ? ` Version ${version}.` : ""}
          </p>
        </div>
      </header>

      <div className={styles.grid}>
        <section className={styles.card} aria-labelledby="about-developer">
          <h4 id="about-developer" className={styles.cardTitle}>
            Developer
          </h4>
          <p className={styles.copy}>
            Made by <strong>Het Patel</strong>, the developer behind Network Shard. ShardPass is
            built and reviewed with Claude, Anthropic's AI, working alongside him on the code.
          </p>
          <div className={styles.links}>
            <a className={styles.link} href={WEBSITE} target="_blank" rel="noreferrer">
              <Globe size={16} aria-hidden="true" />
              networkshard.com
              <ExternalLink size={12} aria-hidden="true" />
            </a>
            <a className={styles.link} href={GITHUB_USER} target="_blank" rel="noreferrer">
              <Code2 size={16} aria-hidden="true" />
              github.com/hett-patell
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          </div>
        </section>

        <section className={styles.card} aria-labelledby="about-updates">
          <h4 id="about-updates" className={styles.cardTitle}>
            Updates
          </h4>
          <p className={styles.copy}>
            New versions, fixes and the other Shard projects land on GitHub first. Follow the
            account for regular updates, and a star on the repositories helps other people find
            them.
          </p>
          <div className={styles.actions}>
            <Button onClick={() => window.open(GITHUB_USER, "_blank", "noreferrer")}>
              <UserPlus size={14} aria-hidden="true" /> Follow on GitHub
            </Button>
            <Button
              variant="secondary"
              onClick={() => window.open(GITHUB_REPOS, "_blank", "noreferrer")}
            >
              <Star size={14} aria-hidden="true" /> Star the repositories
            </Button>
          </div>
        </section>

        <section className={styles.card} aria-labelledby="about-privacy">
          <h4 id="about-privacy" className={styles.cardTitle}>
            Your data
          </h4>
          <ul className={styles.facts}>
            <li>
              Everything is encrypted on this device with a key derived from your master password.
            </li>
            <li>
              Nothing leaves the device unless you turn a feature on: Ente sync, breach checks, or
              DuckDuckGo aliases.
            </li>
            <li>Site icons come from the browser's own cache, never from a third party.</li>
            <li>Open source under the MIT licence.</li>
          </ul>
        </section>
      </div>
    </section>
  );
}
