import { useEffect, useState } from "react";

import { faviconUrl } from "../../platform/favicon";
import styles from "./SiteTile.module.css";

export interface SiteTileProps {
  name: string;
  url?: string | undefined;
  size?: number;
}

/** A hue from the name, so the same login always gets the same colour. */
export function hueOf(name: string): number {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return hash % 360;
}

/** The first letters of the first two words ("Google Workspace" → "GW"). */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/u)
    .filter((word) => word !== "");
  const first = words[0]?.charAt(0) ?? "";
  const second = words[1]?.charAt(0) ?? words[0]?.charAt(1) ?? "";
  return (first + second).toUpperCase() || "?";
}

/**
 * The site's own icon when the browser has one, else a tile with the login's initials in a
 * colour of its own, the way a logo would identify it at a glance.
 */
export function SiteTile({ name, url, size = 32 }: SiteTileProps) {
  const icon = faviconUrl(url, size >= 40 ? 64 : 32);
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [icon]);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  if (icon !== undefined && !broken)
    return (
      <span className={styles.tile} style={style} aria-hidden="true">
        <img
          className={styles.favicon}
          src={icon}
          alt=""
          width={Math.round(size * 0.6)}
          height={Math.round(size * 0.6)}
          onError={() => setBroken(true)}
        />
      </span>
    );
  return (
    <span
      className={`${styles.tile} ${styles.initials}`}
      style={{ ...style, ["--tile-hue" as string]: hueOf(name) }}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  );
}
