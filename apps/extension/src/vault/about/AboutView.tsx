import { Button, ShardPassMark } from "@shardpass/ui";
import { Code2, ExternalLink, Globe, Keyboard, KeyRound, Lock, Star, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";

import styles from "./AboutView.module.css";

const WEBSITE = "https://networkshard.com";
const GITHUB_USER = "https://github.com/hett-patell";
const GITHUB_REPOS = "https://github.com/hett-patell?tab=repositories";
const SHORTCUTS_PAGE = "chrome://extensions/shortcuts";

interface ExtensionCommand {
  readonly name: string;
  readonly description: string;
  readonly shortcut: string;
}

interface RuntimeApi {
  readonly runtime?: { getManifest?: () => { version?: unknown } };
  readonly commands?: { getAll?: () => Promise<readonly unknown[]> };
  readonly tabs?: { create?: (properties: { url: string }) => unknown };
}

function chromeApi(): RuntimeApi | undefined {
  return (globalThis as { chrome?: RuntimeApi }).chrome;
}

/** The version the browser loaded, when the page runs inside the extension. */
function loadedVersion(): string | null {
  try {
    const version = chromeApi()?.runtime?.getManifest?.().version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

function readCommand(candidate: unknown): ExtensionCommand | null {
  if (typeof candidate !== "object" || candidate === null) return null;
  const value = candidate as { name?: unknown; description?: unknown; shortcut?: unknown };
  if (typeof value.name !== "string") return null;
  // Chrome hands back the browser-action command with no description of its own, and a row
  // with no name is worse than no row: it is named here instead of dropped.
  const described = typeof value.description === "string" ? value.description : "";
  const description =
    described !== "" ? described : value.name === "_execute_action" ? "Open ShardPass" : "";
  if (description === "") return null;
  return {
    name: value.name,
    description,
    shortcut: typeof value.shortcut === "string" ? value.shortcut : "",
  };
}

/**
 * The shortcuts as this browser has them, not as the manifest asked: a person can change or
 * clear any of them, and a page that printed the suggested keys would be wrong for them.
 */
function useCommands(): readonly ExtensionCommand[] {
  const [commands, setCommands] = useState<readonly ExtensionCommand[]>([]);
  useEffect(() => {
    let current = true;
    try {
      const all = chromeApi()?.commands?.getAll?.();
      if (all === undefined) return;
      void Promise.resolve(all).then(
        (list) => {
          if (!current) return;
          setCommands(
            list.map(readCommand).filter((item): item is ExtensionCommand => item !== null),
          );
        },
        () => {
          /* The list is a convenience; its absence leaves the card's own copy standing. */
        },
      );
    } catch {
      /* Older browsers and the test renderer have no commands API. */
    }
    return () => {
      current = false;
    };
  }, []);
  return commands;
}

/** Opens a browser page the extension may not link to directly, where that is allowed. */
function openShortcutSettings(): void {
  try {
    chromeApi()?.tabs?.create?.({ url: SHORTCUTS_PAGE });
  } catch {
    /* Nothing to do: the address is printed beside the button. */
  }
}

/** What ShardPass is, how to drive it, what it promises about your data, and who made it. */
export function AboutView() {
  const version = loadedVersion();
  const commands = useCommands();
  return (
    <section className={styles.view} aria-labelledby="about-heading">
      <header className={styles.hero}>
        <ShardPassMark width={56} height={56} aria-hidden="true" />
        <div className={styles.heroText}>
          <h3 id="about-heading" className={styles.heading}>
            ShardPass
          </h3>
          <p className={styles.copy}>
            A password manager that keeps your vault on this device. It fills logins, one-time codes
            and passkeys as you browse, and asks before it saves anything.
          </p>
          <ul className={styles.meta}>
            {version !== null ? <li className={styles.chip}>Version {version}</li> : null}
            <li className={styles.chip}>MIT licence</li>
            <li className={styles.chip}>Chrome and Brave</li>
          </ul>
        </div>
      </header>

      <div className={styles.grid}>
        <section className={styles.card} aria-labelledby="about-what">
          <h4 id="about-what" className={styles.cardTitle}>
            <KeyRound size={16} aria-hidden="true" />
            What it keeps
          </h4>
          <ul className={styles.facts}>
            <li>Logins, passkeys and one-time codes, filled on the page you are on.</li>
            <li>Cards, identities, notes, API credentials and SSH keys.</li>
            <li>Generators for passwords, usernames and email aliases.</li>
            <li>Folders, favourites, archive, and a health report over the whole vault.</li>
            <li>Imports from Chrome, 1Password, Bitwarden, LastPass and nine more.</li>
            <li>Encrypted backups you can restore into a new browser profile.</li>
          </ul>
        </section>

        <section className={styles.card} aria-labelledby="about-security">
          <h4 id="about-security" className={styles.cardTitle}>
            <Lock size={16} aria-hidden="true" />
            How it is protected
          </h4>
          <ul className={styles.facts}>
            <li>
              Your master password derives the key with Argon2id (64&nbsp;MiB, two passes); the
              password itself is never stored.
            </li>
            <li>Items are encrypted with XChaCha20-Poly1305 before they are written to disk.</li>
            <li>The key lives in the extension&rsquo;s background worker, never in a web page.</li>
            <li>The vault locks on your timer, when the screen locks, and on demand.</li>
            <li>A PIN can stand in for this browser profile; five wrong tries remove it.</li>
            <li>Copied passwords are cleared from the clipboard a short while later.</li>
          </ul>
        </section>

        <section className={styles.card} aria-labelledby="about-privacy">
          <h4 id="about-privacy" className={styles.cardTitle}>
            <Globe size={16} aria-hidden="true" />
            Your data
          </h4>
          <ul className={styles.facts}>
            <li>The vault is stored on this device and nowhere else by default.</li>
            <li>
              Nothing leaves it unless you turn a feature on: Ente sync, breach checks, or
              DuckDuckGo aliases.
            </li>
            <li>
              Breach checks send the first five characters of a password&rsquo;s hash, never the
              password.
            </li>
            <li>Site icons come from the browser&rsquo;s own cache, never from a third party.</li>
            <li>No analytics, no accounts, no telemetry of any kind.</li>
          </ul>
        </section>

        <section className={styles.card} aria-labelledby="about-developer">
          <h4 id="about-developer" className={styles.cardTitle}>
            <Code2 size={16} aria-hidden="true" />
            Developer
          </h4>
          <p className={styles.copy}>
            Made by <strong>Het Patel</strong>, the developer behind Network Shard. ShardPass is
            built and reviewed with Claude, Anthropic&rsquo;s AI, working alongside him on the code.
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
            <Star size={16} aria-hidden="true" />
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
        <section className={styles.card} aria-labelledby="about-shortcuts">
          <h4 id="about-shortcuts" className={styles.cardTitle}>
            <Keyboard size={16} aria-hidden="true" />
            Keyboard shortcuts
          </h4>
          {commands.length > 0 ? (
            <dl className={styles.shortcuts}>
              {commands.map((command) => (
                <div className={styles.shortcutRow} key={command.name}>
                  <dt className={styles.shortcutName}>{command.description}</dt>
                  <dd className={styles.shortcutKeys}>
                    {command.shortcut === "" ? (
                      <span className={styles.unset}>Not set</span>
                    ) : (
                      <kbd className={styles.kbd}>{command.shortcut}</kbd>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className={styles.copy}>
              Open ShardPass, lock it, and fill the login for the page each have a shortcut of their
              own in the browser&rsquo;s settings.
            </p>
          )}
          <div className={styles.actions}>
            <Button variant="secondary" onClick={openShortcutSettings}>
              Change shortcuts
            </Button>
          </div>
          <p className={styles.footnote}>
            Or open <code className={styles.code}>{SHORTCUTS_PAGE}</code> yourself.
          </p>
        </section>
      </div>
    </section>
  );
}
