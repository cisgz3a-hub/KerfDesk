import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Project,
  type Transform,
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

  it('closes a scaled-down object by its real mm gap, not its local-unit gap', () => {
    // Traced / imported art stores points in local units (px, viewBox), scaled to
    // mm by the object transform. At 0.1 mm per local unit, endpoints 3 local
    // units apart are 0.3 mm in the real world — well within the 0.5 mm tolerance.
    // The bug compared 3 against 0.5 and refused to close.
    const scaledDown: Transform = { ...IDENTITY_TRANSFORM, scaleX: 0.1, scaleY: 0.1 };
    const project = projectWithObjects([
      vectorObject(
        'scaled-open',
        '#000000',
        false,
        false,
        { x: 3, y: 0 },
        { transform: scaledDown },
      ),
    ]);

    expect(selectedCloseableOpenFillContourCount(project, 'scaled-open', new Set())).toBe(1);
  });

  it('does not close a scaled-up object whose real mm gap exceeds the tolerance', () => {
    // At 5 mm per local unit, a 0.3 local-unit gap is 1.5 mm in the real world,
    // beyond the 0.5 mm tolerance. The bug compared 0.3 against 0.5 and closed it.
    const scaledUp: Transform = { ...IDENTITY_TRANSFORM, scaleX: 5, scaleY: 5 };
    const project = projectWithObjects([
      vectorObject('big-open', '#000000', false, false, { x: 0.3, y: 0 }, { transform: scaledUp }),
    ]);

    expect(selectedCloseableOpenFillContourCount(project, 'big-open', new Set())).toBe(0);
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
  options: { readonly locked?: boolean; readonly transform?: Transform } = {},
): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: options.transform ?? IDENTITY_TRANSFORM,
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
