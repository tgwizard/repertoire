/** A list that failed to load: what failed, why, and a way to try again. */
export function LoadError({ what, message, onRetry }: { what: string; message: string; onRetry: () => void }) {
  return (
    <div className="notice error load-error" role="alert">
      <span>
        Couldn't load {what}. <span className="muted">The server said: {message}</span>
      </span>
      <button className="load-error-retry" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
