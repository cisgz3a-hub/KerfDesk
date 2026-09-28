import { afterEach, describe, expect, it } from 'vitest';
import { laserTabAnchorPosition } from '../../core/job/laser-tab-anchors';
import {
  applyTransform,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Project,
  type SceneObject,
} from '../../core/scene';
import type { LaserTabAnchor } from '../../core/scene/scene-object';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const RED = '#ff0000';

function square(x: number, y: number, size: number): ImportedSvg['paths'][number]['polylines'][0] {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
  };
}

const OBJECT: ImportedSvg = {
  kind: 'imported-svg',
  id: 'part',
  source: 'part.svg',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [{ color: RED, polylines: [square(0, 0, 10)] }],
};

afterEach(resetStore);

function install(object: SceneObject = OBJECT): void {
  const base = createProject();
  const project: Project = {
    ...base,
    scene: { objects: [object], layers: [createLayer({ id: 'L1', color: RED })], groups: [] },
  };
  useStore.setState({
    project,
    selectedObjectId: object.id,
    additionalSelectedIds: new Set(),
    undoStack: [],
    redoStack: [],
    dirty: false,
  });
}

function anchors(index = 0): ReadonlyArray<LaserTabAnchor> | undefined {
  return useStore.getState().project.scene.objects[index]?.laserTabAnchors;
}

describe('laser tab actions (ADR-494)', () => {
  it('adds a tab at the nearest outline point within reach, one undo step each', () => {
    install();
    expect(useStore.getState().addSelectedLaserTabAnchor(RED, { x: 5, y: 0.4 }, 1)).toBe(true);
    expect(anchors()).toEqual([{ layerColor: RED, pathIndex: 0, polylineIndex: 0, pathT: 0.125 }]);
    expect(useStore.getState().undoStack).toHaveLength(1);
    expect(useStore.getState().dirty).toBe(true);

    // Too far from the outline, or on another colour: nothing is placed.
    expect(useStore.getState().addSelectedLaserTabAnchor(RED, { x: 5, y: 5 }, 1)).toBe(false);
    expect(useStore.getState().addSelectedLaserTabAnchor('#0000ff', { x: 5, y: 0 }, 1)).toBe(false);
    expect(anchors()).toHaveLength(1);
    expect(useStore.getState().undoStack).toHaveLength(1);

    useStore.getState().undo();
    expect(anchors()).toBeUndefined();
  });

  it('removes a tab and drops the field once none is left', () => {
    install({
      ...OBJECT,
      laserTabAnchors: [{ layerColor: RED, pathIndex: 0, polylineIndex: 0, pathT: 0.125 }],
    });
    useStore.getState().removeSelectedLaserTabAnchor(0, '#0000ff');
    expect(anchors()).toHaveLength(1);
    useStore.getState().removeSelectedLaserTabAnchor(0, RED);
    expect(useStore.getState().project.scene.objects[0]).not.toHaveProperty('laserTabAnchors');
    useStore.getState().undo();
    expect(anchors()).toHaveLength(1);
  });

  it('moves a tab live during a drag and undoes the drag as one step', () => {
    install();
    useStore.getState().addSelectedLaserTabAnchor(RED, { x: 5, y: 0 }, 1);
    useStore.getState().beginInteraction();
    useStore.getState().setSelectedLaserTabAnchorDuringInteraction(0, RED, { x: 11, y: 4 });
    useStore.getState().setSelectedLaserTabAnchorDuringInteraction(0, RED, { x: 12, y: 5 });
    useStore.getState().endInteraction();
    expect(anchors()?.[0]?.pathT).toBeCloseTo(0.375, 9);
    expect(useStore.getState().undoStack).toHaveLength(2);
    useStore.getState().undo();
    expect(anchors()?.[0]?.pathT).toBe(0.125);
  });

  it('clears the tabs of one colour back to automatic tabs', () => {
    install({
      ...OBJECT,
      laserTabAnchors: [
        { layerColor: RED, pathIndex: 0, polylineIndex: 0, pathT: 0.1 },
        { layerColor: '#0000ff', pathIndex: 0, polylineIndex: 0, pathT: 0.2 },
      ],
    });
    useStore.getState().clearSelectedLaserTabAnchors(RED);
    expect(anchors()).toEqual([
      { layerColor: '#0000ff', pathIndex: 0, polylineIndex: 0, pathT: 0.2 },
    ]);
  });

  it('leaves locked or multiple selections alone', () => {
    install({ ...OBJECT, locked: true });
    expect(useStore.getState().addSelectedLaserTabAnchor(RED, { x: 5, y: 0 }, 1)).toBe(false);
    install();
    useStore.setState({ additionalSelectedIds: new Set(['other']) });
    expect(useStore.getState().addSelectedLaserTabAnchor(RED, { x: 5, y: 0 }, 1)).toBe(false);
    expect(anchors()).toBeUndefined();
  });
});

describe('placed laser tabs follow their artwork (ADR-494)', () => {
  const PLACED: ImportedSvg = {
    ...OBJECT,
    laserTabAnchors: [{ layerColor: RED, pathIndex: 0, polylineIndex: 0, pathT: 0.125 }],
  };

  it('stay on the same outline point through move, rotate and scale', () => {
    install(PLACED);
    const transform = {
      ...IDENTITY_TRANSFORM,
      x: 100,
      y: 80,
      scaleX: 2,
      scaleY: 0.5,
      rotationDeg: 30,
    };
    useStore.getState().setObjectTransform(PLACED.id, transform);
    useStore.getState().rotateSelectionQuarterTurn(1);
    useStore.getState().nudgeSelection(3, -2);
    const moved = useStore.getState().project.scene.objects[0]!;
    expect(moved.laserTabAnchors).toEqual(PLACED.laserTabAnchors);
    const position = laserTabAnchorPosition(moved, moved.laserTabAnchors![0]!);
    const expected = applyTransform({ x: 5, y: 0 }, moved.transform);
    expect(position?.x).toBeCloseTo(expected.x, 9);
    expect(position?.y).toBeCloseTo(expected.y, 9);
  });

  it('are copied with the artwork', () => {
    install(PLACED);
    useStore.getState().copySelection();
    useStore.getState().pasteClipboard();
    const objects = useStore.getState().project.scene.objects;
    expect(objects).toHaveLength(2);
    expect(objects[1]?.laserTabAnchors).toEqual(PLACED.laserTabAnchors);
  });

  it('go with their contour when the artwork is broken apart', () => {
    install({
      ...OBJECT,
      paths: [{ color: RED, polylines: [square(0, 0, 10), square(20, 0, 10)] }],
      laserTabAnchors: [{ layerColor: RED, pathIndex: 0, polylineIndex: 1, pathT: 0.3 }],
    });
    useStore.getState().breakApartSelection();
    const objects = useStore.getState().project.scene.objects;
    expect(objects).toHaveLength(2);
    expect(objects[0]?.laserTabAnchors).toEqual([]);
    expect(objects[1]?.laserTabAnchors).toEqual([
      { layerColor: RED, pathIndex: 0, polylineIndex: 0, pathT: 0.3 },
    ]);
  });

  it('follow their colour when the operation is recoloured', () => {
    install(PLACED);
    useStore.getState().setLayerColor('L1', '#00ff00');
    const object = useStore.getState().project.scene.objects[0]!;
    expect('paths' in object ? object.paths[0]?.color : null).toBe('#00ff00');
    expect(object.laserTabAnchors?.[0]?.layerColor).toBe('#00ff00');
  });
});
