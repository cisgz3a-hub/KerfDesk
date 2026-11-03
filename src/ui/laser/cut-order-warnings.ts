import { cutsBeforeEngraving } from '../../core/cut-before-engraving';
import type { Job } from '../../core/job';
import type { Layer } from '../../core/scene';

// UX audit U3-P2-4 (ADR-480 Amendment 2): LightBurn runs layers in list order
// and keeps Sort Cuts Last a command, but tells the reader to engrave before
// any cuts. Job Review and Save G-code say so when a cut would free a part
// before the engraving inside it. Job Review offers Cut last on this row.
const CUT_BEFORE_ENGRAVING_PREFIX = 'Cut runs before the engraving inside it: ';
const MAX_NAMED_OPERATIONS = 3;

export function cutOrderWarnings(job: Job, layers: ReadonlyArray<Layer>): ReadonlyArray<string> {
  const found = cutsBeforeEngraving(job);
  if (found.length === 0) return [];
  const cuts = found.map((entry) => operationName(entry.cutLayerId, layers));
  const inside = [
    ...new Set(found.flatMap((entry) => entry.engravingLayerIds)),
  ].map((id) => operationName(id, layers));
  return [
    `${CUT_BEFORE_ENGRAVING_PREFIX}${nameList(cuts)} ${cuts.length === 1 ? 'runs' : 'run'} before ${nameList(inside)}. ` +
      'Once a part is cut free it can drop or shift, and the engraving lands in the wrong place. ' +
      'Engrave first and cut last: use Cut last, or change the run numbers in Run order.',
  ];
}

export function isCutBeforeEngravingWarning(warning: string): boolean {
  return warning.startsWith(CUT_BEFORE_ENGRAVING_PREFIX);
}

// A compiled group names its operation, or one of its sub-layers.
function operationName(layerId: string, layers: ReadonlyArray<Layer>): string {
  for (const layer of layers) {
    if (layer.id === layerId) return layer.name;
    const sub = layer.subLayers.find((entry) => entry.id === layerId);
    if (sub !== undefined) return `${layer.name} (${sub.label})`;
  }
  return layerId;
}

function nameList(names: ReadonlyArray<string>): string {
  const quoted = names.slice(0, MAX_NAMED_OPERATIONS).map((name) => `"${name}"`);
  const extra = names.length - quoted.length;
  return extra > 0 ? `${quoted.join(', ')} and ${extra} more` : quoted.join(', ');
}
