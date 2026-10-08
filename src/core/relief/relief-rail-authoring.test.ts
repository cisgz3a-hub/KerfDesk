import { describe, expect, it } from 'vitest';
import type { ReliefRailProfileSource } from '../scene/relief/relief-rail-profile';
import type { ReliefAuthoringDocument, ReliefComponent } from '../scene/relief/relief-authoring';
import { IDENTITY_TRANSFORM, type ImportedSvg } from '../scene/scene-object';
import { createBlankReliefAuthoringDocument } from './relief-authoring-document';
import { createComponentSampler } from './relief-authoring-sampling';
import { reliefAuthoringError } from './relief-authoring-validation';
import { reliefRailProfileError } from './relief-rail-profile-validation';
import { materializeReliefAuthoring } from './materialize-relief-authoring';
import { decodeCanonicalBase64 } from './depth-map-base64';
import { refreshReliefVectorLinks } from './relief-authoring-links';
import { openRailForRelief } from './relief-rail-profile-links';
import { applyTransform } from '../scene/transform';

function source(): ReliefRailProfileSource {
  const graph = [
    { x: 0, y: 0 },
    { x: 0.5, y: 4 },
    { x: 1, y: 0 },
  ];
  return {
    kind: 'rail-profile-v1',
    rail: {
      points: [
        { x: 0, y: 5 },
        { x: 10, y: 5 },
      ],
    },
    widthMm: 4,
    samplingSteps: 16,
    sections: [
      { id: 'start', position: 0, widthScale: 1, profile: graph },
      { id: 'end', position: 1, widthScale: 1, profile: graph },
    ],
  };
}
function document(s = source()): ReliefAuthoringDocument {
  const component: ReliefComponent = {
    id: 'rail',
    name: 'Rail',
    levelId: 'level-1',
    visible: true,
    combineMode: 'replace',
    transform: IDENTITY_TRANSFORM,
    baseHeightMm: 0,
    heightScale: 1,
    source: s,
  };
  return {
    ...createBlankReliefAuthoringDocument({
      width: 32,
      height: 32,
      physicalWidthMm: 10,
      physicalHeightMm: 10,
      maxDepthMm: 8,
    }),
    revision: 1,
    components: [component],
  };
}
function vector(): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'guide',
    source: 'Rail vector',
    bounds: { minX: 0, minY: 5, maxX: 10, maxY: 5 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: false,
            points: [
              { x: 0, y: 5 },
              { x: 10, y: 5 },
            ],
          },
        ],
      },
    ],
  };
}

describe('retained scalar rail and positioned profiles', () => {
  it('matches an independent straight swept triangle to half a U16 quantum', () => {
    const doc = document(),
      result = materializeReliefAuthoring(doc);
    if (result.kind !== 'ok')
      throw new Error(result.kind === 'error' ? result.reason : 'Cancelled');
    const decoded = decodeCanonicalBase64(result.field.samplesBase64);
    if (decoded.kind !== 'ok') throw new Error('Invalid scalar output.');
    for (let row = 0; row < 32; row += 1)
      for (let col = 0; col < 32; col += 1) {
        const index = row * 32 + col,
          y = ((row + 0.5) * 10) / 32;
        const expected = Math.max(0, 4 * (1 - Math.abs(y - 5) / 2));
        const code = (decoded.bytes[index * 2] ?? 0) | ((decoded.bytes[index * 2 + 1] ?? 0) << 8);
        expect(Math.abs((code / 65535) * 8 - expected)).toBeLessThanOrEqual(8 / 65535 / 2 + 1e-10);
      }
  });
  it('interpolates positioned profiles and changes width independently of height', () => {
    const original = source(),
      graph = (peak: number) => [
        { x: 0, y: 0 },
        { x: 0.5, y: peak },
        { x: 1, y: 0 },
      ];
    const edited = {
      ...original,
      sections: [
        { id: 'a', position: 0, widthScale: 1, profile: graph(2) },
        { id: 'b', position: 0.5, widthScale: 0.5, profile: graph(6) },
        { id: 'c', position: 1, widthScale: 1.5, profile: graph(4) },
      ],
    };
    expect(reliefRailProfileError(edited)).toBeNull();
    const sample = createComponentSampler(edited);
    expect(sample({ x: 2.5, y: 5 }).heightMm).toBeCloseTo(4, 10);
    expect(sample({ x: 5, y: 5 }).heightMm).toBeCloseTo(6, 10);
    expect(sample({ x: 5, y: 6.5 }).included).toBe(false);
    expect(sample({ x: 7.5, y: 6 }).heightMm).toBeCloseTo(2.5, 10);
  });
  it('pairs two nonparallel side rails by arc length and retains a curved single rail', () => {
    const s = source();
    const two = {
      ...s,
      rail: {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
      },
      secondRail: {
        points: [
          { x: 0, y: 2 },
          { x: 10, y: 6 },
        ],
      },
      sections: [
        {
          id: 'a',
          position: 0,
          widthScale: 1,
          profile: [
            { x: 0, y: 1 },
            { x: 1, y: 1 },
          ],
        },
        {
          id: 'b',
          position: 1,
          widthScale: 1,
          profile: [
            { x: 0, y: 5 },
            { x: 1, y: 5 },
          ],
        },
      ],
    };
    expect(reliefRailProfileError(two)).toBeNull();
    expect(createComponentSampler(two)({ x: 5, y: 2 }).heightMm).toBeCloseTo(3, 10);
    const curved = {
      ...s,
      widthMm: 1,
      rail: {
        points: [
          { x: 0, y: 5 },
          { x: 2, y: 4 },
          { x: 4, y: 4 },
          { x: 6, y: 5 },
        ],
      },
    };
    expect(reliefRailProfileError(curved)).toBeNull();
    expect(createComponentSampler(curved)({ x: 3, y: 4 }).heightMm).toBeCloseTo(4, 9);
  });
  it('rejects crossing rails, folded strips, non-graph profiles and oversized work', () => {
    const s = source();
    expect(
      reliefRailProfileError({
        ...s,
        rail: {
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ],
        },
        secondRail: {
          points: [
            { x: 0, y: 4 },
            { x: 10, y: -4 },
          ],
        },
      }),
    ).toMatch(/single-valued|fold|collaps/);
    expect(
      reliefRailProfileError({
        ...s,
        rail: {
          points: [
            { x: 0, y: 0 },
            { x: 5, y: 0 },
            { x: 0, y: 0.5 },
          ],
        },
      }),
    ).toMatch(/single-valued|fold|collaps/);
    expect(
      reliefRailProfileError({
        ...s,
        sections: s.sections.map((section) => ({
          ...section,
          profile: [
            { x: 0, y: 0 },
            { x: 0.8, y: 4 },
            { x: 0.2, y: 2 },
            { x: 1, y: 0 },
          ],
        })),
      }),
    ).toContain('single-valued');
    expect(
      reliefAuthoringError({
        ...document({ ...s, samplingSteps: 128 }),
        width: 1024,
        height: 1024,
      }),
    ).toContain('work budget');
  });
  it('refreshes a linked rail in its captured component frame and preserves component placement', () => {
    const guide = vector(),
      placement = { ...IDENTITY_TRANSFORM, x: 1, rotationDeg: 10 };
    const doc = document({ ...source(), rail: openRailForRelief(guide, IDENTITY_TRANSFORM) });
    const moved = {
      ...doc,
      components: doc.components.map((c) => ({ ...c, transform: placement })),
    };
    const unchanged = refreshReliefVectorLinks(moved, [guide], IDENTITY_TRANSFORM);
    expect(unchanged.kind === 'ok' && unchanged.changed).toBe(false);
    const movedGuide = { ...guide, transform: { ...IDENTITY_TRANSFORM, y: 1 } };
    const refreshed = refreshReliefVectorLinks(moved, [movedGuide], IDENTITY_TRANSFORM);
    if (refreshed.kind !== 'ok') throw new Error(refreshed.reason);
    expect(refreshed.document.revision).toBe(moved.revision + 1);
    const c = refreshed.document.components[0];
    expect(c?.transform).toEqual(placement);
    if (c?.source.kind !== 'rail-profile-v1') throw new Error('Missing rail.');
    expect(c.source.rail.points[0]).toEqual({ x: 0, y: 6 });
    expect(
      createComponentSampler(c.source)(applyTransform({ x: 5, y: 6 }, IDENTITY_TRANSFORM)).heightMm,
    ).toBe(4);
    expect(refreshReliefVectorLinks(moved, [], IDENTITY_TRANSFORM).kind).toBe('error');
  });
});
