import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    "rounded-lg text-[13px] font-medium tracking-[-0.005em]",
    "transition-[background,border-color,color,box-shadow,transform] duration-150",
    "outline-none disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0",
    "active:scale-[0.98]",
  ].join(" "),
  {
    variants: {
      variant: {
        default: [
          "bg-primary text-primary-foreground",
          "shadow-[inset_0_1px_0_oklch(1_0_0/12%),0_1px_2px_oklch(0_0_0/30%)]",
          "hover:bg-[oklch(0.72_0.14_285)]",
        ].join(" "),
        secondary: [
          "bg-[oklch(1_0_0/5%)] text-foreground border border-white/[0.06]",
          "hover:bg-[oklch(1_0_0/8%)] hover:border-white/[0.1]",
        ].join(" "),
        outline: [
          "border border-white/[0.09] bg-transparent text-foreground",
          "hover:bg-[oklch(1_0_0/4%)] hover:border-white/[0.14]",
        ].join(" "),
        ghost: [
          "text-muted-foreground bg-transparent",
          "hover:bg-[oklch(1_0_0/5%)] hover:text-foreground",
        ].join(" "),
        destructive: [
          "bg-[oklch(0.62_0.18_22/12%)] text-destructive border border-[oklch(0.62_0.18_22/20%)]",
          "hover:bg-[oklch(0.62_0.18_22/18%)] hover:border-[oklch(0.62_0.18_22/28%)]",
        ].join(" "),
        link: "text-muted-foreground underline-offset-4 hover:text-foreground hover:underline",
      },
      size: {
        default: "h-9 px-3.5",
        sm: "h-8 px-3 text-[12.5px] [&_svg]:size-3.5",
        lg: "h-10 px-5 text-[14px]",
        icon: "h-9 w-9",
        "icon-sm": "h-8 w-8 [&_svg]:size-4",
        "icon-xs": "h-7 w-7 [&_svg]:size-3.5",
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
