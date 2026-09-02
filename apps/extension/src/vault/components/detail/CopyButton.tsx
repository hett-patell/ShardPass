import { IconButton } from "@shardpass/ui";
import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";

const COPIED_RESET_MS = 1_500;

export interface CopyButtonProps {
  /** Accessible label for the button, e.g. "Copy password". */
  label: string;
  /** The plaintext value to copy. A no-op (and disabled button) when empty. */
  value: string;
}

/** A one-click copy-to-clipboard icon button that briefly confirms success. */
export function CopyButton({ label, value }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const onClick = () => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS);
    });
  };

  return (
    <IconButton aria-label={copied ? "Copied" : label} disabled={value.length === 0} onClick={onClick}>
      {copied ? <Check size={16} /> : <Copy size={16} />}
    </IconButton>
  );
}
