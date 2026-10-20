import { useEffect, useState } from "react";
import { Intro, NoMatches } from "./components/EmptyState";
import { EnsembleBuilder } from "./components/EnsembleBuilder";
import { Footer } from "./components/Footer";
import { Results } from "./components/Results";
import { loadEnsembles, loadMeta } from "./lib/data";
import { decodeEnsemble, describe, encodeEnsemble, ensembleKey, type Ensemble } from "./lib/instrumentation";
import { useDebounced } from "./lib/useDebounced";
import type { EnsemblesFile, MetaFile } from "./shared/data";

function readUrl() {
  const p = new URLSearchParams(location.search);
  return { ensemble: decodeEnsemble(p.get("i")), includeArr: p.get("arr") === "1" };
}

export function App() {
  const [index, setIndex] = useState<EnsemblesFile["ensembles"] | null>(null);
  const [meta, setMeta] = useState<MetaFile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ensemble, setEnsemble] = useState<Ensemble>(() => readUrl().ensemble);
  const [includeArr, setIncludeArr] = useState(() => readUrl().includeArr);

  useEffect(() => {
    loadEnsembles()
      .then((r) => setIndex(r.ensembles))
      .catch((e: Error) => setLoadError(e.message));
    loadMeta()
      .then(setMeta)
      .catch(() => {});
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

  const count = (e: Ensemble) => {
    const entry = index?.[ensembleKey(e)];
    return entry ? entry[0] + (includeArr ? entry[1] : 0) : 0;
  };

  // Wait for the ensemble to settle before loading works.
  const settled = useDebounced(ensemble, 300);
  const settledKey = ensembleKey(settled);
  const settledEntry = index?.[settledKey];

  const main = () => {
    if (Object.keys(ensemble).length === 0) return <Intro meta={meta} />;
    if (count(ensemble) === 0) {
      return (
        <NoMatches
          ensemble={ensemble}
          count={count}
          arrangements={index?.[ensembleKey(ensemble)]?.[1] ?? 0}
          onChange={setEnsemble}
          onIncludeArr={() => setIncludeArr(true)}
        />
      );
    }
    if (!settledEntry || count(settled) === 0) return null;
    return <Results key={settledKey} ensembleKey={settledKey} shards={settledEntry[2]} total={count(settled)} includeArr={includeArr} />;
  };

  return (
    <div className="page">
      <header className="masthead">
        <h1>
          Repertoire <em>Finder</em>
        </h1>
        <p className="tagline">
          The repertoire for the group you actually have, with sheet music from IMSLP where it exists.{" "}
          <a href="https://github.com/tgwizard/repertoire/issues">Bugs</a> and{" "}
          <a href="mailto:tgwizard@gmail.com?subject=%5Brepertoire%5D%20bug">feedback</a> welcome.
        </p>
      </header>

      {loadError ? (
        <div className="notice error">
          Couldn't load the repertoire index: {loadError}. Get it with <code>npm run data:pull</code>.
        </div>
      ) : !index ? (
        <div className="notice">
          <span className="spinner" /> Loading the repertoire index…
        </div>
      ) : (
        <div className="layout">
          <aside className="sidebar">
            <EnsembleBuilder
              count={count}
              ensemble={ensemble}
              onChange={setEnsemble}
              includeArr={includeArr}
              onIncludeArrChange={setIncludeArr}
            />
          </aside>
          <main className="main">{main()}</main>
        </div>
      )}

      <Footer meta={meta} />
    </div>
  );
}
