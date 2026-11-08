// Starting ranges for a Material Test that looks for a through-cut (UX audit
// U8-P3-2). One default serves Engrave and Cut, so choosing Cut kept 10–40 %
// and 1000–3000 mm/min, where a diode cuts nothing (KerfDesk's own diode cut
// figure is 2–6 mm/s, working-speed-range.ts). LightBurn's advice for a cut
// test is to set Max Power to 100 % and vary passes; these ranges follow it.
// They are offered, not applied: the operator chooses them.

import {
  DEFAULT_MATERIAL_TEST_DRAFT,
  materialTestMode,
  type MaterialTestDraft,
} from './material-test-draft';

export const CUT_START_RANGES: Pick<
  MaterialTestDraft,
  | 'rowParameter'
  | 'columnParameter'
  | 'rows'
  | 'columns'
  | 'speedMin'
  | 'speedMax'
  | 'passesMin'
  | 'passesMax'
  | 'power'
> = {
  rowParameter: 'speed',
  columnParameter: 'passes',
  rows: '10',
  columns: '5',
  speedMin: '60',
  speedMax: '600',
  passesMin: '1',
  passesMax: '5',
  power: '100',
};

/** A Cut test still on the engraving ranges it started with. */
export function offersCutStartRanges(draft: MaterialTestDraft): boolean {
  if (materialTestMode(draft) !== 'line') return false;
  const fields = ['speedMin', 'speedMax', 'powerMin', 'powerMax'] as const;
  return fields.every((field) => draft[field] === DEFAULT_MATERIAL_TEST_DRAFT[field]);
}

export function withCutStartRanges(draft: MaterialTestDraft): MaterialTestDraft {
  return { ...draft, ...CUT_START_RANGES };
}
