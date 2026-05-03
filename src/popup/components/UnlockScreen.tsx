import { useState, type FormEvent } from "react";
import { Lock } from "lucide-react";
import { send } from "@/lib/messages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

export function UnlockScreen({ onUnlocked }: { onUnlocked: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const res = await send({ kind: "unlock", password });
    setBusy(false);
    if (!res.ok) {
      setError("Wrong password");
      setPassword("");
      return;
    }
    onUnlocked();
  }

  return (
    <div className="flex h-full flex-col justify-center px-7 py-10">
      <div className="mb-7 text-center">
        <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-xl bg-secondary">
          <Lock className="size-[18px] text-foreground/80" strokeWidth={1.5} />
        </div>
        <h1 className="text-[15px] font-semibold tracking-tight">ShardPass</h1>
        <p className="mt-1 text-[11.5px] text-muted-foreground">Vault is locked</p>
      </div>

      <form className="space-y-2.5" onSubmit={onSubmit}>
        <Input
          autoFocus
          type="password"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Master password"
        />

        {error && <Alert variant="destructive">{error}</Alert>}

        <Button type="submit" disabled={busy || !password} className="w-full">
          {busy ? "Unlocking…" : "Unlock"}
        </Button>
      </form>
    </div>
  );
}
