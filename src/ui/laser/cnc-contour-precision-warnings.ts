// Advisory for requested CNC contour detail that cannot survive GRBL's eight
// captured input digits. Emission and Preview both omit only the detail the
// parser cannot distinguish; this warning makes that loss visible in the one
// ordinary warning surface without refusing Frame, Start, Save, or export.

import { cncContourLosesMotionAtSupportedPrecision } from '../../core/cnc/cnc-contour-emission';
import type { Job } from '../../core/job';
import type { Project } from '../../core/scene';

export function detectCncContourPrecisionWarnings(
  project: Project,
  job: Job,
): ReadonlyArray<string> {
  if (project.machine?.kind !== 'cnc') return [];
  const layerNames = new Map(project.scene.layers.map((layer) => [layer.id, layer.name]));
  const warnedLayers = new Set<string>();
  const warnings: string[] = [];

  for (const group of job.groups) {
    if (group.kind !== 'cnc' || warnedLayers.has(group.layerId)) continue;
    const losesContour = group.passes.some(
      (pass) => pass.kind === 'contour' && cncContourLosesMotionAtSupportedPrecision(pass),
    );
    if (!losesContour) continue;
    warnedLayers.add(group.layerId);
    const layerName = layerNames.get(group.layerId) ?? group.layerId;
    warnings.push(
      `CNC layer "${layerName}" contains contour detail that cannot be represented within GRBL's eight parsed numeric digits. That unrepresentable detail is absent from both Preview and emitted G-code; enlarge or simplify it if it must be cut.`,
    );
  }
  return warnings;
}
