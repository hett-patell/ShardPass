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
    <div className="flex h-full flex-col justify-center px-8 py-12">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.06]">
          <Lock className="size-7 text-foreground/50" strokeWidth={1.5} />
        </div>
        <h1 className="text-[18px] font-semibold tracking-tight text-foreground/90">
          ShardPass
        </h1>
        <p className="mt-2 text-[13px] text-muted-foreground/80">
          Enter your master password to unlock the vault.
        </p>
      </div>

      <form className="space-y-3.5" onSubmit={onSubmit}>
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
