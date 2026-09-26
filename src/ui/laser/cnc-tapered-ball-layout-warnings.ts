// Advisory for a tapered ball nose whose layout still uses its stored diameter
// (ADR-368 Amendments 1 and 2). With a modeled ball tip and taper, pocket and
// profile offsets, their stepover, and relief roughing's stepover follow the
// bit's cut width at depth (Amendment 2), so nothing is said. A tapered ball
// nose missing a usable tip or taper plans as a flat cylinder of its stored
// diameter, the widest one, at the top of the flutes (ADR-368 item 2). It cuts
// far narrower than that plan at ordinary depths, and the 3D removal preview
// shows the plan, so Job Review says so. Compilation is unchanged.

import { taperedBallEnvelope } from '../../core/cnc-tapered-ball';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  layerCncTool,
  sceneObjectUsesOperation,
  type CncCutType,
  type Project,
} from '../../core/scene';
import { formatMm } from './job-review/job-review-format';

const LAYOUT_EFFECTS: Partial<Record<CncCutType, string>> = {
  'profile-outside': 'the part comes out oversize with a tapered wall',
  'profile-inside': 'the opening comes out undersize with a tapered wall',
  pocket: 'the pocket walls land inside the line and ribs stand between passes',
};
const ROUGHING_EFFECT = 'roughing leaves ribs between its rings';

export function detectCncTaperedBallLayoutWarnings(project: Project): ReadonlyArray<string> {
  const machine = project.machine;
  if (machine?.kind !== 'cnc') return [];
  const warnings: string[] = [];
  for (const layer of project.scene.layers) {
    if (!layer.output) continue;
    const bound = project.scene.objects.filter((object) => sceneObjectUsesOperation(object, layer));
    if (bound.length === 0) continue;
    const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    const tool = layerCncTool(machine, settings);
    if (tool.kind !== 'tapered-ball-nose' || taperedBallEnvelope(tool) !== null) continue;
    // A relief's roughing always uses the operation's main bit.
    const effect = bound.some((object) => object.kind === 'relief')
      ? ROUGHING_EFFECT
      : LAYOUT_EFFECTS[settings.cutType];
    if (effect === undefined) continue;
    warnings.push(
      `${layer.name} uses ${tool.name}, a tapered ball nose without a usable ball tip and ` +
        "taper, so its offsets and stepover are sized by the bit's widest diameter " +
        `(${formatMm(tool.diameterMm)} mm, at the top of the flutes). At ordinary depths it ` +
        `cuts far narrower, so ${effect}. Add the bit again with its tip and taper per side, ` +
        'or use a flat end mill for this operation.',
    );
  }
  return warnings;
}
