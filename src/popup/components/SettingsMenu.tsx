import { useEffect, useState } from "react";
import { send } from "@/lib/messages";
import type { Settings } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";

const TIMER_OPTIONS = [
  { v: "0", label: "Off" },
  { v: "5", label: "5 minutes" },
  { v: "15", label: "15 minutes" },
  { v: "30", label: "30 minutes" },
  { v: "60", label: "1 hour" },
];

export function SettingsMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void send<Settings>({ kind: "getSettings" }).then((res) => {
      if (res.ok) setSettings(res.data);
    });
  }, [open]);

  async function updateAutoLock(autoLockMinutes: number) {
    setBusy(true);
    const res = await send<Settings>({
      kind: "updateSettings",
      autoLockMinutes,
    });
    setBusy(false);
    if (res.ok) setSettings(res.data);
  }

  async function updateScreenLock(lockOnScreenLock: boolean) {
    setBusy(true);
    const res = await send<Settings>({
      kind: "updateSettings",
      lockOnScreenLock,
    });
    setBusy(false);
    if (res.ok) setSettings(res.data);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Auto-lock behavior and vault security.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-0.5">
              <div className="text-[12.5px] font-medium text-foreground">
                Lock on screen lock
              </div>
              <p className="text-[10.5px] text-muted-foreground">
                Auto-lock when your OS screen locks.
              </p>
            </div>
            <Switch
              disabled={!settings || busy}
              checked={settings?.lockOnScreenLock ?? true}
              onCheckedChange={(v) => void updateScreenLock(v)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Auto-lock timer</Label>
            <Select
              disabled={!settings || busy}
              value={String(settings?.autoLockMinutes ?? 0)}
              onValueChange={(v) => void updateAutoLock(Number(v))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMER_OPTIONS.map((o) => (
                  <SelectItem key={o.v} value={o.v}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <p className="text-[10px] text-muted-foreground/80">
            AES-256-GCM · PBKDF2 · 250k iterations · SHA-256
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
