import styles from "./OtpList.module.css";

export interface OtpCountdownProps {
  remaining: number;
  period: number;
  urgentAt: number;
}

export function OtpCountdown({ remaining, period, urgentAt }: OtpCountdownProps) {
  const boundedPeriod = Math.max(1, period);
  const boundedRemaining = Math.max(0, Math.min(remaining, boundedPeriod));
  const offset = ((boundedPeriod - boundedRemaining) / boundedPeriod) * 100;
  const urgent = boundedRemaining <= urgentAt;

  return (
    <span
      className={styles.countdown}
      data-urgent={String(urgent)}
      data-testid="otp-countdown"
      aria-hidden="true"
    >
      <svg viewBox="0 0 36 36" focusable="false">
        <circle className={styles.countdownTrack} cx="18" cy="18" r="15.9" />
        <circle
          className={styles.countdownRing}
          data-testid="otp-countdown-ring"
          cx="18"
          cy="18"
          r="15.9"
          pathLength="100"
          strokeDasharray="100"
          strokeDashoffset={String(offset)}
        />
      </svg>
      <span>{boundedRemaining}</span>
    </span>
  );
}
