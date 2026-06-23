import { describe, expect, it, vi } from 'vitest';
import {
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  addObject,
  type ImportedSvg,
} from '../../core/scene';
import { beginPathNodeDrag, updatePathNodeDrag } from './path-node-drag';

describe('beginPathNodeDrag', () => {
  it('selects the hit node and returns a path-node drag state', () => {
    const selectPathNode = vi.fn();
    const project = {
      ...createProject(),
      scene: addObject(EMPTY_SCENE, vectorObject()),
    };

    const drag = beginPathNodeDrag({
      project,
      scenePoint: { x: 10.25, y: 0.2 },
      pxToMm: 0.25,
      selectPathNode,
    });

    expect(drag).toEqual({
      kind: 'path-node',
      startScenePoint: { x: 10.25, y: 0.2 },
    });
    expect(selectPathNode).toHaveBeenCalledWith({
      objectId: 'logo',
      pathIndex: 0,
      polylineIndex: 0,
      pointIndex: 1,
    });
  });

  it('clears node selection and does not start a drag when no node is hit', () => {
    const selectPathNode = vi.fn();
    const project = {
      ...createProject(),
      scene: addObject(EMPTY_SCENE, vectorObject()),
    };

    expect(
      beginPathNodeDrag({
        project,
        scenePoint: { x: 100, y: 100 },
        pxToMm: 0.25,
        selectPathNode,
      }),
    ).toBeNull();
    expect(selectPathNode).toHaveBeenCalledWith(null);
  });

  it('updates the selected node position while a path-node drag is active', () => {
    const setSelectedPathNodePositionDuringInteraction = vi.fn();

    updatePathNodeDrag({
      drag: { kind: 'path-node', startScenePoint: { x: 0, y: 0 } },
      point: { x: 15, y: 7 },
      setSelectedPathNodePositionDuringInteraction,
    });

    expect(setSelectedPathNodePositionDuringInteraction).toHaveBeenCalledWith({ x: 15, y: 7 });
  });

  it('ignores path-node drag updates when the cursor is outside the canvas', () => {
    const setSelectedPathNodePositionDuringInteraction = vi.fn();

    updatePathNodeDrag({
      drag: { kind: 'path-node', startScenePoint: { x: 0, y: 0 } },
      point: null,
      setSelectedPathNodePositionDuringInteraction,
    });

    expect(setSelectedPathNodePositionDuringInteraction).not.toHaveBeenCalled();
  });
});

function vectorObject(): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'logo',
    source: 'logo.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
            ],
          },
        ],
      },
    ],
  };
}
