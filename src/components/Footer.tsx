import { Link } from "../lib/router";
import { FEEDBACK_MAILTO, REPO } from "../shared/paths";
import { DATA_LICENSE, DATASETS_URL, EXPORT_FILES, SOURCES, type Meta, type SourceId } from "../shared/data";

// ISO 8601, never locale-dependent.
const date = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "not yet");
const fmt = new Intl.NumberFormat("en");

export function Footer({ meta }: { meta: Meta | null }) {
  return (
    <footer className="footer">
      <div className="footer-dataset">
        <p>
          {meta ? (
            <>
              Dataset rebuilt <strong>{date(meta.builtAt)}</strong>: {fmt.format(meta.works)} works by {fmt.format(meta.composers)} composers,{" "}
              {fmt.format(meta.lineups)} line-ups.
            </>
          ) : (
            "Dataset not loaded."
          )}{" "}
          {meta && (
            <>
              Download it as <a href={`${DATASETS_URL}/${meta.version}/${EXPORT_FILES.csv}`}>CSV (zip)</a> or{" "}
              <a href={`${DATASETS_URL}/${meta.version}/${EXPORT_FILES.sqlite}`}>SQLite</a>, or use the <a href="/api">API</a>,{" "}
            </>
          )}
          licensed <a href={DATA_LICENSE.url}>{DATA_LICENSE.name}</a>.
        </p>
      </div>
      <table className="footer-sources">
        <caption>Sources</caption>
        <tbody>
          {(Object.keys(SOURCES) as SourceId[]).map((id) => {
            const s = SOURCES[id];
            const m = meta?.sources[id];
            return (
              <tr key={id}>
                <th scope="row">
                  <a href={s.url}>{s.name}</a>
                </th>
                <td>{s.role}</td>
                <td>
                  <a href={s.licenseUrl}>{s.license}</a>
                </td>
                <td className="muted">fetched {date(m?.fetchedAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p>
        <Link href="/about">About the data</Link>, its sources and license · An independent project, not affiliated with any of these sources ·
        Code on <a href={REPO}>GitHub</a> (MIT) · <a href={FEEDBACK_MAILTO}>Feedback welcome</a>
      </p>
    </footer>
  );
}
