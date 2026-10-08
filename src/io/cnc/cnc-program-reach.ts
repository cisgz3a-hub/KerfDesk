import type { Project } from '../../core/scene/project';
import { analyzeCncToolReach } from '../../core/cnc/cnc-tool-reach';
import { cncProgramGeometry, type ProgramTool } from './cnc-program-geometry';

/** Review the exact emitted work-coordinate path. Every result is advisory. */
export function cncProgramReachWarnings(
  project: Project,
  gcode: string,
  plan?: ReadonlyArray<ProgramTool>,
): ReadonlyArray<string> {
  const machine = project.machine;
  if (machine?.kind !== 'cnc' || gcode.length === 0) return [];
  const fixtures = project.cncSetup?.fixtures ?? [];
  if (
    fixtures.length === 0 &&
    !machine.tools.some(
      (tool) =>
        tool.fluteLengthMm !== undefined ||
        tool.stickoutMm !== undefined ||
        tool.shankDiameterMm !== undefined ||
        tool.holderSegments !== undefined,
    )
  )
    return [];
  const geometry = cncProgramGeometry(gcode, plan);
  const warnings = new Set<string>(
    geometry.disclosures.map((message) => 'CNC reach review: ' + message),
  );
  for (const section of geometry.sections) {
    const tool = machine.tools.find((candidate) => candidate.id === section.tool?.id);
    if (tool === undefined) {
      warnings.add(
        'CNC reach review: a tool section has no resolved cutter identity; its assembly was not evaluated.',
      );
      continue;
    }
    const result = analyzeCncToolReach({
      tool,
      depthMm: section.depthMm,
      paths: section.paths,
      fixtures,
      incompletePaths: geometry.incomplete,
      pathToleranceMm: section.pathToleranceMm,
    });
    for (const finding of result.findings)
      warnings.add('CNC reach review · ' + tool.name + ': ' + finding.message);
    for (const disclosure of result.disclosures) warnings.add('CNC reach review: ' + disclosure);
  }
  return [...warnings];
}
