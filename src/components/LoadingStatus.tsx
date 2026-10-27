import { useElapsed } from "../lib/useElapsed";

/** What to say while waiting, as the wait gets longer */
function message(seconds: number, label: string): string {
  if (seconds < 3) return label;
  if (seconds < 12) return "Still working: a big list can take a few seconds the first time.";
  return "Taking unusually long. You can keep waiting, or try other filters.";
}

/**
 * A list being loaded or updated. With results already showing, a pill floats over
 * their top (it takes no space, so nothing moves); before the first results, the same
 * words take the list's place.
 */
export function LoadingStatus({ busy, over, label = "Updating…" }: { busy: boolean; over: boolean; label?: string }) {
  const seconds = useElapsed(busy);
  if (!busy) return null;
  const text = message(seconds, label);
  return over ? (
    <div className="loading-anchor" role="status">
      <span className="loading-pill">
        <span className="spinner" /> {text}
      </span>
    </div>
  ) : (
    <p className="muted loading-first" role="status">
      <span className="spinner" /> {text}
    </p>
  );
}
