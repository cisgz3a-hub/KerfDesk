import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildCorpus } from '../../__fixtures__/property/box-benchmark-support';
import { deriveBoxDims, type BoxSpec } from './box-spec';
import { edgePattern } from './edge-pattern';
import { estimateBoxWork } from './box-work-estimate';
import { generateBox } from './generate-box';
import { buildSlideLidParts } from './slide-lid-panels';

const BASE: BoxSpec = {
  widthMm: 60,
  depthMm: 40,
  heightMm: 30,
  dimensionMode: 'inner',
  thicknessMm: 3,
  targetFingerWidthMm: 9,
  style: 'closed',
  clearanceMm: 0,
  relief: { kind: 'none' },
  partSpacingMm: 8,
  dividersXCount: 0,
  dividersYCount: 0,
};

const REPRESENTATIVE_TOPOLOGIES: ReadonlyArray<BoxSpec> = [
  { ...BASE, style: 'open-top', dividersXCount: 2, dividersYCount: 1 },
  { ...BASE, style: 'closed', dividersXCount: 1, dividersYCount: 3 },
];

const SLIDE_LID: BoxSpec = {
  ...BASE,
  style: 'slide-lid',
  widthMm: 90,
  depthMm: 60,
  heightMm: 45,
  clearanceMm: 0.2,
};

describe('estimateBoxWork', () => {
  it('pins the ordinary closed-box structural estimate', () => {
    expect(estimateBoxWork(BASE)).toEqual({
      kind: 'estimated',
      axisCells: { x: 5, y: 3, z: 3 },
      junctionCells: 3,
      dividerCount: 0,
      crossLapPairs: 0,
      predictedParts: 6,
      predictedRings: 6,
      nominalPointUpper: 254,
      reliefBooleanInputVertexUpper: 0,
      claimCellVisits: 88,
      slotCellVisits: 0,
      dividerCellVisits: 0,
      fitMode: 'identity',
      saturatedFields: [],
    });
  });

  it('counts divider scans, rings, cross-laps, and nominal points without allocating dividers', () => {
    const estimate = estimateBoxWork({
      ...BASE,
      style: 'open-top',
      dividersXCount: 2,
      dividersYCount: 1,
    });
    expect(estimate).toMatchObject({
      axisCells: { x: 5, y: 3, z: 3 },
      junctionCells: 3,
      dividerCount: 3,
      crossLapPairs: 2,
      predictedParts: 8,
      predictedRings: 14,
      nominalPointUpper: 270,
      claimCellVisits: 60,
      slotCellVisits: 9,
      dividerCellVisits: 9,
    });
  });

  it('bounds actual identity-fit points and predicts exact parts/rings across representative topologies', () => {
    for (const spec of [...buildCorpus(), ...REPRESENTATIVE_TOPOLOGIES]) {
      const estimate = estimateBoxWork(spec);
      const result = generateBox(spec);
      expect(result.kind).toBe('generated');
      if (result.kind !== 'generated') continue;
      const rings = result.panels.flatMap((panel) => [panel.outline, ...panel.cutouts]);
      const points = rings.reduce((total, ring) => total + ring.points.length, 0);
      expect(result.panels).toHaveLength(estimate.predictedParts);
      expect(rings).toHaveLength(estimate.predictedRings);
      expect(
        points,
        JSON.stringify({
          spec,
          axisCells: estimate.axisCells,
          estimate: estimate.nominalPointUpper,
        }),
      ).toBeLessThanOrEqual(estimate.nominalPointUpper);
    }
  });

  it('bounds the nominal slide-lid builder without claiming a post-offset bound', () => {
    const estimate = estimateBoxWork(SLIDE_LID);
    const parts = buildSlideLidParts(SLIDE_LID);
    const rings = parts.flatMap((part) => [part.rings.outline, ...part.rings.cutouts]);
    const points = rings.reduce((total, ring) => total + ring.points.length, 0);

    expect(parts).toHaveLength(estimate.predictedParts);
    expect(rings).toHaveLength(estimate.predictedRings);
    expect(points).toBeLessThanOrEqual(estimate.nominalPointUpper);
  });

  it('matches edgePattern counts over a property sweep', () => {
    fc.assert(
      fc.property(
        fc.record({
          width: fc.integer({ min: 20, max: 2_000 }),
          depth: fc.integer({ min: 20, max: 2_000 }),
          height: fc.integer({ min: 20, max: 2_000 }),
          thickness: fc.integer({ min: 1, max: 6 }),
          finger: fc.integer({ min: 2, max: 50 }),
        }),
        ({ width, depth, height, thickness, finger }) => {
          const spec: BoxSpec = {
            ...BASE,
            widthMm: width,
            depthMm: depth,
            heightMm: height,
            thicknessMm: thickness,
            targetFingerWidthMm: finger,
          };
          const dims = deriveBoxDims(spec);
          const expected = [dims.outerWidthMm, dims.outerDepthMm, dims.outerHeightMm].map(
            (fullSpanMm) =>
              edgePattern({
                fullSpanMm,
                thicknessMm: thickness,
                targetFingerWidthMm: finger,
              }).cellCount,
          );
          expect(estimateBoxWork(spec).axisCells).toEqual({
            x: expected[0],
            y: expected[1],
            z: expected[2],
          });
        },
      ),
    );
  });

  it('is invariant between equivalent inner and outer dimension entry', () => {
    const dims = deriveBoxDims(BASE);
    const outer: BoxSpec = {
      ...BASE,
      widthMm: dims.outerWidthMm,
      depthMm: dims.outerDepthMm,
      heightMm: dims.outerHeightMm,
      dimensionMode: 'outer',
    };
    expect(estimateBoxWork(outer)).toEqual(estimateBoxWork(BASE));
  });

  it('preserves monotonic cell and divider relationships', () => {
    const widerFingers = estimateBoxWork({ ...BASE, targetFingerWidthMm: 18 });
    const ordinary = estimateBoxWork(BASE);
    expect(widerFingers.axisCells.x).toBeLessThanOrEqual(ordinary.axisCells.x);
    expect(widerFingers.axisCells.y).toBeLessThanOrEqual(ordinary.axisCells.y);
    expect(widerFingers.axisCells.z).toBeLessThanOrEqual(ordinary.axisCells.z);

    const oneEach = estimateBoxWork({ ...BASE, dividersXCount: 1, dividersYCount: 1 });
    const twoByOne = estimateBoxWork({ ...BASE, dividersXCount: 2, dividersYCount: 1 });
    expect(twoByOne.predictedParts).toBe(oneEach.predictedParts + 1);
    expect(twoByOne.crossLapPairs).toBe(oneEach.crossLapPairs + 1);
  });

  it('saturates extreme counts to finite safe advisory values', () => {
    const estimate = estimateBoxWork({
      ...BASE,
      widthMm: Number.MAX_VALUE,
      dividersXCount: Number.MAX_SAFE_INTEGER + 1,
      dividersYCount: Number.MAX_SAFE_INTEGER + 1,
    });
    const values = [
      ...Object.values(estimate.axisCells),
      estimate.junctionCells,
      estimate.dividerCount,
      estimate.crossLapPairs,
      estimate.predictedParts,
      estimate.predictedRings,
      estimate.nominalPointUpper,
      estimate.reliefBooleanInputVertexUpper,
      estimate.claimCellVisits,
      estimate.slotCellVisits,
      estimate.dividerCellVisits,
    ];
    expect(values.every((value) => Number.isSafeInteger(value) && value >= 0)).toBe(true);
    expect(estimate.saturatedFields).toContain('axisCells.x');
    expect(estimate.saturatedFields).toContain('predictedParts');
  });
});
