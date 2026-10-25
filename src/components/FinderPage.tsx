import { useEffect, useMemo, useState } from "react";
import { decodeEnsemble, describe, encodeEnsemble, ensembleKey, fitsIn, parseEnsembleKey, playerCount, type Ensemble } from "../lib/instrumentation";
import { useDebounced } from "../lib/useDebounced";
import type { LineupsIndex, Meta } from "../shared/data";
import { Intro, NoMatches } from "./EmptyState";
import { EnsembleBuilder } from "./EnsembleBuilder";
import { Results } from "./Results";
import { SearchField, SearchResults } from "./Search";
import { navigate } from "../lib/router";

function readUrl() {
  const p = new URLSearchParams(location.search);
  return { ensemble: decodeEnsemble(p.get("i")), includeArr: p.get("arr") === "1", smaller: p.get("sub") === "1", q: p.get("q") ?? "" };
}

interface Props {
  index: LineupsIndex;
  meta: Meta | null;
  /** Hidden while another page shows; it stays mounted so going back keeps its state. */
  active: boolean;
  /** Changes with every navigation (see useLocation) */
  navigation: number;
}

export function FinderPage({ index, meta, active, navigation }: Props) {
  const [ensemble, setEnsemble] = useState<Ensemble>(() => readUrl().ensemble);
  const [includeArr, setIncludeArr] = useState(() => readUrl().includeArr);
  const [smaller, setSmaller] = useState(() => readUrl().smaller);
  const [query, setQuery] = useState(() => readUrl().q);
  const q = useDebounced(query.trim(), 250);

  // Arriving at "/": the URL says what to show. A link from a work page names a
  // line-up; the logo names none, which starts over; going back restores the URL we left.
  useEffect(() => {
    if (!active) return;
    const url = readUrl();
    setEnsemble((e) => (ensembleKey(url.ensemble) === ensembleKey(e) ? e : url.ensemble));
    setIncludeArr(url.includeArr);
    setSmaller(url.smaller);
    setQuery(url.q);
  }, [active, navigation]);

  useEffect(() => {
    if (!active) return;
    const p = new URLSearchParams();
    const enc = encodeEnsemble(ensemble);
    if (enc) p.set("i", enc);
    if (includeArr) p.set("arr", "1");
    if (smaller && enc) p.set("sub", "1");
    if (q) p.set("q", q);
    const qs = p.toString().replaceAll("%2C", ",").replaceAll("%3A", ":");
    history.replaceState(null, "", qs ? `/?${qs}` : "/");
    document.title = [q && `“${q}”`, enc && describe(ensemble), "Repertoire Finder"].filter(Boolean).join(" · ");
  }, [ensemble, includeArr, smaller, q, active]);

  const count = (e: Ensemble) => {
    const entry = index.lineups[ensembleKey(e)];
    return entry ? entry[0] + (includeArr ? entry[1] : 0) : 0;
  };

  // Wait for the ensemble to settle before loading works.
  const settled = useDebounced(ensemble, 300);
  const settledKey = ensembleKey(settled);

  // Smaller groups drawn from the ensemble that have works of their own.
  const smallerGroups = useMemo(() => {
    if (!settledKey) return 0;
    const group = parseEnsembleKey(settledKey);
    return Object.entries(index.lineups).filter(([k, [orig, arr]]) => {
      if (k === settledKey || orig + (includeArr ? arr : 0) === 0) return false;
      const e = parseEnsembleKey(k);
      return playerCount(e) >= 2 && fitsIn(e, group);
    }).length;
  }, [index, settledKey, includeArr]);

  const main = () => {
    if (Object.keys(ensemble).length === 0) return q ? <SearchResults q={q} /> : <Intro meta={meta} />;
    if (count(ensemble) === 0 && !smaller) {
      return (
        <NoMatches
          ensemble={ensemble}
          count={count}
          arrangements={index.lineups[ensembleKey(ensemble)]?.[1] ?? 0}
          smallerGroups={smallerGroups}
          onChange={setEnsemble}
          onIncludeArr={() => setIncludeArr(true)}
          onSmaller={() => setSmaller(true)}
        />
      );
    }
    if (!settledKey) return null;
    return (
      <Results
        key={settledKey}
        lineup={settledKey}
        total={count(settled)}
        includeArr={includeArr}
        smaller={smaller}
        onSmallerChange={setSmaller}
        smallerGroups={smallerGroups}
        q={q}
        // A new history entry, so going back returns to the line-up.
        onSearchEverywhere={() => navigate(`/?q=${encodeURIComponent(q)}`)}
      />
    );
  };

  return (
    <div className="layout" hidden={!active}>
      <aside className="sidebar">
        <EnsembleBuilder count={count} ensemble={ensemble} onChange={setEnsemble} includeArr={includeArr} onIncludeArrChange={setIncludeArr} />
      </aside>
      <div className="main-search">
        <SearchField value={query} onChange={setQuery} narrowed={Object.keys(ensemble).length > 0} />
      </div>
      <div className="main">{main()}</div>
    </div>
  );
}
