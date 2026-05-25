import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap",
    "rounded-sm text-[12.5px] font-medium",
    "transition-[background,border-color,color,box-shadow] duration-100",
    "outline-none disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
    "focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background",
  ].join(" "),
  {
    variants: {
      variant: {
        default: [
          "bg-primary text-primary-foreground border border-primary",
          "hover:bg-[#ff6749] hover:border-[#ff6749]",
        ].join(" "),
        secondary: [
          "bg-card text-foreground border border-border",
          "hover:bg-elevated hover:border-border-strong",
        ].join(" "),
        outline: [
          "border border-border bg-transparent text-foreground",
          "hover:bg-card hover:border-border-strong",
        ].join(" "),
        ghost: [
          "text-muted-foreground bg-transparent border border-transparent",
          "hover:bg-card hover:text-foreground",
        ].join(" "),
        destructive: [
          "bg-transparent text-destructive border border-destructive/40",
          "hover:bg-destructive/10 hover:border-destructive/60",
        ].join(" "),
        link: "text-muted-foreground underline-offset-4 hover:text-foreground hover:underline border border-transparent",
      },
      size: {
        default: "h-8 px-3",
        sm: "h-7 px-2.5 text-[12px] [&_svg]:size-3",
        lg: "h-9 px-4 text-[13px]",
        icon: "h-8 w-8",
        "icon-sm": "h-7 w-7 [&_svg]:size-3.5",
        "icon-xs": "h-6 w-6 [&_svg]:size-3",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { buttonVariants };
