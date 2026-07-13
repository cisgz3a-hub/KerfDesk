import { afterEach, describe, expect, it } from 'vitest';
import {
  createProject,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Project,
} from '../../core/scene';
import { resetStore } from './test-helpers';
import { useStore } from './store';

const OBJECT: ImportedSvg = {
  kind: 'imported-svg',
  id: 'part',
  source: 'part.svg',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
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
};

afterEach(resetStore);

function install(): void {
  const base = createProject();
  const project: Project = { ...base, scene: { objects: [OBJECT], layers: [] } };
  useStore.setState({ project, selectedObjectId: OBJECT.id, additionalSelectedIds: new Set() });
}

describe('CNC tab actions', () => {
  it('seeds, drags, and undoes persisted contour anchors', () => {
    install();
    useStore.getState().seedSelectedCncTabAnchors('#ff0000', 4);
    expect(useStore.getState().project.scene.objects[0]?.cncTabAnchors).toHaveLength(4);

    useStore.getState().beginInteraction();
    useStore.getState().setSelectedCncTabAnchorDuringInteraction(0, '#ff0000', { x: 12, y: 5 });
    useStore.getState().endInteraction();
    expect(useStore.getState().project.scene.objects[0]?.cncTabAnchors?.[0]?.pathT).toBeCloseTo(
      0.375,
      6,
    );

    useStore.getState().undo();
    expect(useStore.getState().project.scene.objects[0]?.cncTabAnchors?.[0]?.pathT).toBe(0.125);
  });

  it('resets manual anchors to automatic placement', () => {
    install();
    useStore.getState().seedSelectedCncTabAnchors('#ff0000', 4);
    useStore.getState().resetSelectedCncTabAnchors('#ff0000');
    expect(useStore.getState().project.scene.objects[0]?.cncTabAnchors).toBeUndefined();
  });
});
