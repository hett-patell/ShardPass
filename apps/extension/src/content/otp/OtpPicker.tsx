import { useMemo, useState } from "react";

export interface OtpPickerSuggestion {
  readonly itemId: string;
  readonly expectedRevision: number;
  readonly issuer: string;
  readonly label: string;
  readonly otpType: "totp" | "hotp" | "steam";
  readonly favorite: boolean;
  readonly tags: readonly string[];
}

export interface OtpPickerProps {
  readonly suggestions: readonly OtpPickerSuggestion[];
  readonly state: "busy" | "ready" | "empty" | "error";
  readonly onClose: () => void;
  readonly onSelect: (suggestion: OtpPickerSuggestion) => void;
}

const STATUS = Object.freeze({
  busy: "Loading accounts",
  empty: "No OTP accounts available",
  error: "OTP accounts are unavailable",
});

export function OtpPicker({ suggestions, state, onClose, onSelect }: OtpPickerProps) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return suggestions
      .filter(
        (item) =>
          normalized === "" ||
          [item.issuer, item.label, ...item.tags].some((value) =>
            value.toLocaleLowerCase().includes(normalized),
          ),
      )
      .slice()
      .sort(
        (left, right) =>
          Number(right.favorite) - Number(left.favorite) ||
          left.issuer.localeCompare(right.issuer) ||
          left.label.localeCompare(right.label),
      );
  }, [query, suggestions]);

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
      <header className="otpHeading">
        <div>
          <p className="eyebrow">SHARDPASS / OTP</p>
          <h2 className="title">Choose an account</h2>
        </div>
        <button
          className="closeButton"
          type="button"
          aria-label="Close ShardPass picker"
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>
      </header>
      {state === "ready" ? (
        <>
          <label className="searchLabel">
            Search accounts
            <input
              className="otpSearch"
              type="search"
              aria-label="Search OTP accounts"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          <div className="otpList">
            {visible.map((item) => (
              <button
                className="otpRow"
                type="button"
                key={`${item.itemId}:${item.expectedRevision}`}
                aria-label={`Use OTP account ${item.issuer} ${item.label}`}
                onClick={() => onSelect(item)}
              >
                <span className="otpIssuer">{item.issuer}</span>
                <span className="otpLabel">{item.label}</span>
                <span className="otpType">{item.otpType.toUpperCase()}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <p className="status" role="status">
          {STATUS[state]}
        </p>
      )}
    </section>
  );
}
