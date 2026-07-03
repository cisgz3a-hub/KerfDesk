import { describe, expect, it } from 'vitest';
import type { Polyline, Vec2 } from '../../core/scene';
import {
  measureBandExcessTurnPer100Px,
  measureNearlyClosedOpenChains,
} from './arch-house-edge-truth';

const BAND = { x0: 0, y0: 0, x1: 100, y1: 100 };

function ring(radius: number, wobbleAmplitude: number): Polyline {
  const points: Vec2[] = [];
  for (let deg = 0; deg < 360; deg += 4) {
    const angle = (deg * Math.PI) / 180;
    // The wobble term ripples the radius 18 times around the ring — the
    // staircase-lump signature the excess-turn metric must flag.
    const r = radius + wobbleAmplitude * Math.sin(18 * angle);
    points.push({ x: 50 + r * Math.cos(angle), y: 50 + r * Math.sin(angle) });
  }
  return { points, closed: true };
}

function square(): Polyline {
  const points: Vec2[] = [];
  for (let t = 10; t < 90; t += 2) points.push({ x: t, y: 10 });
  for (let t = 10; t < 90; t += 2) points.push({ x: 90, y: t });
  for (let t = 90; t > 10; t -= 2) points.push({ x: t, y: 90 });
  for (let t = 90; t > 10; t -= 2) points.push({ x: 10, y: t });
  return { points, closed: true };
}

describe('measureBandExcessTurnPer100Px', () => {
  it('stays near zero for a clean circle', () => {
    expect(measureBandExcessTurnPer100Px([ring(30, 0)], BAND)).toBeLessThan(2);
  });

  it('ignores genuine corners (a square scores like a circle)', () => {
    expect(measureBandExcessTurnPer100Px([square()], BAND)).toBeLessThan(2);
  });

  it('flags a wobbling ring far above the clean baseline', () => {
    expect(measureBandExcessTurnPer100Px([ring(30, 1.2)], BAND)).toBeGreaterThan(20);
  });
});

describe('measureNearlyClosedOpenChains', () => {
  it('counts open chains whose own ends nearly touch, ignoring closed ones', () => {
    const openRing: Polyline = { points: ring(20, 0).points, closed: false };
    const quality = measureNearlyClosedOpenChains([openRing, ring(30, 0)]);
    expect(quality.nearlyClosedOpenCount).toBe(1);
    expect(quality.maxNearlyClosedGapPx).toBeGreaterThan(0);
    expect(quality.maxNearlyClosedGapPx).toBeLessThanOrEqual(8);
  });
});
