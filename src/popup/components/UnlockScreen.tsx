import { useState, type FormEvent } from "react";
import { send } from "@/lib/messages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";

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
      // Surface the real error — e.g. the rate-limit lockout message —
      // instead of always claiming the password was wrong.
      setError(
        res.error === "Invalid password" ? "Incorrect master password" : res.error,
      );
      setPassword("");
      return;
    }
    onUnlocked();
  }

  return (
    <div className="flex h-full flex-col animate-fade-in">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-2 border-b border-border-soft px-4 pt-4 pb-3">
        <div
          className="grid size-6 place-items-center rounded-[2px] bg-primary text-primary-foreground"
          aria-hidden
        >
          <span className="text-[13px] font-bold leading-none tracking-[-0.04em]">
            S
          </span>
        </div>
        <span className="text-[14.5px] font-semibold leading-none tracking-[-0.02em] text-foreground">
          ShardPass
        </span>
        <span className="ml-auto code-mono text-[10px] text-warning flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-warning" aria-hidden />
          Locked
        </span>
      </header>

      <div className="flex-1 flex flex-col px-6 pt-10 pb-6">
        {/* Title */}
        <div className="mb-6">
          <h1 className="text-[18px] font-semibold tracking-[-0.02em] text-foreground">
            Vault locked
          </h1>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
            Enter your master password to continue.
          </p>
        </div>

        {/* Form */}
        <form className="space-y-3" onSubmit={onSubmit}>
          <div className="space-y-1.5">
            <Label>Master password</Label>
            <Input
              autoFocus
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className="h-9"
            />
          </div>

          {error && <Alert variant="destructive">{error}</Alert>}

          <Button
            type="submit"
            disabled={busy || !password}
            className="mt-1 w-full"
            size="lg"
          >
            {busy ? "Unlocking…" : "Unlock vault"}
          </Button>
        </form>

        {/* Footer info */}
        <div className="mt-auto pt-6 code-mono text-[10px] text-muted-foreground/70 flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-success" aria-hidden />
          Encrypted locally on this device
        </div>
      </div>
    </div>
  );
}
