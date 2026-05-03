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
        "flex h-9 w-full rounded-md border border-border bg-input/30 px-3 text-[12.5px] text-foreground outline-none transition-colors",
        "placeholder:text-muted-foreground/70",
        "focus:border-border/60 focus:bg-input/50 focus:ring-2 focus:ring-ring/30",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "file:border-0 file:bg-transparent file:text-[12.5px] file:font-medium",
        className,
      )}
      {...props}
    />
  );
});
Input.displayName = "Input";
