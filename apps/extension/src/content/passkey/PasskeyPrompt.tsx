import { useEffect, useRef } from "react";

import type { PasskeyCandidate } from "@shardpass/messaging";

export type PasskeyPromptProps =
  | Readonly<{
      mode: "create";
      rpId: string;
      userName: string;
      /** The login the passkey would be stored with, when one matches; else a new login is saved. */
      attachToName: string | null;
      busy: boolean;
      onCreate: () => void;
      onFallback: () => void;
    }>
  | Readonly<{
      mode: "choose";
      rpId: string;
      candidates: readonly PasskeyCandidate[];
      busy: boolean;
      onSelect: (candidate: PasskeyCandidate) => void;
      onFallback: () => void;
    }>
  | Readonly<{ mode: "locked"; rpId: string; onFallback: () => void }>;

/** The in-page passkey prompt, in the same closed shadow root and vocabulary as the login picker. */
export function PasskeyPrompt(props: PasskeyPromptProps) {
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    primary.current?.focus();
  }, []);
  return (
    <section
      className="loginPicker"
      role="region"
      aria-label="ShardPass passkey prompt"
    >
      <header className="loginHeading">
        <div>
          <p className="eyebrow">SHARDPASS / PASSKEY</p>
          <h2 className="title">
            {props.mode === "create"
              ? `Create a passkey for ${props.rpId}?`
              : props.mode === "choose"
                ? "Sign in with a passkey"
                : "ShardPass is locked"}
          </h2>
        </div>
        <button className="closeButton" type="button" aria-label="Use the browser instead" onClick={props.onFallback}>
          <span aria-hidden="true">×</span>
        </button>
      </header>

      {props.mode === "create" ? (
        <>
          <p className="saveDetail">
            <span className="saveUsername">{props.userName || "(no username)"}</span>
            <span className="saveDomain">
              {props.attachToName === null ? "A new login will be saved" : `Saved with “${props.attachToName}”`}
            </span>
          </p>
          <div className="saveActions">
            <button ref={primary} type="button" className="saveButton" disabled={props.busy} onClick={props.onCreate}>
              Create passkey
            </button>
            <button type="button" className="dismissButton" onClick={props.onFallback}>
              Use browser instead
            </button>
          </div>
        </>
      ) : props.mode === "choose" ? (
        <>
          <div className="loginList">
            {props.candidates.map((candidate, index) => (
              <button
                ref={index === 0 ? primary : undefined}
                className="loginRow"
                type="button"
                key={candidate.credentialId}
                aria-label={`Sign in as ${candidate.userName} with ${candidate.loginName}`}
                disabled={props.busy}
                onClick={() => props.onSelect(candidate)}
              >
                <span className="loginName">{candidate.loginName}</span>
                <span className="loginUsername">{candidate.userName}</span>
              </button>
            ))}
          </div>
          <div className="saveActions">
            <button type="button" className="dismissButton" onClick={props.onFallback}>
              Use browser instead
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="saveDetail">
            <span className="saveDomain">Unlock ShardPass from the toolbar to use a passkey for {props.rpId}.</span>
          </p>
          <div className="saveActions">
            <button ref={primary} type="button" className="dismissButton" onClick={props.onFallback}>
              Use browser instead
            </button>
          </div>
        </>
      )}
    </section>
  );
}
