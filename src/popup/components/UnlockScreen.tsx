import { useState, type FormEvent } from "react";
import { Lock, ShieldCheck } from "lucide-react";
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
      setError("Incorrect master password");
      setPassword("");
      return;
    }
    onUnlocked();
  }

  return (
    <div className="flex h-full flex-col px-6 py-6 animate-fade-in">
      {/* Hero */}
      <div className="mb-6 mt-6 flex flex-col items-center text-center">
        <div
          className="mb-4 grid size-12 place-items-center rounded-xl"
          style={{
            backgroundImage:
              "linear-gradient(135deg, oklch(0.68 0.14 285), oklch(0.50 0.18 295))",
            boxShadow:
              "inset 0 1px 0 oklch(1 0 0 / 18%), 0 4px 16px oklch(0.50 0.18 295 / 30%)",
          }}
        >
          <Lock className="size-5 text-white" strokeWidth={2} />
        </div>
        <h1 className="text-[17px] font-semibold tracking-tight text-foreground">
          ShardPass is locked
        </h1>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">
          Enter your master password to continue.
        </p>
      </div>

      <form className="space-y-2.5" onSubmit={onSubmit}>
        <div className="space-y-1.5">
          <label className="label-caps">Master password</label>
          <Input
            autoFocus
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter your password"
          />
        </div>

        {error && <Alert variant="destructive">{error}</Alert>}

        <Button
          type="submit"
          disabled={busy || !password}
          className="mt-1 w-full"
          size="lg"
        >
          {busy ? "Unlocking…" : "Unlock"}
        </Button>
      </form>

      <div className="mt-auto flex items-center justify-center gap-1.5 pt-4 text-[10.5px] font-medium text-muted-foreground/55">
        <ShieldCheck className="size-3" strokeWidth={1.75} />
        <span className="tracking-[0.04em]">Encrypted locally on this device</span>
      </div>
    </div>
  );
}
