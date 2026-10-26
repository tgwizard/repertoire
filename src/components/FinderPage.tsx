import { useEffect, useMemo, useState } from "react";
import { decodeEnsemble, describe, encodeEnsemble, ensembleKey, fitsIn, parseEnsembleKey, playerCount, type Ensemble } from "../lib/instrumentation";
import { defaultFilters, readFilters, writeFilters, type Filters } from "../lib/filters";
import { useDebounced } from "../lib/useDebounced";
import type { LineupsIndex, Meta } from "../shared/data";
import { Intro, NoMatches } from "./EmptyState";
import { EnsembleBuilder } from "./EnsembleBuilder";
import { Results } from "./Results";
import { SearchField, SearchResults } from "./Search";
import { navigate } from "../lib/router";
import { hasOrchestra } from "../lib/orchestration";

function readUrl() {
  const p = new URLSearchParams(location.search);
  const smaller = p.get("sub") === "1";
  return {
    ensemble: decodeEnsemble(p.get("i")),
    includeArr: p.get("arr") === "1",
    smaller,
    filters: readFilters(p, smaller),
    q: p.get("q") ?? "",
    orchestra: p.get("orch") ?? "",
    exact: p.get("fit") === "exact",
  };
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
  // An orchestra's scoring as typed ("2.2.2.2 4.2.3.1 timp str"), and whether to match it exactly
  const [orchestra, setOrchestra] = useState(() => readUrl().orchestra);
  const [exact, setExact] = useState(() => readUrl().exact);
  // Filters and sort on the works listed (start over with each new ensemble)
  const [filters, setFilters] = useState<Filters>(() => readUrl().filters);
  const changeEnsemble = (e: Ensemble) => {
    setEnsemble(e);
    setFilters(defaultFilters(smaller));
  };
  // Listing smaller groups too: largest first, all of them
  const changeSmaller = (v: boolean) => {
    setSmaller(v);
    setFilters((f) => ({ ...f, sort: defaultFilters(v).sort, order: undefined, within: "" }));
  };
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
    setOrchestra(url.orchestra);
    setExact(url.exact);
    setFilters(url.filters);
  }, [active, navigation]);

  useEffect(() => {
    if (!active) return;
    const p = new URLSearchParams();
    const enc = encodeEnsemble(ensemble);
    if (enc) p.set("i", enc);
    if (includeArr) p.set("arr", "1");
    if (smaller && enc) p.set("sub", "1");
    if (enc) writeFilters(p, filters, smaller);
    if (q) p.set("q", q);
    const orch = hasOrchestra(ensembleKey(ensemble)) ? orchestra.trim() : "";
    if (orch) p.set("orch", orch);
    if (orch && exact) p.set("fit", "exact");
    const qs = p.toString().replaceAll("%2C", ",").replaceAll("%3A", ":");
    history.replaceState(null, "", qs ? `/?${qs}` : "/");
    document.title = [q && `“${q}”`, enc && describe(ensemble), "Repertoire Finder"].filter(Boolean).join(" · ");
  }, [ensemble, includeArr, smaller, q, orchestra, exact, filters, active]);

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

  // Listing a line-up, the search sits with the filters (in Results); otherwise on its own.
  const listing = !!settledKey && Object.keys(ensemble).length > 0 && (count(ensemble) > 0 || smaller);
  const search = <SearchField id="search" value={query} onChange={setQuery} narrowed={Object.keys(ensemble).length > 0} />;

  const main = () => {
    if (Object.keys(ensemble).length === 0) return q ? <SearchResults q={q} /> : <Intro meta={meta} />;
    if (count(ensemble) === 0 && !smaller) {
      return (
        <NoMatches
          ensemble={ensemble}
          count={count}
          arrangements={index.lineups[ensembleKey(ensemble)]?.[1] ?? 0}
          smallerGroups={smallerGroups}
          onChange={changeEnsemble}
          onIncludeArr={() => setIncludeArr(true)}
          onSmaller={() => changeSmaller(true)}
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
        onSmallerChange={changeSmaller}
        smallerGroups={smallerGroups}
        q={q}
        search={search}
        filters={filters}
        onFiltersChange={setFilters}
        orchestra={orchestra}
        onOrchestraChange={setOrchestra}
        exact={exact}
        onExactChange={setExact}
        // A new history entry, so going back returns to the line-up.
        onSearchEverywhere={() => navigate(`/?q=${encodeURIComponent(q)}`)}
      />
    );
  };

  return (
    <div className="layout" hidden={!active}>
      <aside className="sidebar">
        <EnsembleBuilder count={count} ensemble={ensemble} onChange={changeEnsemble} includeArr={includeArr} onIncludeArrChange={setIncludeArr} />
      </aside>
      {/* The same box as the filters' (in Results), with only the search in it */}
      {!listing && (
        <div className="main-search">
          <div className="filter-box">{search}</div>
        </div>
      )}
      <div className="main">{main()}</div>
    </div>
  );
}
