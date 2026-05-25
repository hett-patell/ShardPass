import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

export function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      position="bottom-center"
      offset={16}
      duration={2400}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: [
            "group toast",
            "group-[.toaster]:bg-[oklch(0.205_0.012_283)]",
            "group-[.toaster]:text-foreground",
            "group-[.toaster]:border group-[.toaster]:border-white/[0.08]",
            "group-[.toaster]:shadow-[0_8px_24px_oklch(0_0_0/55%),inset_0_1px_0_oklch(1_0_0/6%)]",
            "group-[.toaster]:rounded-lg",
            "group-[.toaster]:text-[12.5px]",
            "group-[.toaster]:px-3 group-[.toaster]:py-2.5",
          ].join(" "),
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:rounded-md",
          cancelButton:
            "group-[.toast]:bg-[oklch(1_0_0/8%)] group-[.toast]:text-muted-foreground group-[.toast]:rounded-md",
        },
      }}
      {...props}
    />
  );
}
