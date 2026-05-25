import { useEffect, useState, type FormEvent } from "react";
import { send } from "@/lib/messages";
import type { Account } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function EditAccountDialog({
  open,
  account,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  account: Account | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [issuer, setIssuer] = useState("");
  const [label, setLabel] = useState("");
  const [digits, setDigits] = useState<6 | 7 | 8>(6);
  const [period, setPeriod] = useState(30);
  const [algorithm, setAlgorithm] = useState<"SHA1" | "SHA256" | "SHA512">(
    "SHA1",
  );
  const [advanced, setAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !account) return;
    setIssuer(account.issuer);
    setLabel(account.label);
    setDigits((account.digits as 6 | 7 | 8) ?? 6);
    setPeriod(account.period ?? 30);
    setAlgorithm(account.algorithm ?? "SHA1");
    setAdvanced(false);
    setError(null);
  }, [open, account]);

  if (!account) return null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!account) return;
    setError(null);
    if (!issuer.trim() && !label.trim()) {
      setError("Provide an issuer or account name.");
      return;
    }
    setBusy(true);
    const res = await send({
      kind: "updateAccount",
      id: account.id,
      patch: {
        issuer: issuer.trim(),
        label: label.trim(),
        digits,
        period,
        algorithm,
      },
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onSaved();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit account</DialogTitle>
          <DialogDescription>
            The secret is never shown after creation. To change it, delete and
            re-add the account.
          </DialogDescription>
        </DialogHeader>

        <form className="space-y-2.5" onSubmit={onSubmit}>
          <div className="space-y-1">
            <Label>Issuer</Label>
            <Input
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
              placeholder="GitHub"
            />
          </div>
          <div className="space-y-1">
            <Label>Account</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="you@example.com"
            />
          </div>

          <button
            type="button"
            className="text-[12px] text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setAdvanced((v) => !v)}
          >
            {advanced ? "Hide" : "Show"} advanced
          </button>

          {advanced && (
            <div className="grid grid-cols-3 gap-2">
              <SmallSelect
                label="Digits"
                value={String(digits)}
                onChange={(v) => setDigits(Number(v) as 6 | 7 | 8)}
                options={["6", "7", "8"]}
              />
              <SmallSelect
                label="Period"
                value={String(period)}
                onChange={(v) => setPeriod(Number(v))}
                options={["15", "30", "60"]}
              />
              <SmallSelect
                label="Hash"
                value={algorithm}
                onChange={(v) =>
                  setAlgorithm(v as "SHA1" | "SHA256" | "SHA512")
                }
                options={["SHA1", "SHA256", "SHA512"]}
              />
            </div>
          )}

          {error && <Alert variant="destructive">{error}</Alert>}

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SmallSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
