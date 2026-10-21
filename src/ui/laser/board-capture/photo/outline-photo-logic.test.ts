import { describe, expect, it } from 'vitest';
import {
  buildPhotoOutlineDraft,
  displayPointToImage,
  nearestOutlineVertex,
  toggleOutlineAnchor,
} from './outline-photo-logic';

const OUTLINE = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 30 },
  { x: 30, y: 30 },
  { x: 30, y: 80 },
  { x: 0, y: 80 },
];

describe('outline photo dialog logic', () => {
  it('maps displayed clicks to decoded image pixels', () => {
    expect(
      displayPointToImage(
        { x: 260, y: 170 },
        { left: 10, top: 20, width: 500, height: 300 },
        { width: 1000, height: 600 },
      ),
    ).toEqual({ x: 500, y: 300 });
  });

  it('keeps between two and six anchors', () => {
    expect(toggleOutlineAnchor(2, [0, 1])).toEqual({ anchors: [0, 1, 2], blocked: false });
    expect(toggleOutlineAnchor(1, [0, 1])).toMatchObject({ anchors: [0, 1], blocked: true });
    expect(toggleOutlineAnchor(6, [0, 1, 2, 3, 4, 5])).toMatchObject({ blocked: true });
  });

  it('builds a sized draft and chooses the farthest second anchor', () => {
    const draft = buildPhotoOutlineDraft({
      outlineMm: OUTLINE,
      widthMm: 200,
      heightMm: 100,
      anchorIndices: [0, 1, 2, 4, 5],
      firstAnchor: 5,
    });
    expect(draft?.captureOrder).toEqual([5, 1]);
    expect(draft?.localPointsMm[2]).toEqual({ x: 200, y: 37.5 });
    expect(
      buildPhotoOutlineDraft({
        outlineMm: OUTLINE,
        widthMm: 0,
        heightMm: 100,
        anchorIndices: [0, 1],
        firstAnchor: 0,
      }),
    ).toBeNull();
  });

  it('finds only nearby outline vertices', () => {
    expect(nearestOutlineVertex({ x: 98, y: 2 }, OUTLINE)).toBe(1);
    expect(nearestOutlineVertex({ x: 50, y: 50 }, OUTLINE)).toBeNull();
  });
});
