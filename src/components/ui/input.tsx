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
        "flex h-8 w-full rounded-sm border border-border bg-card px-2.5",
        "text-[13px] text-foreground outline-none transition-[border-color,background] duration-100",
        "placeholder:text-muted-foreground/60",
        "hover:border-border-strong",
        "focus-visible:border-primary focus-visible:bg-elevated",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "file:border-0 file:bg-transparent file:text-[12.5px] file:font-medium",
        className,
      )}
      {...props}
    />
  );
});
Input.displayName = "Input";
