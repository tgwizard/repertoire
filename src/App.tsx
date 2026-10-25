import { useEffect, useRef } from "react";
import { AboutPage } from "./components/AboutPage";
import { ComposerPage } from "./components/ComposerPage";
import { FinderPage } from "./components/FinderPage";
import { Footer } from "./components/Footer";
import { WorkPage } from "./components/WorkPage";
import { lineupsPath, metaPath, useApi } from "./lib/api";
import { Link, parseRoute, useLocation } from "./lib/router";
import type { LineupsIndex, Meta } from "./shared/data";

function SiteTitle({ as: Tag }: { as: "h1" | "p" }) {
  return (
    <Tag className="site-title">
      <Link href="/" className="home-link">
        Repertoire <em>Finder</em>
      </Link>
    </Tag>
  );
}

export function App() {
  const loc = useLocation();
  const route = parseRoute(loc.pathname);
  const { data: meta } = useApi<Meta>(metaPath);
  const { data: index, error } = useApi<LineupsIndex>(lineupsPath);

  // The finder stays mounted under other pages; going back restores where you were
  // (a link to it, like the logo, starts at the top).
  const finderScroll = useRef(0);
  const wasFinder = useRef(route.name === "finder");
  useEffect(() => {
    const isFinder = route.name === "finder";
    if (isFinder && !wasFinder.current && loc.pop) requestAnimationFrame(() => window.scrollTo(0, finderScroll.current));
    wasFinder.current = isFinder;
    if (!isFinder) return;
    const save = () => (finderScroll.current = window.scrollY);
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.name]);

  return (
    <div className="page">
      <header className="masthead">
        <SiteTitle as={route.name === "finder" ? "h1" : "p"} />
      </header>

      {error ? (
        <div className="notice error">Couldn't load the repertoire: {error.message}.</div>
      ) : !index ? (
        <div className="notice">
          <span className="spinner" /> Loading the repertoire…
        </div>
      ) : (
        <FinderPage index={index} meta={meta} active={route.name === "finder"} navigation={loc.n} />
      )}
      {route.name === "work" && <WorkPage id={route.id} />}
      {route.name === "composer" && <ComposerPage key={route.id} id={route.id} />}
      {route.name === "about" && <AboutPage />}
      {route.name === "notfound" && <div className="notice">There's no page here. Try the search above.</div>}
      <Footer meta={meta} />
    </div>
  );
}
