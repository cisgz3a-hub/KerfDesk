import { describe, expect, it } from 'vitest';
import {
  IDENTITY_TRANSFORM,
  transformedBBox,
  type SceneObject,
  type Transform,
} from '../../core/scene';
import { nextTransformForDrag, type DragState } from './drag-state';

const SE_SCALE: Exclude<DragState, { kind: 'pan' | 'draw' }> = {
  kind: 'scale',
  objectId: 'O1',
  handle: 'se',
};

function resizeEvent(args: {
  readonly shiftKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
}): {
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
} {
  return {
    shiftKey: args.shiftKey ?? false,
    altKey: false,
    ctrlKey: args.ctrlKey ?? false,
    metaKey: args.metaKey ?? false,
  };
}

function objectWithBounds(): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'O1',
    source: 'shape.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    paths: [],
  };
}

describe('nextTransformForDrag scale modifiers', () => {
  it('keeps aspect ratio by default when a corner handle is dragged', () => {
    const next = nextTransformForDrag(
      SE_SCALE,
      objectWithBounds(),
      { x: 30, y: 30 },
      resizeEvent({}),
    );

    expect(next.scaleX).toBeCloseTo(1.5);
    expect(next.scaleY).toBeCloseTo(1.5);
  });

  it('lets Shift override aspect ratio on a corner resize', () => {
    const next = nextTransformForDrag(
      SE_SCALE,
      objectWithBounds(),
      { x: 30, y: 30 },
      resizeEvent({ shiftKey: true }),
    );

    expect(next.scaleX).toBeCloseTo(3);
    expect(next.scaleY).toBeCloseTo(1.5);
  });

  it('uses Ctrl/Cmd to resize symmetrically from the object center', () => {
    const object = objectWithBounds();
    const next: Transform = nextTransformForDrag(
      SE_SCALE,
      object,
      { x: 20, y: 40 },
      resizeEvent({ ctrlKey: true }),
    );
    const before = transformedBBox(object);
    const after = transformedBBox({ ...object, transform: next });

    expect(centerOf(after)).toEqual(centerOf(before));
    expect(next.scaleX).toBeCloseTo(3);
    expect(next.scaleY).toBeCloseTo(3);
  });
});

function centerOf(bbox: {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}): { readonly x: number; readonly y: number } {
  return {
    x: (bbox.minX + bbox.maxX) / 2,
    y: (bbox.minY + bbox.maxY) / 2,
  };
}
