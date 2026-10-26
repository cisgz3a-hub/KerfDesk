import { describe, expect, it } from 'vitest';
import type { ReliefRailProfileSource } from '../scene/relief/relief-rail-profile';
import type { Vec2 } from '../scene/scene-object';
import { createComponentSampler } from './relief-authoring-sampling';
import { reliefRailProfileError } from './relief-rail-profile-validation';

// Audit F6-P3-3, ADR-575 Amendment 1: an ordinary curved rail, one that turns
// no tighter than half its width, is single-valued and must be accepted at the
// shipped 32 sampling steps, with its sections where the curve puts them. A
// rail that really folds is still refused, and says why.

const PEAK_MM = 4;

function rail(points: ReadonlyArray<Vec2>, widthMm: number, steps = 32): ReliefRailProfileSource {
  const graph = [
    { x: 0, y: 0 },
    { x: 0.5, y: PEAK_MM },
    { x: 1, y: 0 },
  ];
  return {
    kind: 'rail-profile-v1',
    rail: { points },
    widthMm,
    samplingSteps: steps,
    sections: [
      { id: 'start', position: 0, widthScale: 1, profile: graph },
      { id: 'end', position: 1, widthScale: 1, profile: graph },
    ],
  };
}

// A quarter circle of radius `r` about the origin, as `segments` chords.
function quarterArc(r: number, segments: number): Vec2[] {
  return Array.from({ length: segments + 1 }, (_, i) => {
    const angle = ((i / segments) * Math.PI) / 2;
    return { x: r * Math.cos(angle), y: r * Math.sin(angle) };
  });
}

describe('curved rails', () => {
  it.each([7, 9, 16, 31])('accepts a radius 10 quarter arc 4 mm wide in %i chords', (segments) => {
    const points = quarterArc(10, segments);
    for (const steps of [16, 32]) {
      const source = rail(points, 4, steps);
      expect(reliefRailProfileError(source)).toBeNull();
      const sample = createComponentSampler(source);
      // Across an inner vertex the section runs along the radius: the profile's
      // peak on the rail, falling linearly to its edges.
      const vertex = points[Math.floor(segments / 2)] ?? { x: 0, y: 0 };
      const radius = Math.hypot(vertex.x, vertex.y);
      for (const offset of [0, -1, 1, -1.5]) {
        const scale = (radius + offset) / radius;
        const height = sample({ x: vertex.x * scale, y: vertex.y * scale }).heightMm;
        expect(height).toBeCloseTo(PEAK_MM * (1 - (2 * Math.abs(offset)) / 4), 6);
      }
    }
  });

  it.each([1, 1.5, 2, 3])('accepts the app test curve %s mm wide at 32 steps', (widthMm) => {
    const points = [
      { x: 0, y: 5 },
      { x: 2, y: 4 },
      { x: 4, y: 4 },
      { x: 6, y: 5 },
    ];
    expect(reliefRailProfileError(rail(points, widthMm))).toBeNull();
  });

  it('accepts larger arcs and a sine rail whose radius stays above half their width', () => {
    for (const segments of [8, 12, 20, 24]) {
      expect(reliefRailProfileError(rail(quarterArc(50, segments), 6))).toBeNull();
      expect(reliefRailProfileError(rail(quarterArc(30, segments), 10))).toBeNull();
    }
    // Amplitude 5 over a 40 mm wavelength: the tightest radius is about 8.1 mm.
    const sine = Array.from({ length: 25 }, (_, i) => {
      const x = (i / 24) * 40;
      return { x, y: 5 * Math.sin((2 * Math.PI * x) / 40) };
    });
    for (const steps of [32, 64]) {
      expect(reliefRailProfileError(rail(sine, 6, steps))).toBeNull();
      expect(reliefRailProfileError(rail(sine, 4, steps))).toBeNull();
    }
  });

  it('accepts a straight rail whose vertex lands a rounding error from a station', () => {
    // Summed, these lengths put the last inner vertex at t = 0.75000000000000011,
    // beside the 24/32 station.
    const points = [0, 9.325, 18.65, 27.975, 37.3].map((x) => ({ x, y: 0 }));
    const source = rail(points, 4);
    expect(reliefRailProfileError(source)).toBeNull();
    expect(createComponentSampler(source)({ x: 27.975, y: 1 }).heightMm).toBeCloseTo(2, 9);
  });

  it('refuses a rail that turns tighter than half its width, and says so', () => {
    const tight = reliefRailProfileError(rail(quarterArc(1.5, 12), 4));
    expect(tight).toContain('turns tighter than half its width');
    const hairpin = reliefRailProfileError(
      rail(
        [
          { x: 0, y: 0 },
          { x: 5, y: 0 },
          { x: 0, y: 0.5 },
        ],
        4,
      ),
    );
    expect(hairpin).toMatch(/turns tighter than half its width|turns straight back/);
  });
});
