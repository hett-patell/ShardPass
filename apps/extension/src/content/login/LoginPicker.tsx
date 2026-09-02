import { useMemo, useState } from "react";

export interface LoginPickerSuggestion {
  readonly itemId: string;
  readonly expectedRevision: number;
  readonly name: string;
  readonly username: string;
  readonly favorite: boolean;
  readonly tags: readonly string[];
  readonly hasLinkedOtp: boolean;
}

export interface LoginPickerProps {
  readonly suggestions: readonly LoginPickerSuggestion[];
  readonly state: "busy" | "ready" | "empty" | "error";
  readonly onClose: () => void;
  readonly onSelect: (suggestion: LoginPickerSuggestion) => void;
}

const STATUS = Object.freeze({
  busy: "Loading logins",
  empty: "No saved logins for this site",
  error: "Saved logins are unavailable",
});

export function LoginPicker({ suggestions, state, onClose, onSelect }: LoginPickerProps) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return suggestions
      .filter(
        (item) =>
          normalized === "" ||
          [item.name, item.username, ...item.tags].some((value) =>
            value.toLocaleLowerCase().includes(normalized),
          ),
      )
      .slice()
      .sort(
        (left, right) =>
          Number(right.favorite) - Number(left.favorite) ||
          left.name.localeCompare(right.name) ||
          left.username.localeCompare(right.username),
      );
  }, [query, suggestions]);

  return (
    <section
      className="loginPicker"
      role="region"
      aria-label="ShardPass login picker"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <header className="loginHeading">
        <div>
          <p className="eyebrow">SHARDPASS / LOGIN</p>
          <h2 className="title">Choose a login</h2>
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
            Search logins
            <input
              className="loginSearch"
              type="search"
              aria-label="Search saved logins"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          </label>
          <div className="loginList">
            {visible.map((item) => (
              <button
                className="loginRow"
                type="button"
                key={`${item.itemId}:${item.expectedRevision}`}
                aria-label={`Use login ${item.name} ${item.username}`}
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
        </>
      ) : (
        <p className="status" role="status">
          {STATUS[state]}
        </p>
      )}
    </section>
  );
}
