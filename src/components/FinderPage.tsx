import { useEffect, useMemo, useState } from "react";
import { decodeEnsemble, describe, encodeEnsemble, ensembleKey, fitsIn, parseEnsembleKey, playerCount, type Ensemble } from "../lib/instrumentation";
import { useDebounced } from "../lib/useDebounced";
import type { LineupsIndex, Meta } from "../shared/data";
import { Intro, NoMatches } from "./EmptyState";
import { EnsembleBuilder } from "./EnsembleBuilder";
import { Results } from "./Results";

function readUrl() {
  const p = new URLSearchParams(location.search);
  return { ensemble: decodeEnsemble(p.get("i")), includeArr: p.get("arr") === "1", smaller: p.get("sub") === "1" };
}

interface Props {
  index: LineupsIndex;
  meta: Meta | null;
  /** Hidden while another page shows; it stays mounted so going back keeps its state. */
  active: boolean;
}

export function FinderPage({ index, meta, active }: Props) {
  const [ensemble, setEnsemble] = useState<Ensemble>(() => readUrl().ensemble);
  const [includeArr, setIncludeArr] = useState(() => readUrl().includeArr);
  const [smaller, setSmaller] = useState(() => readUrl().smaller);

  // Coming back to "/" with a different line-up in the URL (a link from a work page).
  useEffect(() => {
    if (!active) return;
    const url = readUrl();
    if (ensembleKey(url.ensemble) && ensembleKey(url.ensemble) !== ensembleKey(ensemble)) {
      setEnsemble(url.ensemble);
      setIncludeArr(url.includeArr);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const p = new URLSearchParams();
    const enc = encodeEnsemble(ensemble);
    if (enc) p.set("i", enc);
    if (includeArr) p.set("arr", "1");
    if (smaller && enc) p.set("sub", "1");
    const qs = p.toString().replaceAll("%2C", ",").replaceAll("%3A", ":");
    history.replaceState(null, "", qs ? `/?${qs}` : "/");
    document.title = enc ? `${describe(ensemble)} · Repertoire Finder` : "Repertoire Finder";
  }, [ensemble, includeArr, smaller, active]);

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
    if (Object.keys(ensemble).length === 0) return <Intro meta={meta} />;
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
      />
    );
  };

  return (
    <div className="layout" hidden={!active}>
      <aside className="sidebar">
        <EnsembleBuilder count={count} ensemble={ensemble} onChange={setEnsemble} includeArr={includeArr} onIncludeArrChange={setIncludeArr} />
      </aside>
      <div className="main">{main()}</div>
    </div>
  );
}
