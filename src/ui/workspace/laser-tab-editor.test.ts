import { afterEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createLayerSubLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
} from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import {
  finishLaserTabDrag,
  hitLaserTabAnchor,
  moveLaserTabDrag,
  operationById,
  type LaserTabDragState,
} from './laser-tab-editor';

const RED = '#ff0000';

const PART: ImportedSvg = {
  kind: 'imported-svg',
  id: 'part',
  source: 'part.svg',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: RED,
      polylines: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
        },
      ],
    },
  ],
  laserTabAnchors: [
    { layerColor: '#0000ff', pathIndex: 0, polylineIndex: 0, pathT: 0.125 },
    { layerColor: RED, pathIndex: 0, polylineIndex: 0, pathT: 0.125 },
  ],
};

afterEach(resetStore);

function install(): void {
  useStore.setState({
    project: {
      ...createProject(),
      scene: { objects: [PART], layers: [createLayer({ id: 'L1', color: RED })], groups: [] },
    },
    selectedObjectId: PART.id,
    additionalSelectedIds: new Set(),
    undoStack: [],
    redoStack: [],
  });
}

function drag(): LaserTabDragState {
  return {
    kind: 'laser-tab',
    anchorIndex: 1,
    layerColor: RED,
    startClientX: 100,
    startClientY: 100,
  };
}

describe('laser tab editor (ADR-494)', () => {
  it('hits the placed tab of the tool colour under the pointer', () => {
    // The tab sits at (5, 0); the handle is 7 px, here 0.1 mm per px.
    expect(hitLaserTabAnchor(PART, RED, { x: 5.5, y: 0.2 }, 0.1)).toBe(1);
    expect(hitLaserTabAnchor(PART, RED, { x: 6, y: 0 }, 0.1)).toBeNull();
    expect(hitLaserTabAnchor(PART, '#00ff00', { x: 5, y: 0 }, 0.1)).toBeNull();
  });

  it('removes a tab clicked without moving', () => {
    install();
    const state = drag();
    useStore.getState().beginInteraction();
    moveLaserTabDrag(state, 101, 101, { x: 6, y: 0 });
    finishLaserTabDrag(state);
    expect(useStore.getState().project.scene.objects[0]?.laserTabAnchors).toEqual([
      PART.laserTabAnchors![0],
    ]);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('moves a dragged tab as one undo step', () => {
    install();
    const state = drag();
    useStore.getState().beginInteraction();
    moveLaserTabDrag(state, 140, 100, { x: 10, y: 5 });
    finishLaserTabDrag(state);
    expect(useStore.getState().project.scene.objects[0]?.laserTabAnchors?.[1]?.pathT).toBeCloseTo(
      0.375,
      9,
    );
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(useStore.getState().project.scene.objects[0]?.laserTabAnchors).toEqual(
      PART.laserTabAnchors,
    );
  });

  it('finds an operation or sub-operation by its id', () => {
    const base = createLayer({ id: 'L1', color: RED });
    const layer = { ...base, subLayers: [createLayerSubLayer(base, { id: 'S1', label: 'Score' })] };
    expect(operationById([layer], 'L1')).toBe(layer);
    expect(operationById([layer], 'L1:S1')).toMatchObject({ id: 'L1:S1', name: 'Score' });
    expect(operationById([layer], 'missing')).toBeNull();
  });
});
