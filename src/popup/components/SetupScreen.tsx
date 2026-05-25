import { useState, type FormEvent } from "react";
import { ShieldCheck, Lock } from "lucide-react";
import { send } from "@/lib/messages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

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
    <div className="flex h-full flex-col px-6 py-6 animate-fade-in">
      {/* Hero */}
      <div className="mb-6 mt-3 flex flex-col items-center text-center">
        <div
          className="mb-4 grid size-12 place-items-center rounded-xl"
          style={{
            backgroundImage:
              "linear-gradient(135deg, oklch(0.68 0.14 285), oklch(0.50 0.18 295))",
            boxShadow:
              "inset 0 1px 0 oklch(1 0 0 / 18%), 0 4px 16px oklch(0.50 0.18 295 / 30%)",
          }}
        >
          <ShieldCheck className="size-6 text-white" strokeWidth={1.75} />
        </div>
        <h1 className="text-[17px] font-semibold tracking-tight text-foreground">
          Welcome to ShardPass
        </h1>
        <p className="mt-1 max-w-[260px] text-[12.5px] leading-relaxed text-muted-foreground">
          Create a master password to encrypt your vault. It never leaves this
          device.
        </p>
      </div>

      <form className="space-y-2.5" onSubmit={onSubmit}>
        <div className="space-y-1.5">
          <label className="label-caps">Master password</label>
          <Input
            type="password"
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={`At least ${MIN_LEN} characters`}
          />
        </div>
        <div className="space-y-1.5">
          <label className="label-caps">Confirm</label>
          <Input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Re-enter password"
          />
        </div>

        {error && <Alert variant="destructive">{error}</Alert>}

        <Button type="submit" disabled={busy} className="mt-1 w-full" size="lg">
          {busy ? "Setting up…" : "Create vault"}
        </Button>
      </form>

      <div className="mt-auto flex items-center justify-center gap-1.5 pt-4 text-[10.5px] font-medium text-muted-foreground/55">
        <Lock className="size-3" strokeWidth={1.75} />
        <span className="tracking-[0.04em]">
          AES-256-GCM · PBKDF2 250k · SHA-256
        </span>
      </div>
    </div>
  );
}
