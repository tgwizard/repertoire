import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * A "?" with an explanation that opens on hover or click; Escape or a click elsewhere
 * closes it. The popover spans the nearest positioned ancestor (see .info-popover).
 * Children can be a function, to close it themselves (an example that fills a field).
 */
export function InfoTip({ label, children }: { label: string; children: ReactNode | ((close: () => void) => ReactNode) }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <span className={`info${open ? " open" : ""}`} ref={ref}>
      <button type="button" className="info-button" aria-label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        ?
      </button>
      <span className="info-popover" role="tooltip">
        {typeof children === "function" ? children(() => setOpen(false)) : children}
      </span>
    </span>
  );
}
