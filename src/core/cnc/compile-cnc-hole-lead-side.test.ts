import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncCutDirection,
  type CncLayerSettings,
  type ImportedSvg,
  type Layer,
  type Vec2,
} from '../scene';
import { cncPassXyPoints } from '../job';
import { pointInPolygon } from '../geometry';
import { compileCncJob } from './compile-cnc-job';

// ADR-252 regression. A hole's waste is the slug INSIDE its tool-center ring, so
// every point of the hole's lead must lie inside that ring. Measuring against the
// hole's drawn boundary instead is too loose: a point one tool radius outside the
// ring still falls inside the drawn boundary while the cutter is already eating
// the kept part beyond the finished wall.

function holedPart(): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'holed',
    source: 'holed.svg',
    bounds: { minX: 50, minY: 50, maxX: 150, maxY: 150 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#2563eb',
        polylines: [
          {
            closed: true,
            points: [
              { x: 50, y: 50 },
              { x: 150, y: 50 },
              { x: 150, y: 150 },
              { x: 50, y: 150 },
            ],
          },
          {
            closed: true,
            points: [
              { x: 85, y: 85 },
              { x: 115, y: 85 },
              { x: 115, y: 115 },
              { x: 85, y: 115 },
            ],
          },
        ],
      },
    ],
  };
}

function holePassPoints(extra: Partial<CncLayerSettings>): ReadonlyArray<Vec2> {
  const layer: Layer = {
    ...createLayer({ id: 'op', color: '#2563eb' }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'profile-outside',
      depthMm: 2,
      depthPerPassMm: 2,
      ...extra,
    },
  };
  const group = compileCncJob(
    { objects: [holedPart()], layers: [layer] },
    DEFAULT_DEVICE_PROFILE,
    DEFAULT_CNC_MACHINE_CONFIG,
  ).groups[0];
  if (group?.kind !== 'cnc') throw new Error('expected a cnc group');
  // The hole is the pass with the smallest X span.
  const spanX = (pass: (typeof group.passes)[number]): number => {
    const xs = cncPassXyPoints(pass).map((point) => point.x);
    return Math.max(...xs) - Math.min(...xs);
  };
  const smallest = [...group.passes].sort((a, b) => spanX(a) - spanX(b))[0];
  if (smallest === undefined) throw new Error('expected a hole pass');
  return cncPassXyPoints(smallest);
}

// Distance from a point to a closed polyline's boundary. Contour vertices sit
// exactly ON the ring, where pointInPolygon is ambiguous, so the assertion
// measures how far OUTSIDE a point strays rather than testing containment
// outright — a real gouge is a full tool radius out, not a rounding error.
const ON_RING_TOLERANCE_MM = 1e-6;

function distanceToRingMm(point: Vec2, ring: ReadonlyArray<Vec2>): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < ring.length; index += 1) {
    const start = ring[index] as Vec2;
    const end = ring[(index + 1) % ring.length] as Vec2;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared <= ON_RING_TOLERANCE_MM
        ? 0
        : Math.max(
            0,
            Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
          );
    nearest = Math.min(
      nearest,
      Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t)),
    );
  }
  return nearest;
}

describe('hole lead side under cut-direction enforcement', () => {
  for (const direction of ['climb', 'conventional'] as ReadonlyArray<CncCutDirection>) {
    it(`keeps the hole lead inside the hole tool-center ring (${direction})`, () => {
      // Leads off gives the bare tool-center ring — the hole's waste boundary.
      const ring = holePassPoints({ cutDirection: direction, profileLead: { shape: 'none' } });
      const led = holePassPoints({ cutDirection: direction });
      const excursionMm = led
        .filter((point) => !pointInPolygon(point, ring))
        .map((point) => distanceToRingMm(point, ring));
      const worstMm = excursionMm.length === 0 ? 0 : Math.max(...excursionMm);
      // Before ADR-252 this was a full tool radius (~1.59 mm) into the kept part.
      expect(worstMm).toBeLessThanOrEqual(ON_RING_TOLERANCE_MM);
    });
  }
});
