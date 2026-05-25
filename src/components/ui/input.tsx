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
        "flex h-9 w-full rounded-lg border border-white/[0.07] bg-[oklch(1_0_0/3%)] px-3",
        "text-[13.5px] text-foreground outline-none transition-[border-color,background,box-shadow] duration-150",
        "placeholder:text-muted-foreground/55",
        "focus-visible:border-primary/45 focus-visible:bg-[oklch(1_0_0/5%)] focus-visible:ring-2 focus-visible:ring-primary/15",
        "hover:border-white/[0.11]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "file:border-0 file:bg-transparent file:text-[13px] file:font-medium",
        className,
      )}
      {...props}
    />
  );
});
Input.displayName = "Input";
