import { describe, expect, it } from 'vitest';
import {
  applyCut3DCameraControl,
  cut3DCameraPose,
  initialCut3DCameraState,
} from './cut3d-offscreen-camera';

describe('Cut 3D offscreen camera', () => {
  it('opens at the legacy Z-up three-quarter pose deterministically', () => {
    const first = initialCut3DCameraState(120, 80, 12);
    const second = initialCut3DCameraState(120, 80, 12);
    expect(second).toEqual(first);
    expect(cut3DCameraPose(first).position).toEqual([
      expect.closeTo(134.4),
      expect.closeTo(-134.4),
      expect.closeTo(115.2),
    ]);
  });

  it('applies ordered rotate, zoom, and pan messages reproducibly', () => {
    const initial = initialCut3DCameraState(100, 60, 10);
    const controls = [
      { kind: 'rotate' as const, deltaX: 20, deltaY: -8 },
      { kind: 'zoom' as const, deltaY: 100 },
      { kind: 'pan' as const, deltaX: 12, deltaY: -7 },
    ];
    const reduce = () =>
      controls.reduce((state, control) => applyCut3DCameraControl(state, control, 480), initial);
    expect(reduce()).toEqual(reduce());
    expect(reduce()).not.toEqual(initial);
  });

  it('keeps pitch and zoom inside finite camera bounds', () => {
    const initial = initialCut3DCameraState(100, 60, 10);
    const pitched = applyCut3DCameraControl(
      initial,
      { kind: 'rotate', deltaX: 0, deltaY: 1_000_000 },
      480,
    );
    const zoomed = applyCut3DCameraControl(pitched, { kind: 'zoom', deltaY: -1_000_000 }, 480);
    expect(pitched.pitchRad).toBeLessThan(Math.PI / 2);
    expect(zoomed.radiusMm).toBe(zoomed.minRadiusMm);
    expect(cut3DCameraPose(zoomed).position.every(Number.isFinite)).toBe(true);
  });
});
