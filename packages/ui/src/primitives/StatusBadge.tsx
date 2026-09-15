import { CircleAlert, CircleCheck, CircleDot, Info, TriangleAlert } from "lucide-react";
import { cloneElement } from "react";
import type { ReactElement, ReactNode, SVGProps } from "react";

import styles from "./primitives.module.css";

export type Status = "neutral" | "success" | "warning" | "error" | "info";

const defaultIcons: Record<Status, ReactElement<SVGProps<SVGSVGElement>>> = {
  neutral: <CircleDot />,
  success: <CircleCheck />,
  warning: <TriangleAlert />,
  error: <CircleAlert />,
  info: <Info />,
};

export interface StatusBadgeProps {
  children: ReactNode;
  className?: string;
  icon?: ReactElement<SVGProps<SVGSVGElement>>;
  status?: Status;
  /** Announce changes (a live region): for the one badge that reports a changing state. */
  live?: boolean;
}

export function StatusBadge({
  children,
  className,
  icon,
  status = "neutral",
  live = false,
}: StatusBadgeProps) {
  const statusIcon = cloneElement(icon ?? defaultIcons[status], { "aria-hidden": true });

  return (
    <span
      className={[styles.badge, styles[status], className].filter(Boolean).join(" ")}
      role={live ? "status" : undefined}
      data-status={status}
    >
      {statusIcon}
      <span>{children}</span>
    </span>
  );
}
