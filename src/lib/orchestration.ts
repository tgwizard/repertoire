// An orchestra's scoring, as orchestras write it: "2.2.2.2 – 4.2.3.1 – timp – perc – hp – str".
// Players per instrument; the shorthand's eight numbers are sections (flutes, oboes,
// clarinets, bassoons; horns, trumpets, trombones, tubas). An auxiliary (piccolo, English
// horn, …) after a section is a player of its own ("2+picc": two flutes and a piccolo);
// after a slash it's doubled by one of the section's players ("2/picc": two flutes, one
// of them also playing piccolo). The same goes for a pianist playing celesta ("pf/cel").

/** Instrument → players; "fl/picc" → players of the section who also play piccolo */
export type Orchestration = Record<string, number>;

/** Section → its auxiliary instruments */
export const SECTIONS: [string, string[]][] = [
  ["fl", ["picc", "afl", "bfl"]],
  ["ob", ["eh", "oda", "bob", "hck"]],
  ["cl", ["ebcl", "bcl", "bhn", "cbcl"]],
  ["bn", ["cbn"]],
  ["hn", ["wtba"]],
  ["tpt", ["crt", "flhn"]],
  ["tbn", []],
  ["tba", ["euph"]],
];
/** Everything else, in score order */
export const OTHERS = ["timp", "perc", "hp", "cel", "pf", "org", "hpd", "harm", "bc", "rec", "gtr", "mand", "sax", "str"];

/** Instruments a player of another can double on: auxiliary → the main instrument */
export const DOUBLED: Record<string, string> = {
  ...Object.fromEntries(SECTIONS.flatMap(([s, aux]) => aux.map((a) => [a, s]))),
  cel: "pf",
};

export const LABELS: Record<string, string> = {
  fl: "flute", picc: "piccolo", afl: "alto flute", bfl: "bass flute",
  ob: "oboe", eh: "English horn", oda: "oboe d'amore", bob: "bass oboe", hck: "heckelphone",
  cl: "clarinet", ebcl: "E♭ clarinet", bcl: "bass clarinet", bhn: "basset horn", cbcl: "contrabass clarinet",
  bn: "bassoon", cbn: "contrabassoon",
  hn: "horn", wtba: "Wagner tuba",
  tpt: "trumpet", crt: "cornet", flhn: "flugelhorn",
  tbn: "trombone", tba: "tuba", euph: "euphonium",
  timp: "timpani", perc: "percussion", hp: "harp", cel: "celesta", pf: "piano", org: "organ", hpd: "harpsichord", harm: "harmonium", bc: "continuo",
  rec: "recorder", gtr: "guitar", mand: "mandolin", sax: "saxophone", str: "strings",
};

const doubles = (o: Orchestration, main: string) =>
  Object.entries(o)
    .filter(([k, n]) => n > 0 && k.startsWith(`${main}/`))
    .map(([k, n]) => [k.slice(main.length + 1), n] as const);

/** "2.2.2.2+cbn – 4.2.3.1 – timp – 2perc – hp – str", "3/picc.2.2.2 …", "pf/cel" */
export function formatOrchestration(o: Orchestration): string {
  const extra = (main: string, aux: string[]) =>
    doubles(o, main).map(([a, n]) => `/${n > 1 ? n : ""}${a}`).join("") + aux.filter((a) => o[a]).map((a) => `+${o[a]! > 1 ? o[a] : ""}${a}`).join("");
  const section = ([s, aux]: [string, string[]]) => String(o[s] ?? 0) + extra(s, aux);
  const groups = [SECTIONS.slice(0, 4).map(section).join("."), SECTIONS.slice(4).map(section).join(".")];
  for (const k of OTHERS) if (o[k]) groups.push((k === "str" || o[k] === 1 ? k : `${o[k]}${k}`) + doubles(o, k).map(([a, n]) => `/${n > 1 ? n : ""}${a}`).join(""));
  return groups.join(" – ");
}

// What people type, beyond the abbreviations above
const ALIASES: Record<string, string> = {
  pic: "picc", piccolo: "picc", "e.h": "eh", ca: "eh", cor: "eh", ehn: "eh", "bcl.": "bcl", bcl: "bcl", "b.cl": "bcl", ebcl: "ebcl", cbsn: "cbn", cfg: "cbn", kfg: "cbn",
  hrn: "hn", tp: "tpt", trp: "tpt", trb: "tbn", tb: "tba", tu: "tba", pk: "timp", ti: "timp", timpani: "timp", tmp: "timp", "timp.": "timp", pc: "perc", perc: "perc", percussion: "perc",
  harp: "hp", hrp: "hp", hf: "hp", fg: "bn", kl: "cl", pos: "tbn", schlz: "perc", celesta: "cel", piano: "pf", pno: "pf", kbd: "pf", organ: "org", harpsichord: "hpd", cemb: "hpd", continuo: "bc", cont: "bc", strings: "str", strs: "str", "str.": "str",
  harmonium: "harm", recorder: "rec", heckelphone: "hck",
};
const code = (w: string): string | undefined => {
  const k = w.toLowerCase();
  // "harps", "celestas"
  return k in LABELS ? k : (ALIASES[k] ?? (k.endsWith("s") ? code(k.slice(0, -1)) : undefined));
};

/**
 * Parses the shorthand: "2.2.2.2 4.2.3.1 timp str", "2222 4231 timp perc hp str",
 * "3+picc.2+eh.2.2 – 4.3.3.1 – timp – 3perc – 2hp – cel – str", "3/picc.2.2.2 … pf/cel".
 * Returns null if it isn't one.
 */
export const parseOrchestration = (input: string) => readOrchestration(input).orchestration;

/** Typical orchestras, to start from */
export const EXAMPLES: [label: string, scoring: string][] = [
  ["Classical", "2.2.2.2 2.2.0.0 timp str"],
  ["Romantic", "2.2.2.2 4.2.3.1 timp perc str"],
  ["Large", "3/picc+picc.3+eh.3+bcl.3+cbn 6.4.3.1 timp 3perc 2hp pf/cel str"],
  ["Chamber", "1.1.1.1 1.1.0.0 timp str"],
];

/** The shorthand read, or the part of it that can't be: "timp perc harpz" → "harpz" */
export function readOrchestration(input: string): { orchestration: Orchestration | null; unreadable: string | null } {
  const o: Orchestration = {};
  const add = (k: string, n: number) => (o[k] = (o[k] ?? 0) + n);
  const fail = (t: string) => ({ orchestration: null, unreadable: t });
  // "/picc", "+2picc": a doubling or a player of its own, of the instrument before
  const extras = (main: string, rest: string): boolean => {
    for (const m of rest.matchAll(/([+/])(\d*)([a-z.]+)/gi)) {
      const k = code(m[3]!);
      if (!k) return false;
      if (m[1] === "/") {
        if (DOUBLED[k] !== main) return false; // a flautist doubles piccolo, not tuba
        add(`${main}/${k}`, Number(m[2] || 1));
      } else add(k, Number(m[2] || 1));
    }
    return rest.replace(/([+/])(\d*)([a-z.]+)/gi, "") === ""; // all of it read
  };
  const tokens = input
    .replace(/[–—,;]/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t && t !== "-")
    // "timp+perc+str", like "2+picc"
    .flatMap((t) => (/^[a-z]/i.test(t) ? t.split("+").filter(Boolean) : [t]));
  let section = 0;
  for (const t of tokens) {
    // A group of sections: "2.2.2.2", "2222", "3+picc.2.2+bcl.2", "3/picc.2.2.2"
    const parts = /^\d/.test(t) ? (t.includes(".") ? t.split(".") : /^\d{4}$/.test(t) ? [...t] : null) : null;
    if (parts && parts.every((p) => /^\d+([+/]\d*[a-z.]+)*$/i.test(p))) {
      if (section + parts.length > SECTIONS.length) return fail(t);
      for (const p of parts) {
        const [, n, rest] = /^(\d+)(.*)$/.exec(p)!;
        const main = SECTIONS[section]![0];
        add(main, Number(n));
        if (!extras(main, rest!)) return fail(t);
        section++;
      }
      continue;
    }
    // "timp", "3perc", "2hp", "perc(3)", "pf/cel"
    const m = /^(\d*)([a-z.]+)(?:\((\d+)\))?((?:\/\d*[a-z.]+)*)$/i.exec(t);
    const k = m && code(m[2]!);
    if (!k) return fail(t);
    add(k, k === "str" ? 1 : Number(m[1] || m[3] || 1));
    if (m[4] && !extras(k, m[4])) return fail(t);
  }
  if (o.str) o.str = 1;
  return { orchestration: Object.keys(o).length ? o : null, unreadable: null };
}

/**
 * What a work's scoring must meet, given our orchestra (conditions on the work's numbers:
 * an Orchestration's, or the orchestrations table's columns). Fitting:
 *
 * - An instrument nothing doubles on, nor doubles anything: as many players as the work's.
 * - A section (flutes): its players, plus its auxiliary parts (piccolo) we have no player
 *   of their own for, which our flautists who double play.
 * - An auxiliary (piccolo): its parts beyond our piccolo players, and its doubled parts
 *   (a flautist switching to piccolo) beyond what our spare piccolo players take (a flute
 *   and a piccolo player can share a "Flute 3/Piccolo" part), within our flautists who
 *   double on it.
 *
 * - Doublings on several auxiliaries (3/picc/afl) may be one player's: the doubled parts
 *   of all of them together, within the most doublers declared for any one.
 *
 * Exact: the same numbers throughout. Nothing else is assumed: a flautist doesn't play
 * piccolo unless we say so, nor an organist the piano.
 */
export type OrchestraCondition =
  | { kind: "players"; key: string; max: number }
  | { kind: "section"; main: string; auxes: { aux: string; ours: number }[]; max: number }
  | { kind: "doubling"; main: string; aux: string; ours: number; max: number }
  | { kind: "doublers"; main: string; auxes: { aux: string; ours: number }[]; max: number }
  | { kind: "exact"; key: string; value: number };

export function orchestraConditions(ours: Orchestration, exact: boolean): OrchestraCondition[] {
  const n = (k: string) => ours[k] ?? 0;
  if (exact) return ORCHESTRA_KEYS.map((key) => ({ kind: "exact", key, value: n(key) }));
  const out: OrchestraCondition[] = [];
  for (const k of [...SECTIONS.map(([s]) => s), ...OTHERS]) {
    if (DOUBLED[k]) continue; // an auxiliary: with its section
    const auxes = Object.keys(DOUBLED).filter((a) => DOUBLED[a] === k);
    if (!auxes.length) {
      out.push({ kind: "players", key: k, max: n(k) });
      continue;
    }
    out.push({ kind: "section", main: k, auxes: auxes.map((aux) => ({ aux, ours: n(aux) })), max: n(k) });
    for (const aux of auxes) out.push({ kind: "doubling", main: k, aux, ours: n(aux), max: n(`${k}/${aux}`) });
    const declared = auxes.filter((a) => n(`${k}/${a}`) > 0);
    if (declared.length > 1) out.push({ kind: "doublers", main: k, auxes: auxes.map((aux) => ({ aux, ours: n(aux) })), max: Math.max(...declared.map((a) => n(`${k}/${a}`))) });
  }
  return out;
}

/** Every instrument and doubling a scoring can have: the orchestrations table's columns */
export const ORCHESTRA_KEYS = [...SECTIONS.flatMap(([s, aux]) => [s, ...aux]), ...OTHERS, ...Object.entries(DOUBLED).map(([a, m]) => `${m}/${a}`)];
/** "fl/picc" → "fl_picc", the column's name */
export const column = (key: string) => key.replace("/", "_");

/** Whether an orchestra can play a work, or (exact) is just what it's scored for */
export function fitsOrchestra(work: Orchestration, ours: Orchestration, exact = false): boolean {
  const w = (k: string) => work[k] ?? 0;
  const over = (k: string, ours: number) => Math.max(0, w(k) - ours);
  // Parts on an auxiliary our doublers must play: doubled ones our spare players of it can't take, and its own beyond ours
  const doubled = (main: string, aux: string, ours: number) => Math.max(0, w(`${main}/${aux}`) - Math.max(0, ours - w(aux))) + over(aux, ours);
  return orchestraConditions(ours, exact).every((c) => {
    switch (c.kind) {
      case "exact":
        return w(c.key) === c.value;
      case "players":
        return w(c.key) <= c.max;
      case "section":
        return w(c.main) + c.auxes.reduce((s, a) => s + over(a.aux, a.ours), 0) <= c.max;
      case "doubling":
        return doubled(c.main, c.aux, c.ours) <= c.max;
      case "doublers":
        return c.auxes.reduce((s, a) => s + doubled(c.main, a.aux, a.ours), 0) <= c.max;
    }
  });
}

/** Spelled out: "3 flutes (one also piccolo), 2 oboes, …, timpani, strings" */
export function describeOrchestration(o: Orchestration): string {
  const order = [...SECTIONS.flatMap(([s, aux]) => [s, ...aux]), ...OTHERS];
  return order
    .filter((k) => o[k])
    .map((k) => {
      const label = LABELS[k]!;
      const also = doubles(o, k)
        .map(([a, n]) => `${n === 1 ? "one" : n} also ${LABELS[a]}`)
        .join(", ");
      const base =
        k === "str" || k === "timp" || k === "perc" ? (o[k]! > 1 && k !== "str" ? `${label} (${o[k]} players)` : label) : o[k] === 1 ? label : `${o[k]} ${label.endsWith("s") ? label : `${label}s`}`;
      return also ? `${base} (${o[k] === 1 ? also.replace(/^one also/, "also") : also})` : base;
    })
    .join(", ");
}

/** Whether a line-up has an orchestra in it, whose scoring can be asked for */
export const hasOrchestra = (lineup: string) => lineup.split(",").some((k) => k === "orchestra" || k === "chamber orchestra");
