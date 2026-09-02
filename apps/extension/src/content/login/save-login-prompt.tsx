import { useEffect, useRef } from "react";
import { detectLoginFields } from "@shardpass/autofill";

import type { LoginFillContentPlatform } from "../../platform/extension-platform";
import { createPickerHost, type PickerHandle } from "../createPickerHost";

export interface SaveLoginPrompt {
  start(): void;
  dispose(): void;
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US");
}

function SaveLoginBanner(
  props: Readonly<{
    domain: string;
    username: string;
    onSave: () => void;
    onDismiss: () => void;
  }>,
) {
  const dismissButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    dismissButton.current?.focus();
  }, []);
  return (
    <section
      className="saveBanner"
      role="region"
      aria-label="ShardPass save login prompt"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          props.onDismiss();
        }
      }}
    >
      <div className="headingRow">
        <div>
          <p className="eyebrow">SHARDPASS / SAVE LOGIN</p>
          <h2 className="title">Save this login?</h2>
        </div>
        <button
          className="closeButton"
          type="button"
          aria-label="Dismiss save prompt"
          onClick={props.onDismiss}
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <p className="saveDetail">
        <span className="saveUsername" title={props.username}>
          {props.username === "" ? "(no username)" : props.username}
        </span>
        <span className="saveDomain">{props.domain}</span>
      </p>
      <div className="saveActions">
        <button type="button" className="saveButton" onClick={props.onSave}>
          Save to ShardPass
        </button>
        <button
          ref={dismissButton}
          type="button"
          className="dismissButton"
          onClick={props.onDismiss}
        >
          Not now
        </button>
      </div>
    </section>
  );
}

/**
 * Watches form submissions for a username/password pair that has no saved
 * match for the current domain, and offers to save it.
 *
 * `login.saveOffer` (see `login-fill-service.ts`) is deliberately a
 * fire-and-forget acknowledgement — it signals that a credential was
 * observed, but does not report whether a match already exists, and it does
 * not create a vault item. Actually creating an item is `item.create`, which
 * is restricted to the trusted vault UI (`vaultOnly` sender policy) and
 * cannot be called from a content script. So this module independently asks
 * `login.fillSuggestions` for the same domain to decide whether to show the
 * banner, and "Save" hands off to the vault tab (`openVaultPage`) rather
 * than writing a vault item directly.
 */
export function createSaveLoginPrompt(
  options: Readonly<{
    document: Document;
    window: Window;
    platform: LoginFillContentPlatform;
  }>,
): SaveLoginPrompt {
  let started = false;
  let disposed = false;
  let host: PickerHandle | null = null;
  let pending: object | null = null;

  const closeHost = (): void => {
    const current = host;
    host = null;
    current?.close();
  };

  const dismiss = (): void => {
    pending = null;
    closeHost();
  };

  const showBanner = (token: object, domain: string, username: string): void => {
    if (disposed || pending !== token || !options.document.body.isConnected) return;
    closeHost();
    if (pending !== token) return;
    host = createPickerHost(options.document.body, {
      positionToAnchor: false,
      content: (
        <SaveLoginBanner
          domain={domain}
          username={username}
          onSave={() => {
            void options.platform.openVaultPage().catch(() => undefined);
            dismiss();
          }}
          onDismiss={dismiss}
        />
      ),
    });
  };

  const handleSubmit = (event: Event): void => {
    if (disposed) return;
    const target = event.target;
    if (
      !(target instanceof Element) ||
      target.tagName !== "FORM" ||
      target.ownerDocument.defaultView !== options.window
    )
      return;
    const form = target as HTMLFormElement;
    const fieldSet = detectLoginFields(options.document).find(
      (candidate) => candidate.form === form,
    );
    if (fieldSet === undefined) return;
    const username = fieldSet.usernameField?.value.trim() ?? "";
    const password = fieldSet.passwordField.value;
    if (password === "") return;
    const domain = options.window.location.hostname;

    void options.platform
      .sendLoginFillMessage({ version: 1, kind: "login.saveOffer", domain, username, password })
      .catch(() => undefined);

    const token = {};
    pending = token;
    void options.platform
      .sendLoginFillMessage({ version: 1, kind: "login.fillSuggestions", domain })
      .then((response) => {
        if (pending !== token) return;
        const hasMatch =
          response.kind === "login.fillSuggestionsResult" &&
          response.suggestions.some((item) => normalize(item.username) === normalize(username));
        if (hasMatch) {
          pending = null;
          return;
        }
        showBanner(token, domain, username);
      })
      .catch(() => {
        if (pending === token) pending = null;
      });
  };

  return {
    start() {
      if (started || disposed) return;
      started = true;
      options.document.addEventListener("submit", handleSubmit, true);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      started = false;
      options.document.removeEventListener("submit", handleSubmit, true);
      dismiss();
    },
  };
}
