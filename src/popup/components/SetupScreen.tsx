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
    if (password.length < 8) {
      setError("Use at least 8 characters.");
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
    <div className="flex h-full flex-col justify-center px-7 py-10">
      <div className="mb-7 text-center">
        <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-xl bg-secondary">
          <ShieldCheck className="size-5 text-foreground/80" strokeWidth={1.5} />
        </div>
        <h1 className="text-[15px] font-semibold tracking-tight">ShardPass</h1>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
          Create a master password to encrypt your vault locally.
        </p>
      </div>

      <form className="space-y-2.5" onSubmit={onSubmit}>
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

        <p className="pt-1 text-center text-[10px] leading-relaxed text-muted-foreground/70">
          AES-256-GCM. Your password never leaves this device.
        </p>
      </form>
    </div>
  );
}
