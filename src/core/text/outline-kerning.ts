// Pair kerning for the basic-Latin outline route, as OpenType defines it
// (oracle audit O7-P2-1). opentype.js 2.0.0 kerns from the GPOS 'DFLT' script
// even for Latin text, stops at the first kerning lookup that covers the left
// glyph, and skips the legacy 'kern' table whenever the font has a GPOS table.
// A font whose 'kern' feature is registered only for 'latn' (Liberation Sans)
// therefore burned with no kerning at all, and Pinyon Script lost the pairs in
// its second kerning lookup.
//
// OpenType Layout Common Table Formats (ScriptList, LookupList): a client uses
// the script table of the text's script, and 'DFLT' only when the font has
// none; every lookup a feature names is applied, in LookupList order, and in
// each lookup the first subtable that matches ends that lookup. HarfBuzz uses
// the legacy 'kern' table when GPOS has no 'kern' feature for the script.
//
// Pure: reads only the parsed font tables.

import type opentype from 'opentype.js';

type ValueRecord = { readonly xAdvance?: number };
type PairSubtable = {
  readonly posFormat: number;
  readonly coverage: unknown;
  readonly pairSets?: ReadonlyArray<
    ReadonlyArray<{ readonly secondGlyph: number; readonly value1?: ValueRecord }>
  >;
  readonly classDef1?: unknown;
  readonly classDef2?: unknown;
  readonly classRecords?: ReadonlyArray<
    ReadonlyArray<{ readonly value1?: ValueRecord } | undefined> | undefined
  >;
};
type LookupSubtable = PairSubtable & {
  readonly lookupType?: number;
  readonly extension?: PairSubtable;
};
type Lookup = { readonly lookupType: number; readonly subtables: ReadonlyArray<LookupSubtable> };
type LangSys = {
  readonly featureIndexes?: ReadonlyArray<number>;
  readonly reqFeatureIndex?: number;
};
type Gpos = {
  readonly scripts?: ReadonlyArray<{
    readonly tag: string;
    readonly script: { readonly defaultLangSys?: LangSys };
  }>;
  readonly features?: ReadonlyArray<{
    readonly tag: string;
    readonly feature: { readonly lookupListIndexes: ReadonlyArray<number> };
  }>;
  readonly lookups?: ReadonlyArray<Lookup>;
};
type LayoutReader = {
  getCoverageIndex(coverage: unknown, glyph: number): number;
  getGlyphClass(classDef: unknown, glyph: number): number;
};

const PAIR_ADJUSTMENT = 2;
const EXTENSION = 9;
const NO_REQUIRED_FEATURE = 0xffff;

/** Kerning, in font units, between two glyphs of basic-Latin text. */
export type PairKerning = (left: number, right: number) => number;

const byFont = new WeakMap<opentype.Font, PairKerning>();

export function latinPairKerning(font: opentype.Font): PairKerning {
  const cached = byFont.get(font);
  if (cached !== undefined) return cached;
  const kerning = buildPairKerning(font);
  byFont.set(font, kerning);
  return kerning;
}

function buildPairKerning(font: opentype.Font): PairKerning {
  const lookups = latinKernLookups(
    (font as unknown as { readonly tables?: { readonly gpos?: Gpos } }).tables?.gpos,
  );
  if (lookups.length > 0) {
    const reader = (font as unknown as { readonly position: LayoutReader }).position;
    return (left, right) => {
      let sum = 0;
      for (const subtables of lookups) sum += firstPairValue(reader, subtables, left, right);
      return sum;
    };
  }
  const pairs = (font as unknown as { readonly kerningPairs?: Record<string, number> })
    .kerningPairs;
  return (left, right) => pairs?.[`${left},${right}`] ?? 0;
}

/** The pair-adjustment subtables of each 'kern' lookup for Latin, in LookupList order. */
function latinKernLookups(gpos: Gpos | undefined): ReadonlyArray<ReadonlyArray<PairSubtable>> {
  const langSys = latinLangSys(gpos);
  if (gpos === undefined || langSys === undefined) return [];
  const lookupIndexes = new Set<number>();
  for (const index of langSysFeatures(langSys)) {
    const feature = gpos.features?.[index];
    if (feature?.tag !== 'kern') continue;
    for (const lookup of feature.feature.lookupListIndexes) lookupIndexes.add(lookup);
  }
  return [...lookupIndexes]
    .sort((a, b) => a - b)
    .map((index) => pairSubtables(gpos.lookups?.[index]))
    .filter((subtables) => subtables.length > 0);
}

/** The text's own script, 'latn', and 'DFLT' only when the font has no 'latn' table. */
function latinLangSys(gpos: Gpos | undefined): LangSys | undefined {
  const scripts = gpos?.scripts ?? [];
  const script =
    scripts.find((entry) => entry.tag === 'latn') ?? scripts.find((entry) => entry.tag === 'DFLT');
  return script?.script.defaultLangSys;
}

function langSysFeatures(langSys: LangSys): ReadonlyArray<number> {
  const required = langSys.reqFeatureIndex;
  const features = langSys.featureIndexes ?? [];
  return required === undefined || required === NO_REQUIRED_FEATURE
    ? features
    : [...features, required];
}

function pairSubtables(lookup: Lookup | undefined): ReadonlyArray<PairSubtable> {
  if (lookup === undefined) return [];
  if (lookup.lookupType === PAIR_ADJUSTMENT) return lookup.subtables;
  if (lookup.lookupType !== EXTENSION) return [];
  return lookup.subtables.flatMap((subtable) =>
    subtable.lookupType === PAIR_ADJUSTMENT && subtable.extension !== undefined
      ? [subtable.extension]
      : [],
  );
}

/** The first subtable of one lookup that matches the pair ends that lookup. */
function firstPairValue(
  reader: LayoutReader,
  subtables: ReadonlyArray<PairSubtable>,
  left: number,
  right: number,
): number {
  for (const subtable of subtables) {
    const value = subtablePairValue(reader, subtable, left, right);
    if (value !== undefined) return value;
  }
  return 0;
}

/** The pair's x advance in one subtable, or undefined when the subtable does not match it. */
function subtablePairValue(
  reader: LayoutReader,
  subtable: PairSubtable,
  left: number,
  right: number,
): number | undefined {
  const coverage = reader.getCoverageIndex(subtable.coverage, left);
  if (coverage < 0) return undefined;
  if (subtable.posFormat === 1) return glyphPairValue(subtable, coverage, right);
  if (subtable.posFormat === 2) return classPairValue(reader, subtable, left, right);
  return undefined;
}

function glyphPairValue(
  subtable: PairSubtable,
  coverage: number,
  right: number,
): number | undefined {
  const pair = subtable.pairSets?.[coverage]?.find((entry) => entry.secondGlyph === right);
  return pair === undefined ? undefined : (pair.value1?.xAdvance ?? 0);
}

function classPairValue(
  reader: LayoutReader,
  subtable: PairSubtable,
  left: number,
  right: number,
): number | undefined {
  const class1 = reader.getGlyphClass(subtable.classDef1, left);
  const class2 = reader.getGlyphClass(subtable.classDef2, right);
  const record = subtable.classRecords?.[class1]?.[class2];
  return record === undefined ? undefined : (record.value1?.xAdvance ?? 0);
}
