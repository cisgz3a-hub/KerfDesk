// ADR-486 Amendment 5: Job Review's line for closed contours the kerf offset
// kept only in part (tools audit T1, T35-P2-1, T35R-P2-1, T35R-P2-2).
//
// A "P" whose closing line runs down its own stem, a stick with a loop at its
// end, or a closing line that lands a hair beside the stem: the offset cuts the
// part that encloses area and leaves the rest out, on the growing side and the
// shrinking side alike. The line names each object and how much of its line
// is not cut, counted once where the contour runs back over itself.

import type { compileJob } from '../../core/job';
import { formatFeatureMm } from './job-review/min-feature-warnings';

type KerfDroppedLineDiagnostic = Extract<
  NonNullable<ReturnType<typeof compileJob>['diagnostics']>[number],
  { readonly kind: 'kerf-offset-dropped-line' }
>;

const NAMED = 3;

export function kerfDroppedLineWarning(diagnostic: KerfDroppedLineDiagnostic): string {
  const parts = byObject(diagnostic.parts);
  const count = diagnostic.parts.length;
  const one = count === 1;
  const named = parts.slice(0, NAMED).map(({ name, lengthMm }, index) => {
    const length = `${aboutMm(lengthMm)} mm`;
    const of = index === 0 ? ' of line' : '';
    return name === '' ? `${length}${of}` : `${length}${of} in "${name}"`;
  });
  const more = parts.length > NAMED ? [`${parts.length - NAMED} more`] : [];
  const kerf = formatFeatureMm(2 * Math.abs(diagnostic.kerfOffsetMm));
  return (
    `Kerf offset on layer "${diagnostic.layerName}" cut only part of ${count} closed ${one ? 'path' : 'paths'}: about ${listed([...named, ...more])} ${parts.length === 1 ? 'is' : 'are'} missing from the job and will NOT be cut. ` +
    `Where a closed path runs back over its own line, or two of its sides come closer than the ${kerf} mm kerf (twice its Kerf Offset), it has no inside there to offset. ` +
    'Check the preview before running. Break the path open at a node in the node editor so it burns as drawn, widen the narrow part, or set Kerf Offset to 0.'
  );
}

type Part = { readonly name: string; readonly lengthMm: number };

// One entry per object name, longest first: copies of one object read as one.
function byObject(parts: ReadonlyArray<Part>): ReadonlyArray<Part> {
  const totals = new Map<string, number>();
  for (const part of parts) totals.set(part.name, (totals.get(part.name) ?? 0) + part.lengthMm);
  return [...totals]
    .map(([name, lengthMm]) => ({ name, lengthMm }))
    .sort((a, b) => b.lengthMm - a.lengthMm);
}

function aboutMm(lengthMm: number): string {
  return lengthMm >= 10 ? String(Math.round(lengthMm)) : String(Number(lengthMm.toFixed(1)));
}

function listed(items: ReadonlyArray<string>): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`;
}
