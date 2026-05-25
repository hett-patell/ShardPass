import { useState, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { send } from "@/lib/messages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

export function SetupScreen({ onSetupDone }: { onSetupDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 12) {
      setError("Use at least 12 characters.");
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
    <div className="flex h-full flex-col items-center justify-center px-8 py-10">
      <div className="mb-8 w-full text-center">
        <div className="mx-auto mb-6 grid size-16 place-items-center rounded-2xl bg-gradient-to-br from-[oklch(0.22_0.03_270)] to-[oklch(0.18_0.02_250)]">
          <ShieldCheck className="size-8 text-foreground/40" strokeWidth={1.5} />
        </div>
        <h1 className="text-[20px] font-bold tracking-tight text-foreground/90">
          ShardPass
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground/70">
          Create a master password to encrypt your vault.
          <br />
          It never leaves this device.
        </p>
      </div>

      <form className="w-full space-y-3.5" onSubmit={onSubmit}>
        <Input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Master password"
        />
        <Input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Confirm password"
        />

        {error && <Alert variant="destructive">{error}</Alert>}

        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "Setting up…" : "Create vault"}
        </Button>
      </form>

      <p className="mt-6 text-center text-[11px] leading-relaxed text-muted-foreground/45">
        AES-256-GCM · PBKDF2 &nbsp; 250k rounds &nbsp; · SHA-256
      </p>
    </div>
  );
}
