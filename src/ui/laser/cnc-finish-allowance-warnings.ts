// detectCncFinishAllowanceWarnings — CNC-mode advisory (ADR-140 Amendment 2,
// CNC audit v1 F3-P2-1): a profile layer whose finish allowance is at least the
// bit's radius. One full-depth finishing pass would then cut with half the bit or
// more in solid stock, and from one cut width up the roughing slot would not even
// meet the finishing slot, leaving a ring of stock standing loose between them.
// The compiler cuts such an allowance as the radius and steps the finishing pass
// down; this names that change so the operator is not surprised by it.
//
// Advisory only. It informs and never refuses Frame, Start or a save.

// Deep imports: core/cnc's barrel is a ratcheted over-cap legacy barrel.
import { cncSettingsForStage } from '../../core/cnc/cnc-stage-settings';
import { finishAllowanceReachesRadius } from '../../core/cnc/finish-allowance';
import { cncLayoutCutWidths } from '../../core/cnc/layout-cut-widths';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  layerCncTool,
  sceneObjectUsesOperation,
  type Project,
} from '../../core/scene';

export function detectCncFinishAllowanceWarnings(project: Project): ReadonlyArray<string> {
  const machine = project.machine;
  if (machine?.kind !== 'cnc') return [];
  const warnings: string[] = [];
  for (const layer of project.scene.layers) {
    if (!layer.output) continue;
    if (!project.scene.objects.some((object) => sceneObjectUsesOperation(object, layer))) continue;
    const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    const tool = layerCncTool(machine, settings);
    const { wallDiameterMm } = cncLayoutCutWidths(tool, settings.depthMm, settings.depthPerPassMm);
    if (!finishAllowanceReachesRadius(settings, wallDiameterMm)) continue;
    const allowanceMm = settings.finishAllowanceMm ?? 0;
    const radiusMm = wallDiameterMm / 2;
    const stepMm = cncSettingsForStage(settings, 'profile-finish', tool).depthPerPassMm;
    const loose =
      allowanceMm >= wallDiameterMm
        ? ` At ${mm(allowanceMm)} mm the roughing and finishing slots would not meet, leaving a ring of stock loose between them.`
        : '';
    warnings.push(
      `${layer.name}: the ${mm(allowanceMm)} mm finish allowance is at least the ${mm(radiusMm)} mm ` +
        `radius of ${tool.name}, so one full-depth finishing pass would cut with half the bit or ` +
        `more in solid stock.${loose} KerfDesk roughs ${mm(radiusMm)} mm proud of the wall instead ` +
        `and steps the finishing pass down ${mm(stepMm)} mm at a time. Set Finish allowance ` +
        `below ${mm(radiusMm)} mm for one light finishing pass.`,
    );
  }
  return warnings;
}

// Two decimals: a 1/8 in bit's 1.5875 mm radius must not read as 1.6 mm.
function mm(value: number): string {
  return String(Number(value.toFixed(2)));
}
