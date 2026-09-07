import type { LoginItem } from "@shardpass/domain";
import { generateOtp, inlineTotpItem } from "@shardpass/otp";

export { inlineTotpItem };
import { useEffect, useState } from "react";

export interface InlineTotpState {
  code: string | null;
  remaining: number;
  /** Set when the stored secret cannot be turned into a working generator. */
  invalid: boolean;
}

/**
 * Live code for a login's inline TOTP, computed on the page. The vault page already holds
 * the full login -- secret included -- so there is nothing to gain by round-tripping through
 * the background, and doing so would count as activity for the inactivity lock.
 */
export function useInlineTotp(login: LoginItem, active: boolean): InlineTotpState {
  const [state, setState] = useState<InlineTotpState>({ code: null, remaining: 0, invalid: false });
  const totp = login.totp ?? "";

  useEffect(() => {
    if (!active || totp === "") {
      setState({ code: null, remaining: 0, invalid: false });
      return;
    }
    const item = inlineTotpItem(login);
    if (item === null || item.otpType === "hotp") {
      setState({ code: null, remaining: 0, invalid: true });
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const generated = await generateOtp(item, Date.now());
        if (cancelled) return;
        setState({ code: generated.code, remaining: generated.remaining ?? 0, invalid: false });
        // Wake at the next boundary rather than every second: the code only changes then.
        const delay = Math.max(250, (generated.expiresAt ?? Date.now() + 1_000) - Date.now());
        timer = setTimeout(() => void tick(), Math.min(delay, 1_000));
      } catch {
        if (!cancelled) setState({ code: null, remaining: 0, invalid: true });
      }
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
    // `login` is read through `totp`/identity fields only; re-running on every object
    // identity change would restart the timer on each parent render.
  }, [active, totp, login.id]);

  return state;
}
