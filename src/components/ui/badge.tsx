import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.04em] leading-none [&_svg]:size-2.5",
  {
    variants: {
      variant: {
        default:
          "bg-[oklch(1_0_0/6%)] text-foreground/85 border border-white/[0.06]",
        primary:
          "bg-primary/15 text-[oklch(0.82_0.12_285)] border border-primary/25",
        success:
          "bg-[oklch(0.65_0.14_158/12%)] text-[oklch(0.78_0.14_158)] border border-[oklch(0.65_0.14_158/22%)]",
        warning:
          "bg-[oklch(0.75_0.14_80/12%)] text-[oklch(0.84_0.14_80)] border border-[oklch(0.75_0.14_80/22%)]",
        destructive:
          "bg-[oklch(0.62_0.18_22/12%)] text-[oklch(0.78_0.16_22)] border border-[oklch(0.62_0.18_22/24%)]",
        outline:
          "bg-transparent text-muted-foreground border border-white/[0.1]",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
