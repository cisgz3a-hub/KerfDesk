import { describe, expect, it } from 'vitest';
import { IDENTITY_AFFINE } from '../../core/image-edit/transform-blit';
import { dragTransform, handlePositions, hitTransformHandle } from './editor-transform';

const RECT = { x: 10, y: 10, width: 20, height: 10 };

describe('handlePositions', () => {
  it('places the corners of the unrotated box', () => {
    const handles = handlePositions(RECT, IDENTITY_AFFINE);
    expect(handles.nw).toEqual({ x: 10, y: 10 });
    expect(handles.se).toEqual({ x: 30, y: 20 });
    expect(handles.n).toEqual({ x: 20, y: 10 });
  });
});

describe('hitTransformHandle', () => {
  it('grabs a corner within tolerance, move inside, rotate outside', () => {
    expect(hitTransformHandle(RECT, IDENTITY_AFFINE, { x: 10.5, y: 10.5 }, 2)).toBe('nw');
    expect(hitTransformHandle(RECT, IDENTITY_AFFINE, { x: 20, y: 15 }, 2)).toBe('move');
    expect(hitTransformHandle(RECT, IDENTITY_AFFINE, { x: 45, y: 2 }, 2)).toBe('rotate');
  });
});

describe('dragTransform', () => {
  it('move translates by the drag delta', () => {
    const next = dragTransform(
      IDENTITY_AFFINE,
      RECT,
      'move',
      { x: 20, y: 15 },
      { x: 26, y: 11 },
      false,
    );
    expect(next.translateX).toBe(6);
    expect(next.translateY).toBe(-4);
  });

  it('corner drag scales proportionally by default and freely with Shift', () => {
    // Centre (20, 15); dragging se from (30, 20) to (40, 20): x-ratio 2.
    const proportional = dragTransform(
      IDENTITY_AFFINE,
      RECT,
      'se',
      { x: 30, y: 20 },
      { x: 40, y: 20 },
      false,
    );
    expect(proportional.scaleX).toBeCloseTo(2, 5);
    expect(proportional.scaleY).toBeCloseTo(2, 5);

    const free = dragTransform(
      IDENTITY_AFFINE,
      RECT,
      'se',
      { x: 30, y: 20 },
      { x: 40, y: 20 },
      true,
    );
    expect(free.scaleX).toBeCloseTo(2, 5);
    expect(free.scaleY).toBeCloseTo(1, 5);
  });

  it('edge drag scales only its axis', () => {
    const next = dragTransform(
      IDENTITY_AFFINE,
      RECT,
      'e',
      { x: 30, y: 15 },
      { x: 35, y: 15 },
      false,
    );
    expect(next.scaleX).toBeCloseTo(1.5, 5);
    expect(next.scaleY).toBe(1);
  });

  it('rotate follows the pointer angle about the centre', () => {
    // From due east to due south of centre (20, 15) = +90°.
    const next = dragTransform(
      IDENTITY_AFFINE,
      RECT,
      'rotate',
      { x: 40, y: 15 },
      { x: 20, y: 35 },
      false,
    );
    expect(next.rotateDeg).toBeCloseTo(90, 3);
  });
});
