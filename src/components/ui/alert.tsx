import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative w-full rounded-lg border px-3.5 py-2.5 text-[12.5px] leading-relaxed",
  {
    variants: {
      variant: {
        default:
          "border-white/[0.07] bg-[oklch(1_0_0/3%)] text-foreground",
        destructive:
          "border-[oklch(0.62_0.18_22/22%)] bg-[oklch(0.62_0.18_22/8%)] text-[oklch(0.78_0.16_22)]",
        success:
          "border-[oklch(0.65_0.14_158/22%)] bg-[oklch(0.65_0.14_158/8%)] text-[oklch(0.78_0.14_158)]",
        warning:
          "border-[oklch(0.75_0.14_80/22%)] bg-[oklch(0.75_0.14_80/8%)] text-[oklch(0.84_0.14_80)]",
        info:
          "border-white/[0.05] bg-[oklch(1_0_0/2%)] text-muted-foreground",
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
