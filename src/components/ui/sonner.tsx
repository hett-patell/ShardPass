import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

export function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      position="bottom-center"
      offset={12}
      duration={2400}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: [
            "group toast",
            "group-[.toaster]:bg-popover",
            "group-[.toaster]:text-foreground",
            "group-[.toaster]:border group-[.toaster]:border-border",
            "group-[.toaster]:shadow-[0_8px_24px_rgba(0,0,0,0.5)]",
            "group-[.toaster]:rounded-sm",
            "group-[.toaster]:text-[12px]",
            "group-[.toaster]:px-3 group-[.toaster]:py-2",
          ].join(" "),
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:rounded-sm group-[.toast]:font-medium",
          cancelButton:
            "group-[.toast]:bg-card group-[.toast]:text-muted-foreground group-[.toast]:rounded-sm",
        },
      }}
      {...props}
    />
  );
}
