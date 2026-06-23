import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Project,
} from '../../core/scene';
import {
  selectedOpenFillContourRepairSummary,
  selectedCloseableOpenFillContourCount,
  selectedOpenFillContourCount,
} from './fill-diagnostics';

describe('fill diagnostics', () => {
  it('counts only selected open contours on output Fill layers', () => {
    const project = projectWithObjects([
      vectorObject('selected-open', '#000000', false),
      vectorObject('unselected-open', '#000000', false),
      vectorObject('selected-line', '#ff0000', false),
    ]);

    expect(selectedOpenFillContourCount(project, 'selected-open', new Set(['selected-line']))).toBe(
      1,
    );
  });

  it('does not warn for geometrically closed contours whose closed flag is stale', () => {
    const project = projectWithObjects([vectorObject('closed-enough', '#000000', false, true)]);

    expect(selectedOpenFillContourCount(project, 'closed-enough', new Set())).toBe(0);
  });

  it('counts only selected open Fill contours that are safe to close automatically', () => {
    const project = projectWithObjects([
      vectorObject('near-open', '#000000', false, false, { x: 0.25, y: 0.25 }),
      vectorObject('far-open', '#000000', false, false, { x: 1, y: 1 }),
      vectorObject('line-near-open', '#ff0000', false, false, { x: 0.25, y: 0.25 }),
    ]);

    expect(
      selectedCloseableOpenFillContourCount(
        project,
        'near-open',
        new Set(['far-open', 'line-near-open']),
      ),
    ).toBe(1);
  });

  it('summarizes reviewed tolerance repair without counting locked or out-of-range contours', () => {
    const project = projectWithObjects([
      vectorObject('near-open', '#000000', false, false, { x: 0.25, y: 0.25 }),
      vectorObject('review-open', '#000000', false, false, { x: 2, y: 2 }),
      vectorObject('too-wide-open', '#000000', false, false, { x: 4, y: 4 }),
      vectorObject('line-open', '#ff0000', false, false, { x: 2, y: 2 }),
      vectorObject('locked-open', '#000000', false, false, { x: 2, y: 2 }, { locked: true }),
    ]);

    expect(
      selectedOpenFillContourRepairSummary(project, 'near-open', new Set(['review-open']), 3),
    ).toEqual({
      openCount: 2,
      safeCount: 1,
      reviewedCount: 1,
      remainingCount: 0,
    });

    expect(
      selectedOpenFillContourRepairSummary(
        project,
        'near-open',
        new Set(['review-open', 'too-wide-open', 'line-open', 'locked-open']),
        3,
      ),
    ).toEqual({
      openCount: 4,
      safeCount: 1,
      reviewedCount: 1,
      remainingCount: 2,
    });
  });
});

function projectWithObjects(objects: ReadonlyArray<ImportedSvg>): Project {
  return {
    ...createProject(),
    scene: {
      layers: [
        createLayer({ id: '#000000', color: '#000000', mode: 'fill' }),
        createLayer({ id: '#ff0000', color: '#ff0000', mode: 'line' }),
      ],
      objects,
      groups: [],
    },
  };
}

function vectorObject(
  id: string,
  color: string,
  closed: boolean,
  returnToStart = false,
  lastPoint: { readonly x: number; readonly y: number } = { x: 10, y: 10 },
  options: { readonly locked?: boolean } = {},
): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    ...(options.locked === undefined ? {} : { locked: options.locked }),
    paths: [
      {
        color,
        polylines: [
          {
            closed,
            points: returnToStart
              ? [
                  { x: 0, y: 0 },
                  { x: 10, y: 0 },
                  { x: 0, y: 0 },
                ]
              : [{ x: 0, y: 0 }, { x: 10, y: 0 }, lastPoint],
          },
        ],
      },
    ],
  };
}
