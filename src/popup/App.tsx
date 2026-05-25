import { useCallback, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { send } from "@/lib/messages";
import type { LockState } from "@/lib/messages";
import { getDetachedView } from "@/lib/detached";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SetupScreen } from "./components/SetupScreen";
import { UnlockScreen } from "./components/UnlockScreen";
import { AccountList } from "./components/AccountList";
import { ImportExportDialog } from "./components/ImportExportDialog";
import { DetachedQRImport } from "./components/DetachedQRImport";

export function App() {
  const [state, setState] = useState<LockState | "loading">("loading");
  const detached = getDetachedView();

  const refresh = useCallback(async () => {
    const res = await send<{ state: LockState }>({ kind: "getState" });
    if (res.ok) setState(res.data.state);
    else setState("locked");
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (state === "loading") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground/70">
          <span className="grid size-1.5 animate-pulse place-items-center rounded-full bg-primary" />
          <span className="tracking-[0.02em]">Loading vault</span>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      {state === "no_vault" ? <SetupScreen onSetupDone={refresh} /> :
       state === "locked" ? <UnlockScreen onUnlocked={refresh} /> :
       detached === "io" ? <DetachedImportExport /> :
       detached === "qr" ? <DetachedQRImport /> :
       <AccountList onLocked={refresh} />}
      <Toaster />
    </TooltipProvider>
  );
}

function DetachedImportExport() {
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    if (!done) return;
    const id = window.setTimeout(() => window.close(), 1400);
    return () => window.clearTimeout(id);
  }, [done]);

  if (done) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center animate-fade-in">
        <div className="grid size-9 place-items-center rounded-full bg-emerald-500/15">
          <Check className="size-4 text-emerald-300" strokeWidth={2.25} />
        </div>
        <p className="text-[12.5px] font-medium text-foreground">{done}</p>
        <p className="text-[11px] text-muted-foreground">Closing…</p>
      </div>
    );
  }

  return (
    <ImportExportDialog
      open
      onOpenChange={(o) => {
        if (!o) window.close();
      }}
      onChanged={(msg) => setDone(msg ?? "Imported.")}
    />
  );
}
