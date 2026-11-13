// A pocket cut to (or within a thin floor of) the stock bottom frees every
// island its wall ring goes round: the centre of a frame, the counter of an
// "O". Pockets take no holding tabs, and the bit keeps cutting beside the loose
// island for the rest of the program (CNC audit v3 N3-P1-1: 541 mm of feed in
// an offset pocket, 1,837 mm in a two-island adaptive one). ADR-106
// Amendment 3 makes it a named Job Review warning, worded like the through-cut
// profile twin, and offers the holding floor: a Cut depth that leaves stock
// under the pocket, to be cut free by hand afterwards.
//
// "Near the bottom" is the floor rule the relief and V-carve warnings use
// (cnc-compiled-depth-warnings.ts, under 0.2 mm): thinner than that, the skin
// tears and the island is loose anyway. It is an advisory, never a refusal
// (rule 7): a stencil may mean to drop its counters.

import { pocketFreedIslands, type FreedIsland } from '../../core/cnc/pocket-freed-islands';
import { cncLayoutCutWidths } from '../../core/cnc/layout-cut-widths';
import { layerCncTool, type CncLayerSettings, type Layer, type Project } from '../../core/scene';
import { cncNoteContours } from '../layers/cnc-note-contours';

/** A floor thinner than this holds nothing (the relief and V-carve rule). */
export const THIN_POCKET_FLOOR_MM = 0.2;
/** The floor the warning offers: thick enough to hold an island, thin enough
 * to cut free with a knife. */
export const HOLDING_FLOOR_MM = 0.5;
/** Islands named one by one before the rest are counted. */
const ISLANDS_NAMED = 3;

export function throughPocketIslandWarning(
  project: Project,
  layer: Layer,
  settings: CncLayerSettings,
  stockThicknessMm: number,
): string | null {
  const machine = project.machine;
  if (machine?.kind !== 'cnc' || settings.cutType !== 'pocket') return null;
  const floorMm = stockThicknessMm - settings.depthMm;
  if (!(floorMm < THIN_POCKET_FLOOR_MM - 1e-9)) return null;
  const { polylines } = cncNoteContours(project.scene.objects, layer, project.device);
  const tool = layerCncTool(machine, settings);
  const { wallDiameterMm } = cncLayoutCutWidths(tool, settings.depthMm, settings.depthPerPassMm);
  const islands = pocketFreedIslands(polylines, wallDiameterMm);
  if (islands.length === 0) return null;
  const one = islands.length === 1;
  const it = one ? 'it' : 'them';
  const named = islandNames(islands);
  const cut =
    floorMm <= 0
      ? `Layer "${layer.name}" pockets through the stock (${mm(settings.depthMm)} mm ≥ ` +
        `${mm(stockThicknessMm)} mm)${spoilboard(floorMm)} round ${named}. Pockets take no ` +
        `holding tabs, so ${one ? 'it comes' : 'they come'} free while the bit is still cutting ` +
        `beside ${it}.`
      : `Layer "${layer.name}" leaves only ${mm(floorMm)} mm of stock under its pocket floor, ` +
        `so ${named} ${one ? 'is' : 'are'} held only by that skin, which can tear while the bit ` +
        `is still cutting beside ${it}.`;
  return `${cut} ${remedy(stockThicknessMm, it)}`;
}

function remedy(stockThicknessMm: number, it: string): string {
  const holdingDepthMm = stockThicknessMm - HOLDING_FLOOR_MM;
  if (!(holdingDepthMm > 0)) return `Check workholding before starting.`;
  return (
    `To keep ${it}, set Cut depth to ${mm(holdingDepthMm)} mm to leave a ` +
    `${mm(HOLDING_FLOOR_MM)} mm holding floor and cut it free afterwards; otherwise check ` +
    'workholding and keep clear of the loose pieces.'
  );
}

function spoilboard(floorMm: number): string {
  return floorMm < 0 ? `, ${mm(-floorMm)} mm into the spoilboard,` : '';
}

function islandNames(islands: ReadonlyArray<FreedIsland>): string {
  const sizes = islands
    .slice(0, ISLANDS_NAMED)
    .map((island) => `${mm(island.widthMm)} × ${mm(island.heightMm)} mm`);
  const more = islands.length - sizes.length;
  if (islands.length === 1) return `a ${sizes[0]} island`;
  const listed = more > 0 ? `${sizes.join(', ')} and ${more} more` : joinAnd(sizes);
  return `${islands.length} islands (${listed})`;
}

function joinAnd(items: ReadonlyArray<string>): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// Two decimals, trailing zeros trimmed: a 0.05 mm skin must not read as 0.1.
function mm(value: number): string {
  return String(Number(value.toFixed(2)));
}
