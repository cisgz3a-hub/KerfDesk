import { describe, expect, it } from 'vitest';
import { squaredFaceEdgeDistance } from './stamp-distance';
import { prepareStampHeight, assertStampDimensions } from './stamp-height';

/** Independent oracle: enumerate the physical rectangle of every face pixel
 * and measure each sample centre to its nearest clamped point. */
function oracle(face: Uint8Array, width: number, height: number, px: number, py: number): number[] {
  const cells = Array.from({ length: width * height }, (_, index) => index).filter(
    (index) => face[index] === 1,
  );
  return Array.from(face.keys()).map((index) => {
    const x = ((index % width) + 0.5) * px;
    const y = (Math.floor(index / width) + 0.5) * py;
    return Math.min(
      ...cells.map((cell) => {
        const minX = (cell % width) * px;
        const minY = Math.floor(cell / width) * py;
        const nearestX = Math.max(minX, Math.min(x, minX + px));
        const nearestY = Math.max(minY, Math.min(y, minY + py));
        return (x - nearestX) ** 2 + (y - nearestY) ** 2;
      }),
    );
  });
}
describe('stamp height intent', () => {
  it('matches an independent exact rectangle-edge oracle on irregular anisotropic masks', () => {
    for (let seed = 0; seed < 24; seed += 1) {
      const width = 7;
      const height = 6;
      const face = Uint8Array.from({ length: width * height }, (_, index) =>
        (index * 17 + seed * 31) % 23 < 6 ? 1 : 0,
      );
      const actual = squaredFaceEdgeDistance(face, width, height, 0.17, 0.43);
      oracle(face, width, height, 0.17, 0.43).forEach((expected, index) =>
        expect(actual[index]).toBeCloseTo(expected, 10),
      );
    }
  });
  it('keeps flat white faces and grades by exact mm distance to zero at the measured taper', () => {
    const source = { width: 1, height: 1, widthMm: 2, heightMm: 4, luma: new Uint8Array([0]) };
    const draft = prepareStampHeight(source, { threshold: 127, taperMm: 3, mirror: false });
    const row = draft.paddingY * draft.width + draft.paddingX;
    expect(draft.luma[row]).toBe(255);
    expect(draft.luma[row + 1]).toBe(170); // centre is 1 mm beyond a 2 mm cell edge
    expect(draft.luma[row + 2]).toBe(0); // centre is 3 mm beyond that edge
    expect(draft.luma[row + draft.width]).toBe(85); // 2 mm distance at vertical pitch 4
    expect(draft.luma[row + draft.width + 1]).toBe(Math.round(255 * (1 - Math.sqrt(5) / 3)));
    expect(draft.widthMm).toBe(draft.width * 2);
    expect(draft.heightMm).toBe(draft.height * 4);
    expect(draft.luma[0]).toBe(0);
  });
  it('mirrors the thresholded face horizontally without changing dimensions or source bytes', () => {
    const original = new Uint8Array([0, 200, 255, 255, 200, 0]);
    const source = { width: 3, height: 2, widthMm: 6, heightMm: 2, luma: original };
    const plain = prepareStampHeight(source, { threshold: 200, taperMm: 0.7, mirror: false });
    const mirrored = prepareStampHeight(source, { threshold: 200, taperMm: 0.7, mirror: true });
    expect(mirrored.width).toBe(plain.width);
    expect(mirrored.height).toBe(plain.height);
    for (let y = 0; y < plain.height; y += 1)
      for (let x = 0; x < plain.width; x += 1)
        expect(mirrored.luma[y * plain.width + x]).toBe(
          plain.luma[y * plain.width + plain.width - 1 - x],
        );
    expect(Array.from(original)).toEqual([0, 200, 255, 255, 200, 0]);
  });
  it('uses threshold inclusively, rejects empty faces and validates before large allocations', () => {
    const source = {
      width: 3,
      height: 1,
      widthMm: 3,
      heightMm: 1,
      luma: new Uint8Array([127, 128, 255]),
    };
    const draft = prepareStampHeight(source, { threshold: 127, taperMm: 0, mirror: false });
    expect(draft.facePixels).toBe(1);
    expect(new Set(draft.luma)).toEqual(new Set([0, 255]));
    expect(() => prepareStampHeight(source, { threshold: 126, taperMm: 0, mirror: false })).toThrow(
      'No raised face',
    );
    expect(() => prepareStampHeight(source, { threshold: 255, taperMm: 0, mirror: false })).toThrow(
      'threshold',
    );
    expect(() =>
      prepareStampHeight(source, { threshold: 127, taperMm: -1, mirror: false }),
    ).toThrow('taper');
    expect(() =>
      prepareStampHeight({ ...source, widthMm: 0 }, { threshold: 127, taperMm: 1, mirror: false }),
    ).toThrow('physical');
    expect(() => assertStampDimensions(2000, 2000)).toThrow('limited');
    expect(() =>
      prepareStampHeight(
        { ...source, widthMm: 0.000001 },
        { threshold: 127, taperMm: 100, mirror: false },
      ),
    ).toThrow('limited');
  });
});
