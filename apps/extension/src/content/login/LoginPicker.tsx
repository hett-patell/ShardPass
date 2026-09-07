export interface LoginPickerSuggestion {
  readonly itemId: string;
  readonly expectedRevision: number;
  readonly name: string;
  readonly username: string;
  readonly favorite: boolean;
  readonly tags: readonly string[];
  readonly hasLinkedOtp: boolean;
}

/** "locked": the vault is closed; the chip stays so a click after unlocking asks again. */
export type LoginPickerState = "busy" | "ready" | "empty" | "error" | "locked";

export interface LoginPickerProps {
  readonly suggestions: readonly LoginPickerSuggestion[];
  readonly state: LoginPickerState;
  /** What the person has typed into the page's field since the picker opened. */
  readonly filter?: string;
  /** The row the arrow keys have reached; -1 for none. */
  readonly activeIndex?: number;
  readonly onClose: () => void;
  readonly onSelect: (suggestion: LoginPickerSuggestion) => void;
}

const STATUS: Readonly<
  Record<Exclude<LoginPickerState, "ready">, Readonly<{ text: string; hint?: string }>>
> = Object.freeze({
  busy: { text: "Loading logins" },
  empty: { text: "No saved logins for this site" },
  error: { text: "Saved logins are unavailable" },
  locked: { text: "ShardPass is locked", hint: "Unlock it from the toolbar, then click here again." },
});

/**
 * Favourites first, then by name; when the person has typed, a login stays only if what they
 * typed and its username are prefixes of each other (either way), or its name contains it.
 */
export function filterSuggestions(
  suggestions: readonly LoginPickerSuggestion[],
  filter: string,
): LoginPickerSuggestion[] {
  const typed = filter.trim().toLocaleLowerCase();
  return suggestions
    .filter((item) => {
      if (typed === "") return true;
      const username = item.username.toLocaleLowerCase();
      return username.startsWith(typed) || typed.startsWith(username) || item.name.toLocaleLowerCase().includes(typed);
    })
    .sort(
      (left, right) =>
        Number(right.favorite) - Number(left.favorite) ||
        left.name.localeCompare(right.name) ||
        left.username.localeCompare(right.username),
    );
}

/**
 * The on-page login list: a slim bar and the rows, nothing else. It never takes focus from
 * the field; typing there narrows the rows and the arrow keys walk them.
 */
export function LoginPicker({ suggestions, state, filter = "", activeIndex = -1, onClose, onSelect }: LoginPickerProps) {
  const visible = filterSuggestions(suggestions, filter);
  return (
    <section className="loginPicker" role="region" aria-label="ShardPass login picker">
      <div className="pickerBar">
        <span className="pickerBrand">ShardPass</span>
        <button className="pickerClose" type="button" aria-label="Close ShardPass picker" onClick={onClose}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      {state !== "ready" ? (
        <p className="status" role="status">
          {STATUS[state].text}
          {STATUS[state].hint === undefined ? null : (
            <>
              <br />
              {STATUS[state].hint}
            </>
          )}
        </p>
      ) : visible.length === 0 ? (
        <p className="status" role="status">
          No saved login matches what you typed
        </p>
      ) : (
        <div className="loginList">
          {visible.map((item, index) => (
            <button
              className="loginRow"
              type="button"
              key={`${item.itemId}:${item.expectedRevision}`}
              data-active={index === activeIndex ? "true" : undefined}
              aria-label={`Use login ${item.name} ${item.username}`}
              // The field keeps focus: a click must not blur it, or the page reacts as if the
              // person left the form.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(item)}
            >
              <span className="loginName">{item.name}</span>
              <span className="loginUsername">{item.username}</span>
              {item.hasLinkedOtp ? (
                <span className="loginOtpBadge" aria-label="Has a linked one-time code">
                  2FA
                </span>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
