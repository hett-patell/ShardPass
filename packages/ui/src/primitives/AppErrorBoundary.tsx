import { Component, type ReactNode } from "react";

import { Button } from "./Button";
import styles from "./primitives.module.css";

interface Props {
  children: ReactNode;
  /** What the page is called in the copy ("the popup", "the vault page"). */
  surface: string;
}
interface State {
  failed: boolean;
}

/**
 * The last line before a white screen. A render error anywhere below shows a themed panel
 * with one honest sentence and a reload, instead of an empty document.
 */
export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className={styles.crashPanel} role="alert">
        <h2 className={styles.crashTitle}>Something went wrong</h2>
        <p className={styles.crashCopy}>
          {`ShardPass hit an error while drawing ${this.props.surface}. Reloading fixes it; nothing in your vault is affected.`}
        </p>
        <Button onClick={() => globalThis.location.reload()}>Reload</Button>
      </div>
    );
  }
}
