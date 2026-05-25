import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative w-full rounded-sm border-l-2 px-3 py-2 text-[12px] leading-relaxed",
  {
    variants: {
      variant: {
        default:
          "border-l-border-strong bg-card text-foreground",
        destructive:
          "border-l-destructive bg-destructive/8 text-destructive",
        success:
          "border-l-success bg-success/8 text-success",
        warning:
          "border-l-warning bg-warning/8 text-warning",
        info:
          "border-l-muted-foreground bg-card text-muted-foreground",
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
