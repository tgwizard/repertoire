import { Component, type ReactNode } from "react";
import { REPO } from "../shared/paths";

interface Props {
  children: ReactNode;
  /** Changes with each navigation: going elsewhere tries again */
  resetKey: unknown;
}

/**
 * A crash shows a way out instead of a blank page: reload, start over, or report it.
 * Without an error, a new resetKey changes nothing (the finder stays mounted).
 */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Crashed rendering", location.href, error);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const report = new URL(`${REPO}/issues/new`);
    report.searchParams.set("title", `Crash: ${error.message}`.slice(0, 120));
    report.searchParams.set("body", `On ${location.href}\n\n${error.message}\n\nWhat I did:\n`);
    return (
      <div className="notice error crash" role="alert">
        <div>
          <p>
            <strong>Something went wrong showing this page.</strong> It's a bug on our side. Reloading usually helps; if it doesn't, please{" "}
            <a href={report.toString()}>report it</a>.
          </p>
          <details>
            <summary>Details</summary>
            <code>{error.message}</code>
          </details>
        </div>
        <div className="crash-actions">
          <button className="load-error-retry" onClick={() => location.reload()}>
            Reload
          </button>
          <a className="load-error-retry" href="/">
            Start over
          </a>
        </div>
      </div>
    );
  }
}
