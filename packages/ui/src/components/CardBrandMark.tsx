import type { CardBrand } from "@shardpass/domain";

import styles from "./CardBrandMark.module.css";

export const CARD_BRAND_NAMES: Record<CardBrand, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
  jcb: "JCB",
  unionpay: "UnionPay",
  other: "Card",
};

export interface CardBrandMarkProps {
  brand: CardBrand;
  /** Height in pixels; the mark keeps a 3:2 card shape. */
  size?: number;
  className?: string;
}

/**
 * A small mark for a card network, drawn here rather than shipped as the network's own
 * artwork: colours and shapes that read at a glance, with the name for screen readers.
 */
export function CardBrandMark({ brand, size = 20, className }: CardBrandMarkProps) {
  const width = Math.round(size * 1.5);
  const classes = [styles.mark, styles[brand], className].filter(Boolean).join(" ");
  const label = CARD_BRAND_NAMES[brand];
  return (
    <svg
      className={classes}
      width={width}
      height={size}
      viewBox="0 0 48 32"
      role="img"
      aria-label={label}
    >
      <rect className={styles.face} x="0.5" y="0.5" width="47" height="31" rx="5" />
      {brand === "mastercard" ? (
        <>
          <circle className={styles.leftCircle} cx="19" cy="16" r="9" />
          <circle className={styles.rightCircle} cx="29" cy="16" r="9" />
        </>
      ) : brand === "jcb" ? (
        <>
          <rect className={styles.stripeA} x="10" y="7" width="8" height="18" rx="2" />
          <rect className={styles.stripeB} x="20" y="7" width="8" height="18" rx="2" />
          <rect className={styles.stripeC} x="30" y="7" width="8" height="18" rx="2" />
        </>
      ) : brand === "unionpay" ? (
        <>
          <rect className={styles.stripeA} x="8" y="7" width="12" height="18" rx="2" />
          <rect className={styles.stripeB} x="18" y="7" width="12" height="18" rx="2" />
          <rect className={styles.stripeC} x="28" y="7" width="12" height="18" rx="2" />
        </>
      ) : brand === "discover" ? (
        <>
          <text className={styles.text} x="6" y="20" fontSize="8">
            DISC
          </text>
          <circle className={styles.dot} cx="38" cy="16" r="5" />
        </>
      ) : brand === "other" ? (
        <>
          <rect className={styles.chip} x="8" y="9" width="10" height="7" rx="1.5" />
          <rect className={styles.line} x="8" y="21" width="32" height="3" rx="1.5" />
        </>
      ) : (
        <text
          className={styles.text}
          x="24"
          y="21"
          fontSize={brand === "visa" ? 13 : 10}
          textAnchor="middle"
        >
          {brand === "visa" ? "VISA" : "AMEX"}
        </text>
      )}
    </svg>
  );
}
