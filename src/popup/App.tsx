import { useCallback, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { send } from "@/lib/messages";
import type { LockState } from "@/lib/messages";
import { getDetachedView } from "@/lib/detached";
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
        <div className="text-[12px] text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (state === "no_vault") return <SetupScreen onSetupDone={refresh} />;
  if (state === "locked") return <UnlockScreen onUnlocked={refresh} />;

  if (detached === "io") return <DetachedImportExport />;
  if (detached === "qr") return <DetachedQRImport />;

  return <AccountList onLocked={refresh} />;
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
        <p className="text-[10.5px] text-muted-foreground">Closing…</p>
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
