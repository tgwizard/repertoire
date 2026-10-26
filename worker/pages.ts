// Work and composer pages: the app's index.html with the page's title, description,
// structured data and content filled in on the server, so links preview well and
// search engines see the content. The app then takes over in the browser.

import { describe, parseEnsembleKey } from "../src/lib/instrumentation.ts";
import type { ComposerDetail, WorkDetail } from "../src/shared/data.ts";
import { composerPath, formatDuration, workPath } from "../src/shared/paths.ts";
import { getComposer, getWork, type Db } from "./queries.ts";

const SITE = "Repertoire Finder";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** JSON safe to embed in a <script> element */
const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c");

interface Page {
  status: number;
  title: string;
  description: string;
  canonical: string | null;
  jsonLd: unknown;
  body: string;
  initial: unknown;
}

const life = (c: { born: number | null; died: number | null }) => (c.born || c.died ? ` (${c.born ?? "?"}–${c.died ?? ""})` : "");

function workPage(w: WorkDetail, origin: string): Page {
  const originals = w.scorings.filter((s) => !s.arrangement);
  const forWhom = (originals[0] ?? w.scorings[0])!;
  const score = w.links.find((l) => l.kind === "score");
  const by = w.composer ? ` by ${w.composer.name}` : "";
  const description =
    `${w.title}${by}${w.year ? ` (${w.year})` : ""}, for ${describe(parseEnsembleKey(forWhom.lineup))}.` +
    (originals.length > 1 ? ` Also for ${originals.length - 1} other line-up${originals.length > 2 ? "s" : ""}.` : "") +
    (w.orchestration ? ` Scoring: ${w.orchestration.scoring}.` : "") +
    (w.duration ? ` About ${formatDuration(w.duration)}.` : "") +
    (score ? " Free sheet music on IMSLP." : "");
  const url = `${origin}${workPath(w)}`;
  return {
    status: 200,
    title: `${w.title}${w.composer ? ` – ${w.composer.name}` : ""} · ${SITE}`,
    description,
    canonical: url,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "MusicComposition",
      name: w.title,
      url,
      ...(w.composer ? { composer: { "@type": "Person", name: w.composer.name, url: `${origin}${composerPath(w.composer)}` } } : {}),
      ...(w.year ? { dateCreated: String(w.year) } : {}),
      sameAs: w.links.filter((l) => l.url).map((l) => l.url),
    },
    body: `<main class="ssr"><h1>${esc(w.title)}</h1>${w.composer ? `<p><a href="${composerPath(w.composer)}">${esc(w.composer.name)}</a>${esc(life(w.composer))}</p>` : ""}
<p>${esc(description)}</p><ul>${w.links.filter((l) => l.url).map((l) => `<li><a href="${esc(l.url!)}">${esc(l.provider)}</a></li>`).join("")}</ul></main>`,
    initial: { type: "work", id: w.id, data: w },
  };
}

function composerPage(c: ComposerDetail, origin: string): Page {
  const url = `${origin}${composerPath(c)}`;
  const top = c.lineups.slice(0, 3).map((l) => l.description);
  const description = `${c.name}${life(c)}: ${c.works} works${top.length ? `, mostly for ${top.join("; ")}` : ""}. Find the ones for your ensemble.`;
  return {
    status: 200,
    title: `${c.name} · ${SITE}`,
    description,
    canonical: url,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Person",
      name: c.name,
      url,
      ...(c.born ? { birthDate: String(c.born) } : {}),
      ...(c.died ? { deathDate: String(c.died) } : {}),
      sameAs: c.links.filter((l) => l.url).map((l) => l.url),
    },
    body: `<main class="ssr"><h1>${esc(c.name)}${esc(life(c))}</h1><p>${esc(description)}</p></main>`,
    initial: { type: "composer", id: c.id, data: c },
  };
}

const notFound = (what: string): Page => ({
  status: 404,
  title: `Not found · ${SITE}`,
  description: `No such ${what}.`,
  canonical: null,
  jsonLd: null,
  body: `<main class="ssr"><h1>Not found</h1></main>`,
  initial: { type: "notfound" },
});

/** Renders /work/<id>/… and /composer/<id>/…, or null for other paths. */
export async function renderPage(request: Request, db: Db, indexHtml: () => Promise<Response>): Promise<Response | null> {
  const url = new URL(request.url);
  const m = /^\/(work|composer)\/([0-9a-z]{8})(?:\/[^/]*)?\/?$/.exec(url.pathname);
  if (!m) return null;
  const [, type, id] = m as unknown as [string, "work" | "composer", string];
  let page: Page;
  if (type === "work") {
    const r = await getWork(db, id);
    if (r && "redirect" in r) return Response.redirect(`${url.origin}/work/${r.redirect}`, 301);
    page = r ? workPage(r.found, url.origin) : notFound("work");
  } else {
    const r = await getComposer(db, id);
    if (r && "redirect" in r) return Response.redirect(`${url.origin}/composer/${r.redirect}`, 301);
    page = r ? composerPage(r.found, url.origin) : notFound("composer");
  }

  const html = await indexHtml();
  const head = [
    `<meta property="og:title" content="${esc(page.title)}" />`,
    `<meta property="og:description" content="${esc(page.description)}" />`,
    `<meta property="og:site_name" content="${SITE}" />`,
    page.canonical ? `<link rel="canonical" href="${esc(page.canonical)}" /><meta property="og:url" content="${esc(page.canonical)}" />` : `<meta name="robots" content="noindex" />`,
    page.jsonLd ? `<script type="application/ld+json">${scriptJson(page.jsonLd)}</script>` : "",
    `<script id="initial-data" type="application/json">${scriptJson(page.initial)}</script>`,
  ].join("\n");
  const rewritten = new HTMLRewriter()
    .on("title", { element: (e) => void e.setInnerContent(page.title) })
    .on('meta[name="description"]', { element: (e) => void e.setAttribute("content", page.description) })
    .on("head", { element: (e) => void e.append(head, { html: true }) })
    .on("#root", { element: (e) => void e.setInnerContent(page.body, { html: true }) })
    .transform(html);
  return new Response(rewritten.body, { status: page.status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
