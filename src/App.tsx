import { useEffect, useRef } from "react";
import { AboutPage } from "./components/AboutPage";
import { ComposerPage } from "./components/ComposerPage";
import { FinderPage } from "./components/FinderPage";
import { Footer } from "./components/Footer";
import { SearchBox, SearchPage } from "./components/Search";
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
  const route = parseRoute(loc.pathname, loc.search);
  const { data: meta } = useApi<Meta>(metaPath);
  const { data: index, error } = useApi<LineupsIndex>(lineupsPath);

  // The finder stays mounted under other pages; going back restores where you were.
  const finderScroll = useRef(0);
  const wasFinder = useRef(route.name === "finder");
  useEffect(() => {
    const isFinder = route.name === "finder";
    if (isFinder && !wasFinder.current) requestAnimationFrame(() => window.scrollTo(0, finderScroll.current));
    wasFinder.current = isFinder;
    if (!isFinder) return;
    const save = () => (finderScroll.current = window.scrollY);
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, [route.name]);

  return (
    <div className="page">
      <header className="masthead">
        <div className="masthead-row">
          {/* The site's name is the page heading only on the finder; other pages have their own. */}
          <SiteTitle as={route.name === "finder" ? "h1" : "p"} />
          <SearchBox initial={route.name === "search" ? route.q : ""} />
        </div>
        <p className="tagline">
          The repertoire for the group you actually have, with sheet music from IMSLP where it exists.{" "}
          <a href="https://github.com/tgwizard/repertoire/issues">Bugs</a> and{" "}
          <a href="mailto:tgwizard@gmail.com?subject=%5Brepertoire%5D%20bug">feedback</a> welcome.{" "}
          <Link href="/about">About the data</Link>.
        </p>
      </header>

      {error ? (
        <div className="notice error">Couldn't load the repertoire: {error.message}.</div>
      ) : !index ? (
        <div className="notice">
          <span className="spinner" /> Loading the repertoire…
        </div>
      ) : (
        <FinderPage index={index} meta={meta} active={route.name === "finder"} />
      )}
      {route.name === "work" && <WorkPage id={route.id} />}
      {route.name === "composer" && <ComposerPage key={route.id} id={route.id} />}
      {route.name === "search" && <SearchPage q={route.q} />}
      {route.name === "about" && <AboutPage />}
      {route.name === "notfound" && <div className="notice">There's no page here. Try the search above.</div>}
      <Footer meta={meta} />
    </div>
  );
}
