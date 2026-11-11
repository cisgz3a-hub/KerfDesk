import type { CncTool } from '../scene';
import { cncToolAssemblySignature } from './cnc-tool-assembly';
import {
  reachEnvelopeIntersectsFixture,
  type CncReachEnvelope,
  type CncReachFixture,
  type CncReachPoint,
} from './cnc-reach-geometry';
import { isPositiveFiniteNumber } from '../util/finite';
export type { CncReachFixture, CncReachPoint } from './cnc-reach-geometry';

export type CncToolReachFinding = {
  readonly kind:
    | 'flute-reach'
    | 'stickout-reach'
    | 'fixture-intersection'
    | 'unknown-geometry'
    | 'invalid-geometry'
    | 'incomplete-paths';
  readonly toolId: string;
  readonly message: string;
  readonly fixtureId?: string;
  readonly component?: CncReachEnvelope['component'];
};
export type CncToolReachAnalysis = {
  readonly findings: ReadonlyArray<CncToolReachFinding>;
  readonly disclosures: ReadonlyArray<string>;
  readonly complete: boolean;
  readonly evaluatedSegments: number;
  readonly assemblySignature: string;
};
export type CncToolReachInput = {
  readonly tool: CncTool;
  readonly depthMm: number;
  readonly paths: ReadonlyArray<ReadonlyArray<CncReachPoint>>;
  readonly fixtures: ReadonlyArray<CncReachFixture>;
  readonly incompletePaths?: boolean;
  /** Conservative radial inflation for the declared error of approximated paths. */
  readonly pathToleranceMm?: number;
  readonly maxSegments?: number;
};

/** Advisory analysis only: unknown/short reach never changes Start or output policy. */
export function analyzeCncToolReach(input: CncToolReachInput): CncToolReachAnalysis {
  const fixtures = input.fixtures.filter(validFixture);
  const findings = assemblyFindings(input.tool, input.depthMm, fixtures.length > 0);
  const envelopes = toolEnvelopes(input, fixtures);
  if (fixtures.length !== input.fixtures.length)
    findings.push(
      finding(
        input.tool,
        'invalid-geometry',
        'Some fixture envelopes are invalid; their clearance was not evaluated.',
      ),
    );
  const result = evaluatePaths(input, envelopes, fixtures, findings);
  const complete =
    result.complete &&
    !findings.some((item) => item.kind === 'unknown-geometry' || item.kind === 'invalid-geometry');
  return {
    findings,
    complete,
    evaluatedSegments: result.count,
    assemblySignature: cncToolAssemblySignature(input.tool),
    disclosures: [
      'Conservative vertical cutter, shank and holder cylinders against rectangular fixture prisms in program work coordinates. Tangency is reported as contact.',
      'Only the supplied linear tool-centre paths and declared approximation tolerance are covered. Machine/linkage collisions, deflection and physical clearance are not qualified.',
      `Path approximation allowance: ${input.pathToleranceMm ?? 0} mm.`,
    ],
  };
}

function assemblyFindings(
  tool: CncTool,
  depthMm: number,
  checksFixtures: boolean,
): CncToolReachFinding[] {
  const unknown = unknownGeometryMessage(tool, checksFixtures);
  return [
    ...(unknown === null ? [] : [finding(tool, 'unknown-geometry', unknown)]),
    ...reachDepthFindings(tool, depthMm),
    ...assemblyContradictions(tool),
  ];
}
/** Names what is unknown and, with fixtures, which parts were and were not
 * checked against them (ADR-572 Amendment 1). */
function unknownGeometryMessage(tool: CncTool, checksFixtures: boolean): string | null {
  const missing = missingAssemblyFields(tool);
  if (missing.length === 0) return null;
  const parts = [`Unknown ${missing.join(', ')}.`];
  if (checksFixtures) {
    if (!isPositiveFiniteNumber(tool.fluteLengthMm) && isPositiveFiniteNumber(tool.diameterMm))
      parts.push(
        `Fixtures were checked against the cutter's ${tool.diameterMm} mm width only, as a column from its tip up past every fixture top.`,
      );
    const shankNeeds = missing.filter((field) => field !== 'holder envelope');
    const unchecked = [
      shankNeeds.length > 0 ? `the shank (needs ${shankNeeds.join(', ')})` : '',
      missing.includes('holder envelope') ? 'the holder (needs a holder envelope)' : '',
    ].filter(Boolean);
    if (unchecked.length > 0)
      parts.push(`Not checked against fixtures: ${unchecked.join(' and ')}.`);
  }
  parts.push('Assembly clearance is incomplete.');
  return parts.join(' ');
}
function missingAssemblyFields(tool: CncTool): ReadonlyArray<string> {
  return [
    !isPositiveFiniteNumber(tool.fluteLengthMm) ? 'flute length' : '',
    !isPositiveFiniteNumber(tool.stickoutMm) ? 'stickout' : '',
    !isPositiveFiniteNumber(tool.shankDiameterMm) ? 'shank diameter' : '',
    !tool.holderSegments?.length ? 'holder envelope' : '',
  ].filter(Boolean);
}
function reachDepthFindings(tool: CncTool, depthMm: number): CncToolReachFinding[] {
  const out: CncToolReachFinding[] = [];
  if (!Number.isFinite(depthMm) || depthMm < 0)
    out.push(
      finding(
        tool,
        'invalid-geometry',
        'The requested cutting depth is invalid; reach was not evaluated.',
      ),
    );
  if (isPositiveFiniteNumber(tool.fluteLengthMm) && depthMm > tool.fluteLengthMm)
    out.push(
      finding(
        tool,
        'flute-reach',
        `Cut depth ${depthMm} mm exceeds the recorded ${tool.fluteLengthMm} mm flute length.`,
      ),
    );
  if (isPositiveFiniteNumber(tool.stickoutMm) && depthMm > tool.stickoutMm)
    out.push(
      finding(
        tool,
        'stickout-reach',
        `Cut depth ${depthMm} mm exceeds the recorded ${tool.stickoutMm} mm stickout.`,
      ),
    );
  return out;
}
function assemblyContradictions(tool: CncTool): CncToolReachFinding[] {
  const out: CncToolReachFinding[] = [];
  if (
    isPositiveFiniteNumber(tool.fluteLengthMm) &&
    isPositiveFiniteNumber(tool.stickoutMm) &&
    tool.fluteLengthMm > tool.stickoutMm
  )
    out.push(
      finding(
        tool,
        'invalid-geometry',
        'Recorded flute length exceeds stickout; verify the exposed assembly.',
      ),
    );
  if (
    tool.holderSegments?.some(
      (segment) =>
        !validHolder(segment) ||
        (isPositiveFiniteNumber(tool.stickoutMm) && segment.startMm < tool.stickoutMm),
    )
  )
    out.push(
      finding(
        tool,
        'invalid-geometry',
        'A holder segment is invalid or starts below the recorded stickout; verify its tip-relative dimensions.',
      ),
    );
  return out;
}
function toolEnvelopes(
  input: CncToolReachInput,
  fixtures: ReadonlyArray<CncReachFixture>,
): ReadonlyArray<CncReachEnvelope> {
  const tool = input.tool;
  const out: CncReachEnvelope[] = [];
  const length = tool.fluteLengthMm;
  if (isPositiveFiniteNumber(tool.diameterMm))
    out.push({
      component: 'cutter',
      name: 'Cutter',
      startMm: 0,
      lengthMm: isPositiveFiniteNumber(length) ? length : cutterColumnLengthMm(input, fixtures),
      diameterMm: tool.diameterMm,
    });
  if (
    isPositiveFiniteNumber(length) &&
    isPositiveFiniteNumber(tool.stickoutMm) &&
    tool.stickoutMm > length &&
    isPositiveFiniteNumber(tool.shankDiameterMm)
  )
    out.push({
      component: 'shank',
      name: 'Shank',
      startMm: length,
      lengthMm: tool.stickoutMm - length,
      diameterMm: tool.shankDiameterMm,
    });
  for (const segment of tool.holderSegments ?? [])
    if (validHolder(segment)) out.push({ ...segment, component: 'holder' });
  return out;
}
/**
 * With no flute length the cutter's own width is still known, so it is a
 * column from the tip up past every fixture top: a fixture the tip passes
 * through or under is contact. A shank at least as wide as the cutter fills
 * that column for real; a wider shank or holder stays unchecked and is
 * disclosed (ADR-572 Amendment 1).
 */
function cutterColumnLengthMm(
  input: CncToolReachInput,
  fixtures: ReadonlyArray<CncReachFixture>,
): number {
  let lowestTipZ = Number.isFinite(input.depthMm) ? -Math.max(0, input.depthMm) : 0;
  for (const path of input.paths)
    for (const point of path)
      if (Number.isFinite(point.z)) lowestTipZ = Math.min(lowestTipZ, point.z);
  let highestTopZ = lowestTipZ;
  for (const fixture of fixtures) highestTopZ = Math.max(highestTopZ, fixture.topZMm);
  return highestTopZ - lowestTipZ;
}

function evaluatePaths(
  input: CncToolReachInput,
  envelopes: ReadonlyArray<CncReachEnvelope>,
  fixtures: ReadonlyArray<CncReachFixture>,
  findings: CncToolReachFinding[],
): { readonly count: number; readonly complete: boolean } {
  const reported = new Set<string>();
  const tolerance = validTolerance(input.pathToleranceMm) ? (input.pathToleranceMm ?? 0) : 0;
  const result = visitReachSegments(input, (from, to) => {
    intersectFixtures(input.tool, from, to, envelopes, fixtures, tolerance, reported, findings);
  });
  if (!result.complete)
    findings.push(
      finding(
        input.tool,
        'incomplete-paths',
        'Path coverage is incomplete, missing, invalid or exceeds the analysis budget; unexamined motion has no clearance result.',
      ),
    );
  return result;
}
function visitReachSegments(
  input: CncToolReachInput,
  visit: (from: CncReachPoint, to: CncReachPoint) => void,
): { readonly count: number; readonly complete: boolean } {
  let count = 0,
    budgetExceeded = false;
  let complete = input.incompletePaths !== true;
  const limit = segmentBudget(input.maxSegments);
  for (const path of input.paths) {
    for (let index = 0; index < Math.max(1, path.length - 1); index++) {
      if (count >= limit) {
        complete = false;
        budgetExceeded = true;
        break;
      }
      const points = reachSegmentPoints(path, index);
      if (points === null) {
        complete = false;
        continue;
      }
      count++;
      visit(points.from, points.to);
    }
    if (budgetExceeded) break;
  }
  return { count, complete: complete && count > 0 && validTolerance(input.pathToleranceMm) };
}
function reachSegmentPoints(
  path: ReadonlyArray<CncReachPoint>,
  index: number,
): { readonly from: CncReachPoint; readonly to: CncReachPoint } | null {
  const from = path[index],
    to = path[index + 1] ?? from;
  return from === undefined || to === undefined || !validPoint(from) || !validPoint(to)
    ? null
    : { from, to };
}
function segmentBudget(value: number | undefined): number {
  const requested = value ?? 200_000;
  return Number.isFinite(requested) ? Math.max(0, Math.min(200_000, Math.floor(requested))) : 0;
}
function validTolerance(value: number | undefined): boolean {
  return value === undefined || (Number.isFinite(value) && value >= 0);
}
function intersectFixtures(
  tool: CncTool,
  from: CncReachPoint,
  to: CncReachPoint,
  envelopes: ReadonlyArray<CncReachEnvelope>,
  fixtures: ReadonlyArray<CncReachFixture>,
  tolerance: number,
  reported: Set<string>,
  findings: CncToolReachFinding[],
): void {
  for (const envelope of envelopes)
    for (const fixture of fixtures) {
      const key = `${envelope.component}:${fixture.id}`;
      if (
        reported.has(key) ||
        !reachEnvelopeIntersectsFixture(from, to, envelope, fixture, tolerance)
      )
        continue;
      reported.add(key);
      findings.push({
        ...finding(
          tool,
          'fixture-intersection',
          `${envelope.name} envelope intersects fixture ${fixture.name} along the supplied path.`,
        ),
        fixtureId: fixture.id,
        component: envelope.component,
      });
    }
}
function finding(
  tool: CncTool,
  kind: CncToolReachFinding['kind'],
  message: string,
): CncToolReachFinding {
  return { kind, toolId: tool.id, message };
}
function validPoint(point: CncReachPoint): boolean {
  return [point.x, point.y, point.z].every(Number.isFinite);
}
function validFixture(f: CncReachFixture): boolean {
  return (
    [f.xMm, f.yMm, f.bottomZMm, f.topZMm].every(Number.isFinite) &&
    isPositiveFiniteNumber(f.widthMm) &&
    isPositiveFiniteNumber(f.heightMm) &&
    f.topZMm >= f.bottomZMm
  );
}
function validHolder(s: {
  readonly startMm: number;
  readonly lengthMm: number;
  readonly diameterMm: number;
}): boolean {
  return (
    Number.isFinite(s.startMm) &&
    s.startMm >= 0 &&
    isPositiveFiniteNumber(s.lengthMm) &&
    isPositiveFiniteNumber(s.diameterMm) &&
    Number.isFinite(s.startMm + s.lengthMm)
  );
}
