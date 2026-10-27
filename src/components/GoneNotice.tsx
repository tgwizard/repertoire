import type { Gone } from "../shared/data";
import { workPath } from "../lib/api";
import { Link } from "../lib/router";

/** A work or composer no longer listed: what it was, why, and where to look instead */
export function GoneNotice({ gone, what }: { gone: Gone; what: "work" | "composer" }) {
  return (
    <div className="notice gone">
      <p>
        <strong>
          {gone.title}
          {gone.composer && ` by ${gone.composer}`}
        </strong>{" "}
        is no longer listed (since dataset {gone.since}).{" "}
        {gone.reason === "uncertain"
          ? "Its source record may describe a work listed under another title, so it's no longer listed on its own."
          : what === "work"
            ? "Its sources no longer have it, or no longer say what it's for."
            : "None of their works are listed any more."}
      </p>
      {gone.seeAlso.length > 0 && (
        <>
          <p>It may be one of these:</p>
          <ul>
            {gone.seeAlso.map((w) => (
              <li key={w.id}>
                <Link href={workPath(w)}>{w.title}</Link>
                {w.composer && <span className="muted"> · {w.composer.name}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
