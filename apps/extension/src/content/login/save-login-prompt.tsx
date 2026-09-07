import { useEffect, useRef } from "react";
import { detectLoginFields } from "@shardpass/autofill";

import type { LoginFillContentPlatform } from "../../platform/extension-platform";
import { createPickerHost, type PickerHandle } from "../createPickerHost";

export interface SaveLoginPrompt {
  start(): void;
  dispose(): void;
}

function SaveLoginBanner(
  props: Readonly<{
    domain: string;
    username: string;
    /** "update" when the vault already has this username here with another password. */
    mode: "new" | "update";
    existingName: string | undefined;
    busy: boolean;
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
          <h2 className="title">
            {props.mode === "update" ? `Update password for ${props.existingName ?? props.domain}?` : "Save this login?"}
          </h2>
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
        <button type="button" className="saveButton" disabled={props.busy} onClick={props.onSave}>
          {props.mode === "update" ? "Update password" : "Save new login"}
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
 * Watches form submissions for a username/password pair and offers to keep it. The
 * background holds the credential as an offer and says what the vault already has for
 * this host and username: nothing (offer "save new"), the same password (say nothing),
 * or a different one (offer "update"). Several accounts on one site are simply several
 * logins with different usernames.
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

  const showBanner = (
    token: object,
    domain: string,
    username: string,
    offerId: string,
    mode: "new" | "update",
    existingName: string | undefined,
  ): void => {
    if (disposed || pending !== token || !options.document.body.isConnected) return;
    closeHost();
    if (pending !== token) return;
    let busy = false;
    const render = () =>
      createPickerHost(options.document.body, {
        positionToAnchor: false,
        content: (
          <SaveLoginBanner
            domain={domain}
            username={username}
            mode={mode}
            existingName={existingName}
            busy={busy}
            onSave={() => {
              if (busy) return;
              busy = true;
              void options.platform
                .sendLoginFillMessage({ version: 1, kind: "login.saveConfirm", offerId, choice: mode })
                .catch(() => undefined)
                .finally(dismiss);
            }}
            onDismiss={dismiss}
          />
        ),
      });
    host = render();
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

    const token = {};
    pending = token;
    void options.platform
      .sendLoginFillMessage({ version: 1, kind: "login.saveOffer", domain, username, password })
      .then((response) => {
        if (pending !== token || response.kind !== "login.saveOfferResult") return;
        if (response.existing === "same") {
          pending = null;
          return;
        }
        showBanner(
          token,
          domain,
          username,
          response.offerId,
          response.existing === "different-password" ? "update" : "new",
          response.existingName,
        );
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
