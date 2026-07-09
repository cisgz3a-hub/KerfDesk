// Tests for fitSelectionToBoard (ADR-125 A1) — the store action that scales the
// single selected design to fill the placed board (registration box), centered.
// The action lives in selection-transform-actions.ts alongside the other
// registration-box placement actions; these tests are split out to keep that
// file's test under the size cap.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyTransform,
  findRegistrationBoxes,
  transformedBBox,
  type SceneObject,
} from '../../core/scene';
import { resetStore, svgObj } from './test-helpers';
import { useStore } from './store';

const ART_SIDE_MM = 10; // svgObj bounds are 0..10 in both axes

describe('fitSelectionToBoard', () => {
  beforeEach(() => resetStore());

  it('scales the single selected design to fill the board, centered, as one undoable edit', () => {
    useStore.getState().importSvgObject(svgObj('A', ['#ff0000']));
    useStore.getState().addCapturedBoardBox(100, 60);
    useStore.setState({
      selectedObjectId: 'A',
      additionalSelectedIds: new Set(),
      undoStack: [],
      dirty: false,
    });

    useStore.getState().fitSelectionToBoard();

    const after = useStore.getState();
    const art = after.project.scene.objects.find((o) => o.id === 'A');
    const box = findRegistrationBoxes(after.project.scene)[0];
    if (art === undefined || box === undefined) throw new Error('expected art + board');
    const region = transformedBBox(box);
    const regionW = region.maxX - region.minX;
    const regionH = region.maxY - region.minY;

    // grew to fill with a 10% margin, on the limiting axis
    const expectedScale = 0.9 * Math.min(regionW / ART_SIDE_MM, regionH / ART_SIDE_MM);
    expect(art.transform.scaleX).toBeCloseTo(expectedScale);
    expect(art.transform.scaleY).toBeCloseTo(expectedScale);
    // centered in the board region
    const center = transformedCenter(art);
    expect(center.x).toBeCloseTo((region.minX + region.maxX) / 2);
    expect(center.y).toBeCloseTo((region.minY + region.maxY) / 2);
    expect(after.undoStack).toHaveLength(1);
    expect(after.dirty).toBe(true);
  });

  it('ignores the board itself when it is also part of the selection', () => {
    useStore.getState().importSvgObject(svgObj('A', ['#ff0000']));
    useStore.getState().addCapturedBoardBox(100, 60);
    const box = findRegistrationBoxes(useStore.getState().project.scene)[0];
    if (box === undefined) throw new Error('expected board');
    useStore.setState({
      selectedObjectId: 'A',
      additionalSelectedIds: new Set([box.id]),
      undoStack: [],
      dirty: false,
    });

    useStore.getState().fitSelectionToBoard();

    const art = useStore.getState().project.scene.objects.find((o) => o.id === 'A');
    expect(art?.transform.scaleX).toBeGreaterThan(1); // the fit still ran on the one design
  });

  it('does nothing when more than one design is selected', () => {
    useStore.getState().importSvgObject(svgObj('A', ['#ff0000']));
    useStore.getState().importSvgObject(svgObj('B', ['#00ff00']));
    useStore.getState().addCapturedBoardBox(100, 60);
    useStore.setState({
      selectedObjectId: 'A',
      additionalSelectedIds: new Set(['B']),
      undoStack: [],
      dirty: false,
    });
    const before = useStore.getState().project.scene.objects.map((o) => o.transform);

    useStore.getState().fitSelectionToBoard();

    const after = useStore.getState();
    expect(after.project.scene.objects.map((o) => o.transform)).toEqual(before);
    expect(after.undoStack).toHaveLength(0);
    expect(after.dirty).toBe(false);
  });

  it('does nothing when no board has been placed', () => {
    useStore.getState().importSvgObject(svgObj('A', ['#ff0000']));
    useStore.setState({ selectedObjectId: 'A', undoStack: [], dirty: false });
    const before = useStore.getState().project.scene.objects[0]?.transform;

    useStore.getState().fitSelectionToBoard();

    const after = useStore.getState();
    expect(after.project.scene.objects[0]?.transform).toEqual(before);
    expect(after.undoStack).toHaveLength(0);
  });
});

function transformedCenter(object: SceneObject): { readonly x: number; readonly y: number } {
  return applyTransform(
    {
      x: (object.bounds.minX + object.bounds.maxX) / 2,
      y: (object.bounds.minY + object.bounds.maxY) / 2,
    },
    object.transform,
  );
}
