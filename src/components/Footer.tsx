import { Link } from "../lib/router";
import { DATA_LICENSE, type Meta } from "../shared/data";

const fmt = new Intl.NumberFormat("en");

// The rest (sources, code, feedback) is on the about page
export function Footer({ meta }: { meta: Meta | null }) {
  return (
    <footer className="footer">
      <p>
        {meta && (
          <>
            Dataset rebuilt <strong>{meta.builtAt.slice(0, 10)}</strong>: {fmt.format(meta.works)} works by {fmt.format(meta.composers)} composers.{" "}
          </>
        )}
        <Link href="/about">About</Link>. Licensed <a href={DATA_LICENSE.url}>{DATA_LICENSE.name}</a>.
      </p>
    </footer>
  );
}
