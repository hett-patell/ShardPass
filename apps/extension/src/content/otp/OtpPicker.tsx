import { useState } from "react";

export interface OtpPickerSuggestion {
  readonly itemId: string;
  readonly expectedRevision: number;
  readonly issuer: string;
  readonly label: string;
  readonly otpType: "totp" | "hotp" | "steam";
  readonly favorite: boolean;
  readonly tags: readonly string[];
  readonly siteMatch?: boolean | undefined;
  readonly preview?: Readonly<{ code: string; expiresAt: number }> | undefined;
}

export interface OtpPickerProps {
  readonly suggestions: readonly OtpPickerSuggestion[];
  readonly state: "busy" | "ready" | "empty" | "error" | "failed" | "stale";
  /** Seconds left on the shown codes, from the controller's clock. */
  readonly now?: number;
  readonly onClose: () => void;
  readonly onSelect: (suggestion: OtpPickerSuggestion) => void;
}

const STATUS = Object.freeze({
  busy: "Loading accounts",
  empty: "No OTP accounts available",
  error: "OTP accounts are unavailable",
  failed: "This field would not take the code. It was copied instead: paste it.",
  stale: "That code could not be fetched. Click the account again.",
});

function grouped(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/** The on-page one-time-code list: favourites first, a slim bar, no search box to take focus. */
export function OtpPicker({
  suggestions,
  state,
  now = Date.now(),
  onClose,
  onSelect,
}: OtpPickerProps) {
  const [showAll, setShowAll] = useState(false);
  const sorted = suggestions
    .slice()
    .sort(
      (left, right) =>
        Number(right.siteMatch ?? false) - Number(left.siteMatch ?? false) ||
        Number(right.favorite) - Number(left.favorite) ||
        left.issuer.localeCompare(right.issuer) ||
        left.label.localeCompare(right.label),
    );
  // When some accounts belong to this site, only those show until asked for the rest.
  const matched = sorted.filter((item) => item.siteMatch === true);
  const visible = matched.length > 0 && !showAll ? matched : sorted;
  const hidden = sorted.length - visible.length;
  return (
    <section
      className="otpPicker"
      role="region"
      aria-label="ShardPass OTP picker"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <div className="pickerBar">
        <span className="pickerBrand">ShardPass</span>
        <button
          className="pickerClose"
          type="button"
          aria-label="Close ShardPass picker"
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      {state === "ready" ? (
        <div className="otpList">
          {visible.map((item) => (
            <button
              className="otpRow"
              type="button"
              key={`${item.itemId}:${item.expectedRevision}`}
              aria-label={`Use OTP account ${item.issuer} ${item.label}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(item)}
            >
              <span className="otpIssuer">{item.issuer}</span>
              <span className="otpLabel">{item.label}</span>
              {item.preview ? (
                <span className="otpCode" aria-hidden="true">
                  {grouped(item.preview.code)}
                  <span className="otpLeft">
                    {Math.max(0, Math.ceil((item.preview.expiresAt - now) / 1_000))}s
                  </span>
                </span>
              ) : (
                <span className="otpType">{item.otpType.toUpperCase()}</span>
              )}
            </button>
          ))}
          {hidden > 0 ? (
            <button className="otpMore" type="button" onClick={() => setShowAll(true)}>
              Show {hidden} more {hidden === 1 ? "account" : "accounts"}
            </button>
          ) : null}
        </div>
      ) : (
        <p className="status" role="status">
          {STATUS[state]}
        </p>
      )}
    </section>
  );
}
