// cncTabHoldWarnings — CNC-mode advisories, one per layer and kind, for the
// loops whose holding tabs are not the ones set (ADR-258 Amendment 5). Read
// from the evidence the compiler retained with this exact Job, so each names
// the shapes it means by size: the small hole that stops at the tab top among
// larger shapes that cut through (J1-P1-1), the small part that gets fewer
// tabs, the tab whose bridge an outline turning inside it has narrowed, and an
// open outline the bit closes. Warnings, never gates (ADR-206).

import type { Job } from '../../core/job';
import { maxOf, minOf } from '../../core/util';
import type { CncTabHoldShape } from '../../core/job/cnc-compilation-sidecar-types';
import { formatMm } from './job-review/job-review-format';

const LISTED_SHAPES = 3;

type Kind = CncTabHoldShape['kind'];

/** Layers with a loop that never cuts through, which the per-layer advisory leaves to these. */
export function layersWithNeverThroughLoops(job: Job): ReadonlySet<string> {
  return new Set(
    (job.cncCompilation?.tabHoldShapes ?? [])
      .filter((shape) => shape.kind === 'never-through')
      .map((shape) => shape.layerId),
  );
}

export function cncTabHoldWarnings(job: Job): ReadonlyArray<string> {
  const groups = new Map<string, CncTabHoldShape[]>();
  for (const shape of job.cncCompilation?.tabHoldShapes ?? []) {
    const key = `${shape.layerId}\0${shape.kind}`;
    groups.set(key, [...(groups.get(key) ?? []), shape]);
  }
  const order: ReadonlyArray<Kind> = ['never-through', 'closed-gap', 'narrow-bridge', 'fewer-tabs'];
  return [...groups.values()]
    .sort((a, b) => order.indexOf(kindOf(a)) - order.indexOf(kindOf(b)))
    .map(warningFor);
}

function kindOf(shapes: ReadonlyArray<CncTabHoldShape>): Kind {
  return (shapes[0] as CncTabHoldShape).kind;
}

type Words = {
  readonly is: string;
  readonly it: string;
  readonly its: string;
  readonly stops: string;
  readonly gets: string;
  readonly ends: string;
  readonly outlines: string;
};

const ONE: Words = {
  is: 'is',
  it: 'it',
  its: 'its',
  stops: 'it stops',
  gets: 'it gets',
  ends: 'ends',
  outlines: 'outline',
};
const MANY: Words = {
  is: 'are',
  it: 'them',
  its: 'their',
  stops: 'they stop',
  gets: 'each gets',
  ends: 'end',
  outlines: 'outlines',
};

type Message = {
  readonly shapes: ReadonlyArray<CncTabHoldShape>;
  readonly first: CncTabHoldShape;
  readonly w: Words;
  readonly layer: string;
  readonly named: string;
  readonly tab: string;
  readonly cut: string;
};

const WARNINGS: Readonly<Record<Kind, (m: Message) => string>> = {
  'never-through': ({ w, layer, named, tab, cut }) =>
    `${layer}${named} ${w.is} too small for even one ${tab} tab beside the ` +
    `${cut} cut, so ${w.stops} at the tab top and ${w.is} NOT cut through. ` +
    `Use narrower tabs or a smaller bit, or cut ${w.it} on a layer with Tabs off.`,
  'fewer-tabs': ({ shapes, first, w, layer, named, tab, cut }) =>
    `${layer}${named} ${w.is} too small for ${first.tabsSet} tabs of ${tab} ` +
    `beside the ${cut} cut, so ${w.gets} ${tabRange(shapes)}, ` +
    `as many as still let ${w.it} cut through.`,
  'narrow-bridge': ({ shapes, layer, named, tab }) =>
    `${layer}the tabs on ${named} hold by as little as ` +
    `${formatMm(minOf(shapes.map((shape) => shape.bridgeMm ?? 0)))} mm of the ${tab} set, ` +
    'because the outline turns inside the tab. Drag those tabs to straighter edges with ' +
    'Edit positions, or use narrower tabs.',
  'closed-gap': ({ shapes, w, layer, cut }) =>
    `${layer}${shapes.length} open ${w.outlines} (${sizes(shapes)}) ` +
    // ADR-258 Amendment 7: also an outline just over one cut width short, held
    // only by a sliver thinner than a tab (N7-P1-2).
    `${w.ends} so close to ${w.its} start that the ${cut} cut leaves less across the gap than ` +
    `a tab holds, so the cut frees ${w.it} like a closed shape. ` +
    `${w === ONE ? 'It is' : 'They are'} given holding tabs as closed shapes; close ` +
    `${w.it} with Tools > Join paths to edit ${w.its} tabs.`,
};

function warningFor(shapes: ReadonlyArray<CncTabHoldShape>): string {
  const first = shapes[0] as CncTabHoldShape;
  return WARNINGS[first.kind]({
    shapes,
    first,
    w: shapes.length === 1 ? ONE : MANY,
    layer: `Layer "${first.layerName}": `,
    named: `${shapes.length} ${noun(shapes)} (${sizes(shapes)})`,
    tab: `${formatMm(first.tabWidthMm)} mm`,
    cut: `${formatMm(first.cutWidthMm)} mm`,
  });
}

function noun(shapes: ReadonlyArray<CncTabHoldShape>): string {
  const roles = new Set(shapes.map((shape) => shape.role));
  const word = roles.size > 1 ? 'shape' : (shapes[0] as CncTabHoldShape).role;
  return shapes.length === 1 ? word : `${word}s`;
}

function sizes(shapes: ReadonlyArray<CncTabHoldShape>): string {
  const listed = shapes
    .slice(0, LISTED_SHAPES)
    .map((shape) => `${formatMm(shape.widthMm)} × ${formatMm(shape.heightMm)} mm`);
  const more = shapes.length - listed.length;
  return more > 0 ? `${listed.join(', ')} and ${more} more` : listed.join(', ');
}

function tabRange(shapes: ReadonlyArray<CncTabHoldShape>): string {
  const counts = shapes.map((shape) => shape.tabsCut);
  const low = minOf(counts);
  const high = maxOf(counts);
  const range = low === high ? String(low) : `${low} to ${high}`;
  return `${range} tab${high === 1 ? '' : 's'}`;
}
