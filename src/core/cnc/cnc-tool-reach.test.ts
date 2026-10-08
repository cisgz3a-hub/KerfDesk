import { describe, expect, it } from 'vitest';
import { CNC_CONTEXT_TOOL } from '../../__fixtures__/cnc-cutting-preset';
import { analyzeCncToolReach, type CncToolReachInput } from './cnc-tool-reach';
import { reachEnvelopeIntersectsFixture, type CncReachFixture } from './cnc-reach-geometry';
import { cncToolAssemblySignature, normalizeCncToolAssembly } from './cnc-tool-assembly';

const FIXTURE: CncReachFixture = {
  id: 'clamp',
  name: 'Side clamp',
  xMm: -1,
  yMm: 4,
  widthMm: 2,
  heightMm: 2,
  bottomZMm: 0,
  topZMm: 8,
};
const INPUT: CncToolReachInput = {
  tool: CNC_CONTEXT_TOOL,
  depthMm: 4,
  paths: [
    [
      { x: -20, y: 0, z: -4 },
      { x: 20, y: 0, z: -4 },
    ],
  ],
  fixtures: [FIXTURE],
};

describe('tool reach advisories', () => {
  it('finds holder-over-clamp contact between endpoints while the cutter clears', () => {
    const analysis = analyzeCncToolReach(INPUT);
    expect(analysis.complete).toBe(true);
    expect(analysis.findings).toEqual([
      expect.objectContaining({
        kind: 'fixture-intersection',
        component: 'holder',
        fixtureId: 'clamp',
      }),
    ]);
    expect(analysis.evaluatedSegments).toBe(1);
  });
  it('reports a short flute and stickout without refusing output', () => {
    const result = analyzeCncToolReach({ ...INPUT, depthMm: 11, fixtures: [] });
    expect(result.findings.map((f) => f.kind)).toContain('flute-reach');
    expect(result.findings.map((f) => f.kind)).toContain('stickout-reach');
    expect(result).not.toHaveProperty('refusal');
  });
  it('discloses missing legacy geometry without inventing dimensions', () => {
    const tool = { id: 'old', name: 'Legacy', kind: 'end-mill' as const, diameterMm: 3 };
    const result = analyzeCncToolReach({ ...INPUT, tool });
    expect(result.complete).toBe(false);
    expect(result.findings[0]?.kind).toBe('unknown-geometry');
    expect(normalizeCncToolAssembly(tool)).toEqual({});
  });
  it.each([
    { incompletePaths: true },
    { paths: [] },
    { maxSegments: 0 },
    { paths: [[{ x: NaN, y: 0, z: 0 }]] },
    { pathToleranceMm: -1 },
  ])('discloses incomplete coverage rather than reporting clearance', (patch) => {
    const result = analyzeCncToolReach({ ...INPUT, ...patch });
    expect(result.complete).toBe(false);
    expect(result.findings.map((f) => f.kind)).toContain('incomplete-paths');
  });
  it('accepts exactly the budgeted segment count and discloses actual truncation', () => {
    expect(analyzeCncToolReach({ ...INPUT, maxSegments: 1 }).complete).toBe(true);
    const paths = [
      [
        { x: -20, y: 0, z: -4 },
        { x: 0, y: 0, z: -4 },
        { x: 20, y: 0, z: -4 },
      ],
    ];
    const truncated = analyzeCncToolReach({ ...INPUT, paths, maxSegments: 1 });
    expect(truncated.complete).toBe(false);
    expect(truncated.evaluatedSegments).toBe(1);
  });
  it('invalidates the assembly signature after a holder or exposed-length edit', () => {
    expect(cncToolAssemblySignature({ ...CNC_CONTEXT_TOOL, stickoutMm: 11 })).not.toBe(
      cncToolAssemblySignature(CNC_CONTEXT_TOOL),
    );
    expect(
      cncToolAssemblySignature({
        ...CNC_CONTEXT_TOOL,
        holderSegments: [{ name: 'Collet', startMm: 10, lengthMm: 12, diameterMm: 14 }],
      }),
    ).not.toBe(cncToolAssemblySignature(CNC_CONTEXT_TOOL));
  });
  it('discloses invalid fixtures and a holder that contradicts stickout', () => {
    const result = analyzeCncToolReach({
      ...INPUT,
      fixtures: [{ ...FIXTURE, widthMm: -1 }],
      tool: { ...CNC_CONTEXT_TOOL, stickoutMm: 20 },
    });
    expect(result.complete).toBe(false);
    expect(result.findings.filter((f) => f.kind === 'invalid-geometry')).toHaveLength(2);
  });
  it('withdraws the entire malformed holder rather than retaining a partial clear envelope', () => {
    const normalized = normalizeCncToolAssembly({
      ...CNC_CONTEXT_TOOL,
      holderSegments: [
        ...(CNC_CONTEXT_TOOL.holderSegments ?? []),
        { name: 'Bad', startMm: 10, lengthMm: NaN, diameterMm: 10 },
      ],
    });
    expect(normalized.fluteLengthMm).toBe(5);
    expect(normalized).not.toHaveProperty('holderSegments');
  });
});

describe('independent cylinder/rectangle geometry fixtures', () => {
  const fixture = { ...FIXTURE, xMm: 0, yMm: 0, widthMm: 2, heightMm: 2, bottomZMm: 0, topZMm: 5 };
  const envelope = {
    component: 'holder' as const,
    name: 'Holder',
    startMm: 10,
    lengthMm: 5,
    diameterMm: 2,
  };
  it('uses the joint XY/Z interval instead of overlapping independent bounds', () => {
    expect(
      reachEnvelopeIntersectsFixture(
        { x: -20, y: 0, z: -20 },
        { x: 20, y: 0, z: 20 },
        envelope,
        fixture,
      ),
    ).toBe(false);
  });
  it('resolves rounded corners instead of an expanded square bounding box', () => {
    const point = { x: -3, y: -3, z: -10 };
    expect(
      reachEnvelopeIntersectsFixture(point, point, { ...envelope, diameterMm: 8 }, fixture),
    ).toBe(false);
    expect(
      reachEnvelopeIntersectsFixture(point, point, { ...envelope, diameterMm: 8.5 }, fixture),
    ).toBe(true);
  });
  it('reports tangent contact and conservative path approximation allowance', () => {
    const tangent = { x: -1, y: 1, z: -10 };
    expect(reachEnvelopeIntersectsFixture(tangent, tangent, envelope, fixture)).toBe(true);
    const point = { ...tangent, x: -1.1 };
    expect(reachEnvelopeIntersectsFixture(point, point, envelope, fixture)).toBe(false);
    expect(reachEnvelopeIntersectsFixture(point, point, envelope, fixture, 0.2)).toBe(true);
  });
});
