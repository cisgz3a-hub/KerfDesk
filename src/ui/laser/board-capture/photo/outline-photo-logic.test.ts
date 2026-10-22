import { describe, expect, it } from 'vitest';
import {
  buildPhotoOutlineDraft,
  checkPhotoOutline,
  displayPointToImage,
  nearestOutlineVertex,
  photoOutlineAnchors,
} from './outline-photo-logic';

// An L-shaped board clicked in photo pixels, 1000 × 800 px.
const OUTLINE = [
  { x: 0, y: 0 },
  { x: 1000, y: 0 },
  { x: 1000, y: 300 },
  { x: 300, y: 300 },
  { x: 300, y: 800 },
  { x: 0, y: 800 },
];

describe('outline photo logic', () => {
  it('maps displayed clicks to decoded image pixels', () => {
    expect(
      displayPointToImage(
        { x: 260, y: 170 },
        { left: 10, top: 20, width: 500, height: 300 },
        { width: 1000, height: 600 },
      ),
    ).toEqual({ x: 500, y: 300 });
  });

  it('makes every clicked corner an anchor up to six', () => {
    expect(photoOutlineAnchors(OUTLINE)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(photoOutlineAnchors(OUTLINE.slice(0, 2))).toEqual([]);
    const many = Array.from({ length: 24 }, (_, index) => ({
      x: 100 * Math.cos((index / 24) * 2 * Math.PI),
      y: 100 * Math.sin((index / 24) * 2 * Math.PI),
    }));
    const anchors = photoOutlineAnchors(many);
    expect(anchors.length).toBeGreaterThanOrEqual(2);
    expect(anchors.length).toBeLessThanOrEqual(6);
  });

  it('sizes the clicked outline to the typed board size', () => {
    const check = checkPhotoOutline({
      points: OUTLINE,
      width: '200',
      height: '160',
      firstAnchor: null,
    });
    expect(check.problem).toBeNull();
    expect(check.notice).toBeNull();
    // Default first anchor: the clicked point nearest the photo's bottom-left.
    expect(check.draft?.captureOrder).toEqual([5, 1]);
    expect(check.draft?.localPointsMm[3]).toEqual({ x: 60, y: 60 });
  });

  it('explains what is missing before the outline can be drawn', () => {
    expect(
      checkPhotoOutline({ points: [], width: '', height: '', firstAnchor: null }).problem,
    ).toMatch(/three points/);
    const bowtie = [
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ];
    expect(
      checkPhotoOutline({ points: bowtie, width: '10', height: '10', firstAnchor: null }).problem,
    ).toMatch(/crosses itself/);
    expect(
      checkPhotoOutline({ points: OUTLINE, width: '', height: '160', firstAnchor: null }).problem,
    ).toMatch(/width and height/);
  });

  it('warns when the typed size does not match the photo proportions', () => {
    const check = checkPhotoOutline({
      points: OUTLINE,
      width: '160',
      height: '200',
      firstAnchor: 0,
    });
    expect(check.draft).not.toBeNull();
    expect(check.notice).toMatch(/swapped/);
  });

  it('keeps the chosen first anchor and refuses unknown anchors', () => {
    expect(
      checkPhotoOutline({ points: OUTLINE, width: '200', height: '160', firstAnchor: 2 }).draft
        ?.captureOrder[0],
    ).toBe(2);
    expect(
      buildPhotoOutlineDraft({
        outlineMm: OUTLINE,
        widthMm: 200,
        heightMm: 160,
        anchorIndices: [0, 9],
        firstAnchor: 0,
      }),
    ).toBeNull();
  });

  it('finds only nearby outline vertices', () => {
    expect(nearestOutlineVertex({ x: 998, y: 2 }, OUTLINE)).toBe(1);
    expect(nearestOutlineVertex({ x: 500, y: 500 }, OUTLINE)).toBeNull();
  });
});
