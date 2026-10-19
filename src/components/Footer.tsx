import { DATASETS_URL, EXPORT_FILES, SOURCES, type MetaFile, type SourceId } from "../shared/data";

const ROLE: Record<SourceId, string> = {
  imslp: "Instrumentation, works and sheet music",
  wikipedia: "Curated “Compositions for …” lists",
  wikidata: "Links between sources, dates",
  openopus: "Popular and recommended works",
  musicbrainz: "Recording counts",
};

const date = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en", { year: "numeric", month: "short", day: "numeric" }) : "not yet";
const fmt = new Intl.NumberFormat("en");

export function Footer({ meta }: { meta: MetaFile | null }) {
  return (
    <footer className="footer">
      <div className="footer-dataset">
        <p>
          {meta ? (
            <>
              Dataset rebuilt <strong>{date(meta.builtAt)}</strong>: {fmt.format(meta.works)} works, {fmt.format(meta.ensembles)} line-ups.
            </>
          ) : (
            "Dataset not built yet."
          )}{" "}
          {meta && (
            <>
              Download it as <a href={`${DATASETS_URL}/${meta.version}/${EXPORT_FILES.csv}`}>CSV (zip)</a> or{" "}
              <a href={`${DATASETS_URL}/${meta.version}/${EXPORT_FILES.sqlite}`}>SQLite</a>,{" "}
            </>
          )}
          licensed <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>.
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
                <td>{ROLE[id]}</td>
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
        An independent project, not affiliated with any of these sources. Code on{" "}
        <a href="https://github.com/tgwizard/repertoire">GitHub</a> (MIT).
      </p>
    </footer>
  );
}
