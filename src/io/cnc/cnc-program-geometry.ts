import {
  applySharedGCode,
  resolveAxisTarget,
  type CoreMotionModal,
} from '../../core/gcode/modal-axes';
import { scanCompleteGcodeWords, stripControllerComments } from '../../core/gcode/word-scan';
import { iterateLines } from '../../core/util';
import { arcStepRad } from '../../core/geometry/arc-sampling';
import type { CncReachPoint } from '../../core/cnc/cnc-reach-geometry';
import type { ToolpathStepList } from '../../core/job/toolpath-steps';
import { createGcodeProgramLineParser } from '../gcode/gcode-program-line-parser';
import { cncProgramXyzPaths } from './cnc-program-xyz-paths';

export type ProgramTool = { readonly id: string | null; readonly name: string | null };
export type CncProgramSection = {
  readonly tool: ProgramTool | undefined;
  readonly paths: ReadonlyArray<ReadonlyArray<CncReachPoint>>;
  readonly depthMm: number;
  readonly pathToleranceMm: number;
};
export type CncProgramGeometry = {
  readonly sections: ReadonlyArray<CncProgramSection>;
  readonly disclosures: ReadonlyArray<string>;
  readonly incomplete: boolean;
};
type Review = { sections: CncProgramSection[]; disclosures: Set<string>; incomplete: boolean };
type Section = {
  parser: ReturnType<typeof createGcodeProgramLineParser>;
  modal: CoreMotionModal;
  position: CncReachPoint;
  firstKnown: { point: CncReachPoint; prefixSteps: number } | undefined;
  tolerance: number;
  hasSection: boolean;
};
type Budget = { lines: number; estimatedSegments: number };
type Words = NonNullable<ReturnType<typeof scanCompleteGcodeWords>>;
const MAX_LINES = 50_000;
const MAX_SEGMENTS = 100_000;

/** Bounded advisory view of emitted GRBL XYZ. It never edits or approves executable bytes. */
export function cncProgramGeometry(
  gcode: string,
  plan: ReadonlyArray<ProgramTool> = [],
): CncProgramGeometry {
  const review: Review = { sections: [], disclosures: new Set(), incomplete: false };
  const budget: Budget = { lines: 0, estimatedSegments: 0 };
  let section = newSection(),
    sectionIndex = 0;
  for (const line of iterateLines(gcode)) {
    if (!reserveLine(review, budget)) break;
    const words = programLineWords(line, review);
    if (words === null) continue;
    if (words.some((word) => word.letter === 'M' && word.value === 0)) {
      finishSection(section, review, plan[sectionIndex]);
      sectionIndex += 1;
      section = newSection();
      continue;
    }
    if (!appendProgramLine(line, words, section, review, budget)) break;
  }
  finishSection(section, review, plan[sectionIndex]);
  return finishReview(review, plan.length);
}

function newSection(): Section {
  return {
    parser: createGcodeProgramLineParser(),
    modal: { motion: 0, unitScale: 1, absolute: true },
    position: { x: 0, y: 0, z: 0 },
    firstKnown: undefined,
    tolerance: 0,
    hasSection: false,
  };
}
function reserveLine(review: Review, budget: Budget): boolean {
  budget.lines += 1;
  if (budget.lines <= MAX_LINES) return true;
  disclose(
    review,
    'Program geometry review stopped at ' +
      MAX_LINES +
      ' lines; remaining motion was not evaluated.',
  );
  return false;
}
function reserveSegments(cost: number, review: Review, budget: Budget): boolean {
  if (budget.estimatedSegments + cost > MAX_SEGMENTS) {
    disclose(
      review,
      'Program geometry review reached its ' +
        MAX_SEGMENTS +
        '-segment allocation budget; remaining motion was not evaluated.',
    );
    return false;
  }
  budget.estimatedSegments += cost;
  return true;
}
function programLineWords(line: string, review: Review): Words | null {
  const stripped = stripControllerComments(line);
  if (stripped === '' || stripped === '%') return null;
  const words = scanCompleteGcodeWords(stripped);
  if (words === null || words.some((word) => !Number.isFinite(word.value))) {
    disclose(review, 'Uninterpretable program text was omitted from geometry review.');
    return null;
  }
  return words;
}
function appendProgramLine(
  line: string,
  words: Words,
  section: Section,
  review: Review,
  budget: Budget,
): boolean {
  for (const word of words) if (word.letter === 'G') applySharedGCode(section.modal, word.value);
  const axes = new Map(
    words
      .filter((word) => word.letter !== 'G' && word.letter !== 'M')
      .map((word) => [word.letter, word.value]),
  );
  const hasMotion = ['X', 'Y', 'Z', 'I', 'J', 'R'].some((axis) => axes.has(axis));
  const isArc = section.modal.motion === 2 || section.modal.motion === 3;
  const cost = hasMotion ? (isArc ? 361 : 1) : 0;
  if (!reserveSegments(cost, review, budget)) return false;
  const target = resolveAxisTarget(section.position, axes, section.modal);
  if (hasMotion && isArc)
    section.tolerance = Math.max(
      section.tolerance,
      arcTolerance(section.position, target, axes, section.modal.unitScale),
    );
  section.parser.pushLine(line);
  section.hasSection = true;
  if (hasMotion) section.position = target;
  recordKnownPosition(section, axes);
  return true;
}
function recordKnownPosition(section: Section, axes: ReadonlyMap<string, number>): void {
  if (
    section.firstKnown !== undefined ||
    !section.modal.absolute ||
    !axes.has('X') ||
    !axes.has('Y')
  )
    return;
  const prefix = section.parser.finish();
  if (prefix.kind === 'ok')
    section.firstKnown = { point: section.position, prefixSteps: prefix.toolpath.steps.length };
}
function arcTolerance(
  position: CncReachPoint,
  target: CncReachPoint,
  axes: ReadonlyMap<string, number>,
  unitScale: number,
): number {
  const usesCenter = axes.has('I') || axes.has('J');
  const i = (axes.get('I') ?? 0) * unitScale,
    j = (axes.get('J') ?? 0) * unitScale;
  const radius = usesCenter
    ? Math.hypot(axes.get('I') ?? 0, axes.get('J') ?? 0) * unitScale
    : Math.abs(axes.get('R') ?? 0) * unitScale;
  const endpointMismatch = usesCenter
    ? Math.abs(radius - Math.hypot(target.x - position.x - i, target.y - position.y - j))
    : 0;
  // The shared sampler floors angular steps at 1 degree. Include that actual
  // chord error and formatted endpoint mismatch, rather than a universal bound.
  return radius * (1 - Math.cos(arcStepRad(radius) / 2)) + endpointMismatch;
}
function finishSection(section: Section, review: Review, tool: ProgramTool | undefined): void {
  if (!section.hasSection) return;
  const result = section.parser.finish();
  if (result.kind === 'error') {
    disclose(review, 'Program geometry could not be evaluated: ' + result.reason);
    return;
  }
  // Exact G94 selects feed per minute; it does not change work-coordinate geometry.
  const unsupported = result.notes.filter((note) => !/unsupported G(?:54|4|94)$/.test(note));
  if (unsupported.length > 0)
    disclose(review, 'Geometry interpretation is incomplete: ' + unsupported.join('; '));
  const paths = sectionPaths(section, review, result.toolpath.steps);
  let depthMm = 0;
  for (const path of paths) for (const point of path) depthMm = Math.max(depthMm, -point.z);
  review.sections.push({ tool, paths, depthMm, pathToleranceMm: section.tolerance });
}
function sectionPaths(
  section: Section,
  review: Review,
  steps: ToolpathStepList,
): CncProgramSection['paths'] {
  const firstKnown = section.firstKnown;
  if (firstKnown === undefined) {
    disclose(
      review,
      'A tool section has no explicit absolute XY position; its path was not evaluated.',
    );
    return [];
  }
  return cncProgramXyzPaths(steps.slice(firstKnown.prefixSteps), firstKnown.point);
}
function finishReview(review: Review, planCount: number): CncProgramGeometry {
  if (review.sections.length !== planCount)
    disclose(
      review,
      'Tool-section geometry and the resolved tool plan do not have matching counts.',
    );
  if (review.sections.length > 0)
    disclose(
      review,
      'The initial approach and moves after each manual tool change start from an unknown operator position and are not evaluated until the first explicit absolute XY position.',
    );
  return {
    sections: review.sections,
    disclosures: [...review.disclosures],
    incomplete: review.incomplete,
  };
}
function disclose(review: Review, message: string): void {
  review.disclosures.add(message);
  review.incomplete = true;
}
