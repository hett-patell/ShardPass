import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative w-full rounded-xl border px-4 py-3 text-[13px] leading-relaxed",
  {
    variants: {
      variant: {
        default: "border-white/[0.06] bg-card text-card-foreground",
        destructive:
          "border-destructive/20 bg-destructive/8 text-destructive",
        success: "border-emerald-500/15 bg-emerald-500/6 text-emerald-300",
        info: "border-white/[0.04] bg-white/[0.02] text-muted-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export const Alert = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>
>(({ className, variant, ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(alertVariants({ variant }), className)}
    {...props}
  />
));
Alert.displayName = "Alert";
