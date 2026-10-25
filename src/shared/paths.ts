// URLs of the app's pages, shared by the app and the Worker that renders them.

import { encodeEnsemble, parseEnsembleKey } from "../lib/instrumentation.ts";
import { slug } from "./text.ts";

/** /work/<id>/<readable slug>; only the id matters. */
export const workPath = (w: { id: string; title: string; composer: { name: string } | null }) =>
  `/work/${w.id}/${slug(`${w.composer?.name.split(" ").at(-1) ?? ""} ${w.title}`)}`;
export const composerPath = (c: { id: string; name: string }) => `/composer/${c.id}/${slug(c.name)}`;
export const finderPath = (lineup: string, arrangement = false) => `/?i=${encodeEnsemble(parseEnsembleKey(lineup))}${arrangement ? "&arr=1" : ""}`;
export const searchPath = (q: string) => `/search?q=${encodeURIComponent(q)}`;

/** "1833–1897" */
export const lifespan = (c: { born: number | null; died: number | null } | null) => (c && (c.born || c.died) ? `${c.born ?? "?"}–${c.died ?? ""}` : null);

export const REPO = "https://github.com/tgwizard/repertoire";
export const FEEDBACK_MAILTO = "mailto:tgwizard@gmail.com?subject=%5BRepertoire%20Feedback%5D%3A%20";
