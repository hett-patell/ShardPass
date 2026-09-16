import styles from "./HealthGauge.module.css";

export type HealthBand = "good" | "fair" | "poor";

export interface HealthGaugeProps {
  /** 0 to 100. */
  score: number;
  /** What the number is for; read out with it. */
  label?: string;
  /** A short verdict under the number ("Good", "Needs attention"). */
  caption?: string;
  size?: "md" | "lg";
}

export function healthBand(score: number): HealthBand {
  return score >= 80 ? "good" : score >= 50 ? "fair" : "poor";
}

const RADIUS = 46;
const CIRCUMFERENCE = Math.PI * RADIUS;

/** A half-ring that fills with the score, coloured by its band; the number sits in the arc. */
export function HealthGauge({
  score,
  label = "Health score",
  caption,
  size = "md",
}: HealthGaugeProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const band = healthBand(clamped);
  const filled = (CIRCUMFERENCE * clamped) / 100;
  return (
    <div
      className={`${styles.gauge} ${styles[band]} ${size === "lg" ? styles.large : ""}`}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-valuetext={caption ? `${clamped} out of 100, ${caption}` : `${clamped} out of 100`}
      aria-label={label}
    >
      <svg className={styles.ring} viewBox="0 0 120 66" aria-hidden="true">
        <path className={styles.track} d="M 14 60 A 46 46 0 0 1 106 60" />
        <path
          className={styles.fill}
          d="M 14 60 A 46 46 0 0 1 106 60"
          strokeDasharray={`${filled} ${CIRCUMFERENCE}`}
        />
      </svg>
      <span className={styles.value}>{clamped}</span>
      {caption ? <span className={styles.caption}>{caption}</span> : null}
    </div>
  );
}
