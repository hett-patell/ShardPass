import { useCallback, useEffect, useState } from "react";
import { send } from "@/lib/messages";
import type { LockState } from "@/lib/messages";
import { SetupScreen } from "./components/SetupScreen";
import { UnlockScreen } from "./components/UnlockScreen";
import { AccountList } from "./components/AccountList";

export function App() {
  const [state, setState] = useState<LockState | "loading">("loading");

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
  return <AccountList onLocked={refresh} />;
}
