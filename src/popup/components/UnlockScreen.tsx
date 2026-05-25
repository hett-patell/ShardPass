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
    <div className="flex h-full flex-col items-center justify-center px-8 py-10">
      <div className="mb-8 w-full text-center">
        <div className="mx-auto mb-6 grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-[oklch(0.22_0.03_270)] to-[oklch(0.18_0.02_250)]">
          <Lock className="size-8 text-foreground/40" strokeWidth={1.5} />
        </div>
        <h1 className="text-[20px] font-bold tracking-tight text-foreground/90">
          ShardPass
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground/70">
          Enter your master password to unlock.
        </p>
      </div>

      <form className="w-full space-y-3.5" onSubmit={onSubmit}>
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
