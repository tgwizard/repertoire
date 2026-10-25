import { Link } from "../lib/router";
import { DATA_LICENSE, type Meta } from "../shared/data";
import { FEEDBACK_MAILTO, REPO } from "../shared/paths";

const fmt = new Intl.NumberFormat("en");

export function Footer({ meta }: { meta: Meta | null }) {
  return (
    <footer className="footer">
      <p>
        {meta && (
          <>
            Dataset rebuilt <strong>{meta.builtAt.slice(0, 10)}</strong>: {fmt.format(meta.works)} works by {fmt.format(meta.composers)} composers.{" "}
          </>
        )}
        <Link href="/about">About the data</Link>: its sources, downloads and API. Licensed <a href={DATA_LICENSE.url}>{DATA_LICENSE.name}</a>.
      </p>
      <p>
        Code on <a href={REPO}>GitHub</a> (MIT) · <a href={FEEDBACK_MAILTO}>Feedback welcome</a> · Not affiliated with IMSLP or the other sources.
      </p>
    </footer>
  );
}
