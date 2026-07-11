// fair-chain tests — Whittaker–Henderson penalized smoothing of dense
// boundary chains (research brief #3). The frequency response is the
// contract: ink texture at ~6px wavelength attenuates ~94%, drawn waves at
// 25px+ keep ~95%, clamped corner endpoints stay exact.

import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../scene';
import { fairChainSegments } from './fair-chain';

const TEXTURE_WAVELENGTH_PX = 6;

function amplitudeAround(points: ReadonlyArray<Vec2>, baseline: (x: number) => number): number {
  let worst = 0;
  for (const p of points) worst = Math.max(worst, Math.abs(p.y - baseline(p.x)));
  return worst;
}

// A horizontal chain with sinusoidal "ink texture", 0.5px spacing.
function texturedLine(lengthPx: number, wavelengthPx: number, amplitudePx: number): Vec2[] {
  const points: Vec2[] = [];
  for (let x = 0; x <= lengthPx; x += 0.5) {
    points.push({ x, y: amplitudePx * Math.sin((2 * Math.PI * x) / wavelengthPx) });
  }
  return points;
}

describe('fairChainSegments', () => {
  it('fairs ink-texture wavelengths almost completely', () => {
    const noisy = texturedLine(240, TEXTURE_WAVELENGTH_PX, 1);
    const faired = fairChainSegments(noisy, false, new Set(), 1);
    expect(faired.length).toBe(noisy.length);
    // Attenuation is weaker inside ~one cutoff wavelength of a clamped end;
    // the contract is about the interior.
    const interior = faired.filter((p) => p.x > 20 && p.x < 220);
    expect(amplitudeAround(interior, () => 0)).toBeLessThanOrEqual(0.15);
  });

  it('preserves large drawn waves', () => {
    const wave = texturedLine(300, 60, 5);
    const faired = fairChainSegments(wave, false, new Set(), 1);
    const amplitude = amplitudeAround(faired, () => 0);
    // The drawn wave's crest must survive (≥ 90% of its 5px amplitude).
    let crest = 0;
    for (const p of faired) crest = Math.max(crest, p.y);
    expect(crest).toBeGreaterThanOrEqual(4.5);
    expect(amplitude).toBeLessThanOrEqual(5.05);
  });

  it('keeps clamped corner endpoints exact and splits smoothing there', () => {
    // An L with texture on both legs; the corner must stay a corner.
    const points: Vec2[] = [];
    for (let x = 0; x <= 60; x += 0.5) {
      points.push({ x, y: 0.8 * Math.sin((2 * Math.PI * x) / TEXTURE_WAVELENGTH_PX) });
    }
    const corner = { x: 60.5, y: 0 };
    points.push(corner);
    for (let y = 0.5; y <= 60; y += 0.5) {
      points.push({ x: 60.5 + 0.8 * Math.sin((2 * Math.PI * y) / TEXTURE_WAVELENGTH_PX), y });
    }
    const faired = fairChainSegments(points, false, new Set([corner]), 1);
    const kept = faired.find((p) => p.x === corner.x && p.y === corner.y);
    expect(kept).toBeDefined();
    // Texture gone on both legs.
    for (const p of faired) {
      if (p.x > 6 && p.x < 55 && p.y < 1) expect(Math.abs(p.y)).toBeLessThanOrEqual(0.3);
    }
  });

  it('smooths closed rings without a seam artifact', () => {
    // A circle with ink texture: faired ring must stay round everywhere —
    // including at index 0 (the wrap padding removes the seam).
    const points: Vec2[] = [];
    const radius = 40;
    const count = 500;
    for (let i = 0; i < count; i += 1) {
      const a = (i / count) * 2 * Math.PI;
      const r = radius + 0.8 * Math.sin(a * 42); // ~6px wavelength on the rim
      points.push({ x: 100 + r * Math.cos(a), y: 100 + r * Math.sin(a) });
    }
    const faired = fairChainSegments(points, true, new Set(), 1);
    expect(faired.length).toBe(points.length);
    let worst = 0;
    for (const p of faired) {
      worst = Math.max(worst, Math.abs(Math.hypot(p.x - 100, p.y - 100) - radius));
    }
    expect(worst).toBeLessThanOrEqual(0.35);
  });

  it('does not mutate its input and is deterministic', () => {
    const noisy = texturedLine(60, TEXTURE_WAVELENGTH_PX, 1);
    const snapshot = JSON.stringify(noisy);
    const a = fairChainSegments(noisy, false, new Set(), 1);
    const b = fairChainSegments(noisy, false, new Set(), 1);
    expect(JSON.stringify(noisy)).toBe(snapshot);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
