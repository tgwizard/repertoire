// A small client-side router: the History API, and <Link> for in-app navigation
// (ordinary links still work with modifier keys, new tabs, and without JavaScript).

import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";

export type Route =
  | { name: "finder" }
  | { name: "work"; id: string }
  | { name: "composer"; id: string }
  | { name: "search"; q: string }
  | { name: "about" }
  | { name: "notfound" };

export function parseRoute(pathname: string, search: string): Route {
  if (pathname === "/" || pathname === "") return { name: "finder" };
  let m = /^\/work\/([0-9a-z]{8})(?:\/[^/]*)?\/?$/.exec(pathname);
  if (m) return { name: "work", id: m[1]! };
  m = /^\/composer\/([0-9a-z]{8})(?:\/[^/]*)?\/?$/.exec(pathname);
  if (m) return { name: "composer", id: m[1]! };
  if (pathname === "/about" || pathname === "/about/") return { name: "about" };
  if (pathname === "/search") return { name: "search", q: new URLSearchParams(search).get("q") ?? "" };
  return { name: "notfound" };
}

const EVENT = "app:navigate";

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  window.dispatchEvent(new Event(EVENT));
}

export function useLocation(): { pathname: string; search: string } {
  const read = () => ({ pathname: location.pathname, search: location.search });
  const [loc, setLoc] = useState(read);
  useEffect(() => {
    const update = () => setLoc(read());
    window.addEventListener("popstate", update);
    window.addEventListener(EVENT, update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener(EVENT, update);
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
