import { beforeEach, expect, it } from 'vitest';
import { cncTabAnchorPosition } from '../../core/cnc/cnc-tab-anchors';
import { createProject, IDENTITY_TRANSFORM, type ImportedSvg } from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(resetStore);

it.each([false, true])('Convert to Path retains placed tabs with open=%s and one undo', (open) => {
  const anchor = { layerColor: '#000000', pathIndex: 0, polylineIndex: 0, pathT: 0.125 };
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'tabbed',
    source: 'tabbed.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: {
      ...IDENTITY_TRANSFORM,
      x: 15,
      y: 8,
      scaleX: 3,
      scaleY: 1,
      rotationDeg: 35,
      mirrorX: true,
    },
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: !open,
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
    cncTabAnchors: [anchor],
    laserTabAnchors: [anchor],
  };
  const project = createProject();
  useStore.setState({
    project: { ...project, scene: { ...project.scene, objects: [object] } },
    selectedObjectId: object.id,
  });
  const closed = (value: ImportedSvg): ImportedSvg => ({
    ...value,
    paths: value.paths.map((path) => ({
      ...path,
      polylines: path.polylines.map((line) => ({ ...line, closed: true })),
    })),
  });
  const before = cncTabAnchorPosition(closed(object), anchor);
  useStore.getState().convertSelectionToPath();
  const after = useStore.getState().project.scene.objects[0] as ImportedSvg;
  for (const key of ['cncTabAnchors', 'laserTabAnchors'] as const) {
    expect(after[key]).toHaveLength(1);
    const point = cncTabAnchorPosition(closed(after), after[key]![0]!);
    expect(point?.x).toBeCloseTo(before!.x, 9);
    expect(point?.y).toBeCloseTo(before!.y, 9);
  }
  expect(after.paths[0]?.polylines[0]?.closed).toBe(!open);
  expect(useStore.getState().undoStack).toHaveLength(1);
  expect(useStore.getState().undoStack[0]?.scene.objects[0]).toBe(object);
});
