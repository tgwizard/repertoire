import { useEffect, useMemo, useState } from "react";
import { EnsembleBuilder } from "./components/EnsembleBuilder";
import { Results } from "./components/Results";
import { getInstrumentations } from "./lib/api";
import {
  buildIndex,
  countFor,
  decodeEnsemble,
  describe,
  encodeEnsemble,
  ensembleKey,
  type Ensemble,
  type EnsembleEntry,
} from "./lib/instrumentation";
import { useDebounced } from "./lib/useDebounced";
import type { Source } from "./lib/useWorks";

function readUrl() {
  const p = new URLSearchParams(location.search);
  return { ensemble: decodeEnsemble(p.get("i")), includeArr: p.get("arr") === "1" };
}

export function App() {
  const [index, setIndex] = useState<Map<string, EnsembleEntry> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ensemble, setEnsemble] = useState<Ensemble>(() => readUrl().ensemble);
  const [includeArr, setIncludeArr] = useState(() => readUrl().includeArr);

  useEffect(() => {
    getInstrumentations()
      .then((r) => setIndex(buildIndex(r.categories.map(([name, count]) => ({ name, count })))))
      .catch((e: Error) => setLoadError(e.message));
  }, []);

  useEffect(() => {
    const p = new URLSearchParams();
    const enc = encodeEnsemble(ensemble);
    if (enc) p.set("i", enc);
    if (includeArr) p.set("arr", "1");
    const qs = p.toString().replaceAll("%2C", ",").replaceAll("%3A", ":");
    history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
    document.title = enc ? `${describe(ensemble)} · Repertoire Finder` : "Repertoire Finder";
  }, [ensemble, includeArr]);

  // Wait for the ensemble to settle before loading works, so clicking through
  // instruments doesn't fire a request per click.
  const settled = useDebounced(ensemble, 450);
  const entry = index?.get(ensembleKey(settled));
  const sources = useMemo<Source[]>(
    () =>
      entry
        ? [
            ...entry.original.map((c) => ({ ...c, arr: false })),
            ...(includeArr ? entry.arr.map((c) => ({ ...c, arr: true })) : []),
          ]
        : [],
    [entry, includeArr],
  );

  return (
    <div className="page">
      <header className="masthead">
        <h1>
          Repertoire <em>Finder</em>
        </h1>
        <p className="tagline">Music for the group you actually have, drawn from the public-domain scores on IMSLP.</p>
      </header>

      {loadError ? (
        <div className="notice error">Couldn't load instrumentations: {loadError}</div>
      ) : !index ? (
        <div className="notice">
          <span className="spinner" /> Loading the instrumentation catalogue… (the first load after a deploy takes a few seconds)
        </div>
      ) : (
        <>
          <EnsembleBuilder
            index={index}
            ensemble={ensemble}
            onChange={setEnsemble}
            includeArr={includeArr}
            onIncludeArrChange={setIncludeArr}
          />
          {sources.length > 0 && (
            <Results key={ensembleKey(settled)} sources={sources} total={countFor(entry, includeArr)} />
          )}
        </>
      )}

      <footer className="footer">
        Scores and metadata from <a href="https://imslp.org">IMSLP / Petrucci Music Library</a>; composer dates from{" "}
        <a href="https://www.wikidata.org">Wikidata</a>. An independent project, not affiliated with IMSLP.
      </footer>
    </div>
  );
}
