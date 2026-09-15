import { IconButton } from "@shardpass/ui";
import { Check, Copy, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { copyWithAutoClear } from "./clipboard";

const COPIED_RESET_MS = 1_500;

export interface CopyButtonProps {
  /** Accessible label for the button, e.g. "Copy password". */
  label: string;
  /** The plaintext value to copy. A no-op (and disabled button) when empty. */
  value: string;
}

/** A one-click copy-to-clipboard icon button that briefly confirms success. */
export function CopyButton({ label, value }: CopyButtonProps) {
  const [outcome, setOutcome] = useState<"idle" | "copied" | "failed">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const settle = (next: "copied" | "failed") => {
    setOutcome(next);
    clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setOutcome("idle"), COPIED_RESET_MS);
  };
  const onClick = () => {
    // The clipboard refuses when the document is not focused or permission is denied;
    // the button says so instead of staying silent.
    copyWithAutoClear(value).then(
      () => settle("copied"),
      () => settle("failed"),
    );
  };

  return (
    <IconButton
      aria-label={outcome === "copied" ? "Copied" : outcome === "failed" ? "Copy failed" : label}
      title={outcome === "failed" ? "Copy failed. Try again." : undefined}
      disabled={value.length === 0}
      onClick={onClick}
    >
      {outcome === "copied" ? (
        <Check size={16} />
      ) : outcome === "failed" ? (
        <X size={16} />
      ) : (
        <Copy size={16} />
      )}
    </IconButton>
  );
}
