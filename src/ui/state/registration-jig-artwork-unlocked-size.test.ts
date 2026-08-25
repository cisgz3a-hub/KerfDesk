import { beforeEach, describe, expect, it } from 'vitest';
import {
  findRegistrationBoxes,
  IDENTITY_TRANSFORM,
  isRegistrationBox,
  transformedBBox,
} from '../../core/scene';
import { selectionMetricsInFrame } from '../../core/scene/selection-transform';
import { createRectangle } from '../../core/shapes/primitives';
import { useStore } from './store';
import { resetStore } from './test-helpers';

describe('unlocked registration jig artwork sizing', () => {
  beforeEach(() => {
    resetStore();
    useStore.getState().replaceRegistrationJigSet({
      outline: { kind: 'rectangle', widthMm: 50, heightMm: 40 },
      rows: 1,
      columns: 3,
      spacingX: 10,
      spacingY: 0,
    });
    useStore.getState().drawShape(
      createRectangle({
        id: 'art',
        color: '#0000ff',
        spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
        transform: { ...IDENTITY_TRANSFORM, x: 0, y: 0 },
      }),
    );
    useStore.getState().centerSelectionInRegistrationBox();
  });

  it('applies independent width and height to every centered copy', () => {
    const result = useStore.getState().resizeRegistrationJigArtwork({
      widthMm: 30,
      heightMm: 10,
      drivingDimension: 'width',
      preserveAspect: false,
    });

    expect(result).toEqual({ kind: 'ok' });
    const scene = useStore.getState().project.scene;
    const boxes = findRegistrationBoxes(scene);
    const artwork = scene.objects.filter((object) => !isRegistrationBox(object));
    for (const [index, object] of artwork.entries()) {
      const bounds = transformedBBox(object);
      const boxBounds = transformedBBox(boxes[index]!);
      expect(bounds.maxX - bounds.minX).toBeCloseTo(30);
      expect(bounds.maxY - bounds.minY).toBeCloseTo(10);
      expect(centerOf(bounds)).toEqual(centerOf(boxBounds));
    }
  });

  it('applies independent local-axis dimensions to rotated artwork without refusing', () => {
    useStore.getState().newProject();
    useStore.getState().replaceRegistrationJigSet({
      outline: { kind: 'rectangle', widthMm: 60, heightMm: 50 },
      rows: 1,
      columns: 3,
      spacingX: 10,
      spacingY: 0,
    });
    useStore.getState().drawShape(
      createRectangle({
        id: 'rotated-art',
        color: '#0000ff',
        spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
        transform: { ...IDENTITY_TRANSFORM, rotationDeg: 30 },
      }),
    );
    useStore.getState().centerSelectionInRegistrationBox();

    const result = useStore.getState().resizeRegistrationJigArtwork({
      widthMm: 30,
      heightMm: 12,
      drivingDimension: 'width',
      preserveAspect: false,
    });

    expect(result).toEqual({ kind: 'ok' });
    const scene = useStore.getState().project.scene;
    const boxes = findRegistrationBoxes(scene);
    const artwork = scene.objects.filter((object) => !isRegistrationBox(object));
    for (const [index, object] of artwork.entries()) {
      const metrics = selectionMetricsInFrame([object], 30);
      expect(metrics?.width).toBeCloseTo(30);
      expect(metrics?.height).toBeCloseTo(12);
      expect(centerOf(transformedBBox(object))).toEqual(centerOf(transformedBBox(boxes[index]!)));
    }
  });
});

function centerOf(bounds: {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}): { readonly x: number; readonly y: number } {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}
