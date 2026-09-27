// Advisory for a bit that narrows toward its tip but whose layout still uses
// its stored diameter (ADR-368 Amendments 1 to 3). Pocket and profile offsets,
// their stepover, and relief roughing's stepover follow the cut width at depth
// of a ball nose, V-bit, engraving bit or tapered ball nose (Amendments 2 and
// 3), so a modeled bit says nothing. A V-bit or engraving bit without a usable
// included angle or tip flat, or a tapered ball nose without a usable ball tip
// or taper, cannot be modeled. Its layout keeps the stored diameter, the widest
// it cuts, at the top of the flutes (layout-cut-widths.ts), and at ordinary
// depths it cuts far narrower than that plan, so Job Review says so.
// Compilation is unchanged.

// Deep import: core/cnc's barrel is a ratcheted over-cap legacy barrel
// (scripts/index-export-baseline.json) and may only shrink.
import { cncLayoutFallsBackToStoredDiameter } from '../../core/cnc/layout-cut-widths';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  assertNever,
  layerCncTool,
  sceneObjectUsesOperation,
  type CncCutType,
  type CncTool,
  type Project,
} from '../../core/scene';
import { formatMm } from './job-review/job-review-format';

const LAYOUT_EFFECTS: Partial<Record<CncCutType, string>> = {
  'profile-outside': 'the part comes out oversize with a tapered wall',
  'profile-inside': 'the opening comes out undersize with a tapered wall',
  pocket: 'the pocket walls land inside the line and ribs stand between passes',
};
const ROUGHING_EFFECT = 'roughing leaves ribs between its rings';

type UnmodeledBit = { readonly missing: string; readonly fix: string };

export function detectCncUnmodeledBitLayoutWarnings(project: Project): ReadonlyArray<string> {
  const machine = project.machine;
  if (machine?.kind !== 'cnc') return [];
  const warnings: string[] = [];
  for (const layer of project.scene.layers) {
    if (!layer.output) continue;
    const bound = project.scene.objects.filter((object) => sceneObjectUsesOperation(object, layer));
    if (bound.length === 0) continue;
    const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    const tool = layerCncTool(machine, settings);
    const bit = cncLayoutFallsBackToStoredDiameter(tool) ? unmodeledBit(tool) : null;
    if (bit === null) continue;
    // A relief's roughing always uses the operation's main bit.
    const effect = bound.some((object) => object.kind === 'relief')
      ? ROUGHING_EFFECT
      : LAYOUT_EFFECTS[settings.cutType];
    if (effect === undefined) continue;
    warnings.push(
      `${layer.name} uses ${tool.name}, ${bit.missing}, so its offsets and stepover are sized ` +
        `by the bit's widest diameter (${formatMm(tool.diameterMm)} mm, at the top of the ` +
        `flutes). At ordinary depths it cuts far narrower, so ${effect}. ${bit.fix}, or use a ` +
        'flat end mill for this operation.',
    );
  }
  return warnings;
}

// What the bit lacks, and how to give it back.
function unmodeledBit(tool: CncTool): UnmodeledBit | null {
  switch (tool.kind) {
    case 'v-bit':
      return {
        missing: 'a V-bit without a usable included angle',
        fix: 'Add the bit again with its included angle',
      };
    case 'engraving':
      return {
        missing: 'an engraving bit without a usable included angle or tip flat',
        fix: 'Add the bit again with its included angle and tip flat',
      };
    case 'tapered-ball-nose':
      return {
        missing: 'a tapered ball nose without a usable ball tip and taper',
        fix: 'Add the bit again with its tip and taper per side',
      };
    // A flat end mill needs no model, and a ball nose's sphere always has one.
    case 'end-mill':
    case 'ball-nose':
      return null;
    default:
      return assertNever(tool.kind, 'CncToolKind');
  }
}
