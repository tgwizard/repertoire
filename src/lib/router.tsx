// A small client-side router: the History API, and <Link> for in-app navigation
// (ordinary links still work with modifier keys, new tabs, and without JavaScript).

import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";

export type Route =
  | { name: "finder" }
  | { name: "work"; id: string }
  | { name: "composer"; id: string }
  | { name: "about" }
  | { name: "notfound" };

export function parseRoute(pathname: string): Route {
  // Search is part of the finder; /search?q=… is an older address for it.
  if (pathname === "/" || pathname === "" || pathname === "/search") return { name: "finder" };
  let m = /^\/work\/([0-9a-z]{8})(?:\/[^/]*)?\/?$/.exec(pathname);
  if (m) return { name: "work", id: m[1]! };
  m = /^\/composer\/([0-9a-z]{8})(?:\/[^/]*)?\/?$/.exec(pathname);
  if (m) return { name: "composer", id: m[1]! };
  if (pathname === "/about" || pathname === "/about/") return { name: "about" };
  return { name: "notfound" };
}

const EVENT = "app:navigate";

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  window.dispatchEvent(new Event(EVENT));
}

export interface Location {
  pathname: string;
  search: string;
  /** Counts navigations, so going to the same URL again still registers */
  n: number;
  /** Back or forward (restore where you were) rather than a link (start fresh) */
  pop: boolean;
}

export function useLocation(): Location {
  const read = (n: number, pop: boolean) => ({ pathname: location.pathname, search: location.search, n, pop });
  const [loc, setLoc] = useState(() => read(0, false));
  useEffect(() => {
    const onPop = () => setLoc((l) => read(l.n + 1, true));
    const onNavigate = () => setLoc((l) => read(l.n + 1, false));
    window.addEventListener("popstate", onPop);
    window.addEventListener(EVENT, onNavigate);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener(EVENT, onNavigate);
    };
  }, []);
  return loc;
}

export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const click = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(href);
    window.scrollTo(0, 0);
  };
  return <a href={href} onClick={click} {...rest} />;
}
