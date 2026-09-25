// Advisory for a tapered ball nose used where its stored diameter sets the
// layout (ADR-368 Amendment 1). ADR-368 models the bit's true shape for relief
// finishing and the simulators, but pocket and profile offsets and relief
// roughing still step by the bit's diameter, which for this bit is the widest
// one, at the top of the flutes. At ordinary depths it cuts far narrower
// (2026-09-25 PR audit, CNC-1). Compilation is unchanged.

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
    if (tool.kind !== 'tapered-ball-nose') continue;
    // A relief's roughing always uses the operation's main bit.
    const effect = bound.some((object) => object.kind === 'relief')
      ? ROUGHING_EFFECT
      : LAYOUT_EFFECTS[settings.cutType];
    if (effect === undefined) continue;
    warnings.push(
      `${layer.name} uses ${tool.name}, a tapered ball nose, but sizes its offsets and ` +
        `stepover by the bit's widest diameter (${formatMm(tool.diameterMm)} mm, at the top ` +
        `of the flutes). At ordinary depths it cuts far narrower, so ${effect}. Use a flat ` +
        'end mill for this operation, or check the 3D removal preview before cutting.',
    );
  }
  return warnings;
}
