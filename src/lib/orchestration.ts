// An orchestra's scoring, as orchestras write it: "2.2.2.2 – 4.2.3.1 – timp – perc – hp – str".
// Players per instrument; the shorthand's eight numbers are sections (flutes, oboes,
// clarinets, bassoons; horns, trumpets, trombones, tubas), and their auxiliaries
// (piccolo, English horn, …) are written "+picc" after the section.

export type Orchestration = Record<string, number>;

/** Section → its auxiliary instruments, which take a player of their own */
export const SECTIONS: [string, string[]][] = [
  ["fl", ["picc", "afl"]],
  ["ob", ["eh", "oda"]],
  ["cl", ["ebcl", "bcl", "bhn"]],
  ["bn", ["cbn"]],
  ["hn", ["wtba"]],
  ["tpt", ["crt", "flhn"]],
  ["tbn", []],
  ["tba", ["euph"]],
];
/** Everything else, in score order */
export const OTHERS = ["timp", "perc", "hp", "cel", "pf", "org", "hpd", "bc", "gtr", "mand", "sax", "str"];

export const LABELS: Record<string, string> = {
  fl: "flute", picc: "piccolo", afl: "alto flute",
  ob: "oboe", eh: "English horn", oda: "oboe d'amore",
  cl: "clarinet", ebcl: "E♭ clarinet", bcl: "bass clarinet", bhn: "basset horn",
  bn: "bassoon", cbn: "contrabassoon",
  hn: "horn", wtba: "Wagner tuba",
  tpt: "trumpet", crt: "cornet", flhn: "flugelhorn",
  tbn: "trombone", tba: "tuba", euph: "euphonium",
  timp: "timpani", perc: "percussion", hp: "harp", cel: "celesta", pf: "piano", org: "organ", hpd: "harpsichord", bc: "continuo",
  gtr: "guitar", mand: "mandolin", sax: "saxophone", str: "strings",
};

/** "2.2.2.2+cbn – 4.2.3.1 – timp – 2perc – hp – str" */
export function formatOrchestration(o: Orchestration): string {
  const section = ([s, aux]: [string, string[]]) =>
    String(o[s] ?? 0) + aux.filter((a) => o[a]).map((a) => `+${o[a]! > 1 ? o[a] : ""}${a}`).join("");
  const groups = [SECTIONS.slice(0, 4).map(section).join("."), SECTIONS.slice(4).map(section).join(".")];
  for (const k of OTHERS) if (o[k]) groups.push(k === "str" || o[k] === 1 ? k : `${o[k]}${k}`);
  return groups.join(" – ");
}

// What people type, beyond the abbreviations above
const ALIASES: Record<string, string> = {
  pic: "picc", piccolo: "picc", "e.h": "eh", ca: "eh", cor: "eh", ehn: "eh", "bcl.": "bcl", bcl: "bcl", "b.cl": "bcl", ebcl: "ebcl", cbsn: "cbn", cfg: "cbn", kfg: "cbn",
  hrn: "hn", tp: "tpt", trp: "tpt", trb: "tbn", tb: "tba", tu: "tba", pk: "timp", ti: "timp", timpani: "timp", tmp: "timp", "timp.": "timp", pc: "perc", perc: "perc", percussion: "perc",
  harp: "hp", hrp: "hp", hf: "hp", fg: "bn", kl: "cl", pos: "tbn", schlz: "perc", celesta: "cel", piano: "pf", pno: "pf", kbd: "pf", organ: "org", harpsichord: "hpd", cemb: "hpd", continuo: "bc", cont: "bc", strings: "str", strs: "str", "str.": "str",
};
const code = (w: string): string | undefined => {
  const k = w.toLowerCase();
  // "harps", "celestas"
  return k in LABELS ? k : (ALIASES[k] ?? (k.endsWith("s") ? code(k.slice(0, -1)) : undefined));
};

/**
 * Parses the shorthand: "2.2.2.2 4.2.3.1 timp str", "2222 4231 timp perc hp str",
 * "3+picc.2+eh.2.2 – 4.3.3.1 – timp – 3perc – 2hp – cel – str". Returns null if it isn't one.
 */
export const parseOrchestration = (input: string) => readOrchestration(input).orchestration;

/** Typical orchestras, to start from */
export const EXAMPLES: [label: string, scoring: string][] = [
  ["Classical", "2.2.2.2 2.2.0.0 timp str"],
  ["Romantic", "2.2.2.2 4.2.3.1 timp perc str"],
  ["Large", "3+picc.3+eh.3+bcl.3+cbn 6.4.3.1 timp 3perc 2hp cel str"],
  ["Chamber", "1.1.1.1 1.1.0.0 timp str"],
];

/** The shorthand read, or the part of it that can't be: "timp perc harpz" → "harpz" */
export function readOrchestration(input: string): { orchestration: Orchestration | null; unreadable: string | null } {
  const o: Orchestration = {};
  const add = (k: string, n: number) => (o[k] = (o[k] ?? 0) + n);
  const fail = (t: string) => ({ orchestration: null, unreadable: t });
  const tokens = input
    .replace(/[–—,;]/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t && t !== "-")
    // "timp+perc+str", like "2+picc"
    .flatMap((t) => (/^[a-z]/i.test(t) ? t.split("+").filter(Boolean) : [t]));
  let section = 0;
  for (const t of tokens) {
    // A group of sections: "2.2.2.2", "2222", "3+picc.2.2+bcl.2"
    const parts = /^\d/.test(t) ? (t.includes(".") ? t.split(".") : /^\d{4}$/.test(t) ? [...t] : null) : null;
    if (parts && parts.every((p) => /^\d+(\+\d*[a-z.]+)*$/i.test(p))) {
      if (section + parts.length > SECTIONS.length) return fail(t);
      for (const p of parts) {
        const [n, ...aux] = p.split("+");
        add(SECTIONS[section]![0], Number(n));
        for (const a of aux) {
          const m = /^(\d*)(.+)$/.exec(a)!;
          const k = code(m[2]!);
          if (!k) return fail(t);
          add(k, Number(m[1] || 1));
        }
        section++;
      }
      continue;
    }
    // "timp", "3perc", "2hp", "perc(3)"
    const m = /^(\d*)([a-z.]+)(?:\((\d+)\))?$/i.exec(t);
    const k = m && code(m[2]!);
    if (!k) return fail(t);
    add(k, k === "str" ? 1 : Number(m[1] || m[3] || 1));
  }
  return { orchestration: Object.keys(o).length ? o : null, unreadable: null };
}

/**
 * An orchestration as the dataset stores it (the orchestrations table's columns): players
 * per section, auxiliaries included (a piccolo needs a flautist, but any of them), and
 * keyboards together, as do saxophones, guitars and mandolins.
 */
export function orchestraColumns(o: Orchestration): Record<string, number> {
  const sum = (ks: string[]) => ks.reduce((n, k) => n + (o[k] ?? 0), 0);
  return {
    ...Object.fromEntries(SECTIONS.map(([s, aux]) => [s, sum([s, ...aux])])),
    timp: o.timp ?? 0,
    perc: o.perc ?? 0,
    hp: o.hp ?? 0,
    kbd: sum(["pf", "cel", "org", "hpd", "bc"]),
    other: sum(["gtr", "mand", "sax"]),
    str: o.str ? 1 : 0,
  };
}

/** Whether an orchestra can play a work: enough players for every column */
export function fitsOrchestra(work: Orchestration, ours: Orchestration): boolean {
  const have = orchestraColumns(ours);
  return Object.entries(orchestraColumns(work)).every(([k, n]) => n <= have[k]!);
}

/** Spelled out: "2 flutes, piccolo, 2 oboes, …, timpani, strings" */
export function describeOrchestration(o: Orchestration): string {
  const order = [...SECTIONS.flatMap(([s, aux]) => [s, ...aux]), ...OTHERS];
  return order
    .filter((k) => o[k])
    .map((k) => {
      const label = LABELS[k]!;
      if (k === "str" || k === "timp" || k === "perc") return o[k]! > 1 && k !== "str" ? `${label} (${o[k]} players)` : label;
      return o[k] === 1 ? label : `${o[k]} ${label.endsWith("s") ? label : `${label}s`}`;
    })
    .join(", ");
}

/** Whether a line-up has an orchestra in it, whose scoring can be asked for */
export const hasOrchestra = (lineup: string) => lineup.split(",").some((k) => k === "orchestra" || k === "chamber orchestra");
