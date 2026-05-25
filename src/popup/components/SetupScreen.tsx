import { useState, type FormEvent } from "react";
import { send } from "@/lib/messages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";

const MIN_LEN = 12;

export function SetupScreen({ onSetupDone }: { onSetupDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < MIN_LEN) {
      setError(`Use at least ${MIN_LEN} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    const res = await send({ kind: "setup", password });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSetupDone();
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
        <span className="ml-auto code-mono text-[10px] text-muted-foreground/70">
          Setup
        </span>
      </header>

      <div className="flex-1 flex flex-col px-6 pt-6 pb-5 overflow-y-auto scrollbar-thin">
        {/* Title */}
        <div className="mb-5">
          <h1 className="text-[18px] font-semibold tracking-[-0.02em] text-foreground">
            Create your vault
          </h1>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
            Choose a master password to encrypt your accounts. It never leaves
            this device.
          </p>
        </div>

        {/* Form */}
        <form className="space-y-3" onSubmit={onSubmit}>
          <div className="space-y-1.5">
            <Label>Master password</Label>
            <Input
              type="password"
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={`At least ${MIN_LEN} characters`}
              className="h-9"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Confirm</Label>
            <Input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Re-enter password"
              className="h-9"
            />
          </div>

          {error && <Alert variant="destructive">{error}</Alert>}

          <Button
            type="submit"
            disabled={busy}
            className="mt-1 w-full"
            size="lg"
          >
            {busy ? "Setting up…" : "Create vault"}
          </Button>
        </form>

        {/* Footer info */}
        <div className="mt-auto pt-6 code-mono text-[10px] text-muted-foreground/70 leading-relaxed">
          AES-256-GCM · PBKDF2 250,000 · SHA-256
        </div>
      </div>
    </div>
  );
}
