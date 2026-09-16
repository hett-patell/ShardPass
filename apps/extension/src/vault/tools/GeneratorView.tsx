import { useEffect, useRef, useState } from "react";

import type { ExtensionPlatform } from "../../platform/extension-platform";
import { GeneratorScreen, type GeneratorMode } from "../../popup/screens/GeneratorScreen";
import { copyWithAutoClear } from "../components/detail/clipboard";
import styles from "../VaultApp.module.css";

export interface GeneratorViewProps {
  platform: Pick<ExtensionPlatform, "sendMessage">;
  /** Which tab opens: a password (random or passphrase) or a username. */
  mode: GeneratorMode;
}

const NOTICE_MS = 4_000;

/** The popup's generator, given room on the vault page; a copy clears itself like every other. */
export function GeneratorView({ platform, mode }: GeneratorViewProps) {
  const [notice, setNotice] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onCopy = (value: string, label: string) => {
    copyWithAutoClear(value).then(
      () => announce(`${label} copied. The clipboard clears itself in a moment.`),
      () => announce(`Could not copy the ${label.toLowerCase()}. Select it and copy by hand.`),
    );
  };
  const announce = (text: string) => {
    setNotice(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(""), NOTICE_MS);
  };

  return (
    <section className={styles.settingsCard} aria-labelledby="generator-heading">
      <h2 id="generator-heading" className={styles.settingsCardTitle}>
        {mode === "username" ? "Username generator" : "Password generator"}
      </h2>
      <p className={styles.settingsCardCopy}>
        {mode === "username"
          ? "A name or address for a new account: two words, random letters, a plus-address on your own e-mail, or an address on a catch-all domain."
          : "A random password or a passphrase, made on this device. Nothing is sent anywhere."}
      </p>
      <GeneratorScreen key={mode} platform={platform} onCopy={onCopy} initialMode={mode} />
      <p className={styles.settingsCardCopy} role="status" aria-live="polite">
        {notice}
      </p>
    </section>
  );
}
