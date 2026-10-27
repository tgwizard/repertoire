import { useEffect, useState } from "react";

/** Seconds since `active` last became true (0 while it isn't), updated every second. */
export function useElapsed(active: boolean): number {
  const [since, setSince] = useState<number | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) {
      setSince(null);
      return;
    }
    setSince(Date.now());
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
  return since === null ? 0 : (Date.now() - since) / 1000;
}
