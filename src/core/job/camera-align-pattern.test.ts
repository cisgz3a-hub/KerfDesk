import { describe, expect, it } from 'vitest';
import { generateCameraAlignPattern } from './camera-align-pattern';

describe('generateCameraAlignPattern', () => {
  const pattern = generateCameraAlignPattern({ bedWidthMm: 400, bedHeightMm: 300 });

  it('emits five patches (origin pair + three corners) of two squares each', () => {
    expect(pattern.objects).toHaveLength(10);
    expect(pattern.layer.mode).toBe('fill');
  });

  it('places every square fully on the bed', () => {
    for (const object of pattern.objects) {
      expect(object.transform.x).toBeGreaterThanOrEqual(0);
      expect(object.transform.y).toBeGreaterThanOrEqual(0);
      expect(object.transform.x + object.bounds.maxX).toBeLessThanOrEqual(400);
      expect(object.transform.y + object.bounds.maxY).toBeLessThanOrEqual(300);
    }
  });

  it("each patch's two squares meet exactly at the target X-corner", () => {
    // The origin pair midpoint and the three singles must equal the layout
    // targets: square (−1,−1) ends where square (0,0) begins.
    const { layout } = pattern;
    const corners = pattern.objects
      .filter((o) => o.id.endsWith('-1'))
      .map((o) => ({ x: o.transform.x, y: o.transform.y }));
    // Patches 0 and 1 are the origin pair; their corners straddle the target.
    const origin = layout.targets[0];
    const pairMidX = ((corners[0]?.x ?? 0) + (corners[1]?.x ?? 0)) / 2;
    expect(pairMidX).toBeCloseTo(origin.x, 6);
    // Singles sit exactly on their targets.
    expect(corners[2]).toEqual(layout.targets[1]);
    expect(corners[3]).toEqual(layout.targets[2]);
    expect(corners[4]).toEqual(layout.targets[3]);
  });

  it('is deterministic', () => {
    expect(generateCameraAlignPattern({ bedWidthMm: 400, bedHeightMm: 300 })).toEqual(pattern);
  });
});
