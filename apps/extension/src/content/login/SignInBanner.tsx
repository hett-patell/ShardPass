export interface SignInBannerProps {
  readonly name: string;
  readonly username: string;
  /** How many other saved logins fit this page. */
  readonly otherCount: number;
  readonly busy: boolean;
  readonly onSignIn: () => void;
  readonly onOtherOptions: () => void;
  readonly onClose: () => void;
}

/**
 * The one-click way in: the best saved login for this page, at the top of the viewport, with
 * a Sign in button that fills and submits. Other logins are a click away; the close is final
 * for this page load.
 */
export function SignInBanner({ name, username, otherCount, busy, onSignIn, onOtherOptions, onClose }: SignInBannerProps) {
  return (
    <div className="signIn" role="region" aria-label="ShardPass sign-in">
      <div className="signInRow">
        <span className="signInMark" aria-hidden="true">
          SP
        </span>
        <span className="signInText">
          <span className="signInName">{name}</span>
          <span className="signInUser">{username}</span>
        </span>
        <button className="signInButton" type="button" disabled={busy} onClick={onSignIn}>
          {busy ? "Signing in" : "Sign in"}
        </button>
        <button className="signInClose" type="button" aria-label="Dismiss ShardPass sign-in" onClick={onClose}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      {otherCount > 0 ? (
        <button className="signInOther" type="button" onClick={onOtherOptions}>
          Other options ({otherCount})
        </button>
      ) : null}
    </div>
  );
}
