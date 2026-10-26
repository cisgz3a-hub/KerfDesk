import type { Project } from '../../core/scene/project';
import type { CncTool } from '../../core/scene/cnc-tool';
import { analyzeCncToolReach, type CncToolReachInput } from '../../core/cnc/cnc-tool-reach';
import type { CncReachFixture } from '../../core/cnc/cnc-reach-geometry';
import {
  cncProgramGeometry,
  type CncProgramGeometry,
  type CncProgramSection,
  type ProgramTool,
} from './cnc-program-geometry';

/**
 * Review the exact emitted work-coordinate path. Every result is advisory.
 * `sectionDepthsMm` is the deepest compiled cut of each plan section
 * (`cncToolSectionMaximumDepthsMm`). The geometry review is bounded and can
 * stop before a section's deepest level or before a later bit, so the flute
 * and stickout check reads the compiled depth, and every plan section is
 * reviewed whether or not its motion was parsed (ADR-572 Amendment 2).
 */
export function cncProgramReachWarnings(
  project: Project,
  gcode: string,
  plan: ReadonlyArray<ProgramTool> = [],
  sectionDepthsMm: ReadonlyArray<number> = [],
): ReadonlyArray<string> {
  const machine = project.machine;
  if (machine?.kind !== 'cnc' || gcode.length === 0) return [];
  const fixtures = project.cncSetup?.fixtures ?? [];
  // The job's own bits decide, not unrelated library entries (audit F7-P3-1).
  const jobTools =
    plan.length === 0
      ? machine.tools
      : machine.tools.filter((tool) => plan.some((entry) => entry.id === tool.id));
  if (fixtures.length === 0 && !jobTools.some(hasReachData)) return [];
  const geometry = cncProgramGeometry(gcode, plan);
  const warnings = new Set<string>(
    geometry.disclosures.map((message) => 'CNC reach review: ' + message),
  );
  const review: SectionReview = { geometry, tools: machine.tools, fixtures, warnings };
  const sectionCount = Math.max(
    plan.length,
    ...geometry.sections.map((section) => section.planIndex + 1),
  );
  for (let index = 0; index < sectionCount; index++)
    reviewSection(review, index, plan[index], sectionDepthsMm[index]);
  return [...warnings];
}

type SectionReview = {
  readonly geometry: CncProgramGeometry;
  readonly tools: ReadonlyArray<CncTool>;
  readonly fixtures: ReadonlyArray<CncReachFixture>;
  readonly warnings: Set<string>;
};

function reviewSection(
  review: SectionReview,
  index: number,
  entry: ProgramTool | undefined,
  compiledDepthMm: number | undefined,
): void {
  const section = review.geometry.sections.find((candidate) => candidate.planIndex === index);
  const id = entry === undefined ? section?.tool?.id : entry.id;
  const tool = review.tools.find((candidate) => candidate.id === id);
  if (tool === undefined) {
    review.warnings.add(
      'CNC reach review: a tool section has no resolved cutter identity; its assembly was not evaluated.',
    );
    return;
  }
  const label = 'CNC reach review · ' + tool.name + ': ';
  const coverage = sectionCoverageWarning(section, compiledDepthMm);
  if (coverage !== null) review.warnings.add(label + coverage);
  if (section === undefined && compiledDepthMm === undefined) return;
  const result = analyzeCncToolReach(reachInput(review, tool, section, compiledDepthMm));
  for (const finding of result.findings) review.warnings.add(label + finding.message);
  for (const disclosure of result.disclosures)
    review.warnings.add('CNC reach review: ' + disclosure);
}

/** The deeper of the compiled and parsed depth: neither can hide the other's cut. */
function reachInput(
  review: SectionReview,
  tool: CncTool,
  section: CncProgramSection | undefined,
  compiledDepthMm: number | undefined,
): CncToolReachInput {
  if (section === undefined)
    return {
      tool,
      depthMm: compiledDepthMm ?? 0,
      paths: [],
      fixtures: review.fixtures,
      incompletePaths: true,
    };
  return {
    tool,
    depthMm: Math.max(compiledDepthMm ?? 0, section.depthMm),
    paths: section.paths,
    fixtures: review.fixtures,
    incompletePaths: review.geometry.incomplete,
    pathToleranceMm: section.pathToleranceMm,
  };
}

/** Say when a bit's motion, or its depth, was not fully read. A partial read is never complete. */
function sectionCoverageWarning(
  section: CncProgramSection | undefined,
  compiledDepthMm: number | undefined,
): string | null {
  if (section === undefined)
    return compiledDepthMm === undefined
      ? "no program geometry was reviewed for this bit's section; its cut depth and fixture clearance were not evaluated."
      : "no program geometry was reviewed for this bit's section; its fixture clearance was not evaluated.";
  if (section.truncated && compiledDepthMm === undefined)
    return "cut depth was read only up to where the geometry review stopped; deeper cuts later in this bit's section were not compared with its flute length or stickout.";
  return null;
}

function hasReachData(tool: CncTool): boolean {
  return (
    tool.fluteLengthMm !== undefined ||
    tool.stickoutMm !== undefined ||
    tool.shankDiameterMm !== undefined ||
    tool.holderSegments !== undefined
  );
}
