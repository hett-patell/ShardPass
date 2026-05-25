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
    <div className="flex h-full flex-col justify-center px-8 py-12">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.06]">
          <ShieldCheck className="size-7 text-foreground/50" strokeWidth={1.5} />
        </div>
        <h1 className="text-[18px] font-semibold tracking-tight text-foreground/90">
          ShardPass
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground/80">
          Create a master password to encrypt your vault locally.
        </p>
      </div>

      <form className="space-y-3.5" onSubmit={onSubmit}>
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

        <p className="pt-2 text-center text-[11px] text-muted-foreground/50">
          AES-256-GCM · PBKDF2 250k · Your password never leaves this device.
        </p>
      </form>
    </div>
  );
}
