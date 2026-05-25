import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] leading-none font-mono [&_svg]:size-2.5",
  {
    variants: {
      variant: {
        default:
          "bg-card text-muted-foreground border border-border",
        primary:
          "bg-primary/10 text-primary border border-primary/30",
        success:
          "bg-success/10 text-success border border-success/30",
        warning:
          "bg-warning/10 text-warning border border-warning/30",
        destructive:
          "bg-destructive/10 text-destructive border border-destructive/30",
        outline:
          "bg-transparent text-muted-foreground border border-border",
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
