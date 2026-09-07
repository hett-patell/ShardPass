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

/** The on-page one-time-code list: favourites first, a slim bar, no search box to take focus. */
export function OtpPicker({ suggestions, state, onClose, onSelect }: OtpPickerProps) {
  const visible = suggestions
    .slice()
    .sort(
      (left, right) =>
        Number(right.favorite) - Number(left.favorite) ||
        left.issuer.localeCompare(right.issuer) ||
        left.label.localeCompare(right.label),
    );
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
        <button className="pickerClose" type="button" aria-label="Close ShardPass picker" onClick={onClose}>
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
              <span className="otpType">{item.otpType.toUpperCase()}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="status" role="status">
          {STATUS[state]}
        </p>
      )}
    </section>
  );
}
