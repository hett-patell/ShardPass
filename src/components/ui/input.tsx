import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, type, ...props }, ref) => {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-11 w-full rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 text-[14px] text-foreground outline-none transition-all",
        "placeholder:text-muted-foreground/50",
        "focus:border-primary/30 focus:bg-white/[0.05] focus:ring-2 focus:ring-primary/10",
        "hover:border-white/[0.1]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "file:border-0 file:bg-transparent file:text-[14px] file:font-medium",
        className,
      )}
      {...props}
    />
  );
});
Input.displayName = "Input";
