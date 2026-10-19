import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { encodePower14 } from '../controllers/ruida/rd-numbers';
import { pointInPolygon } from '../geometry';
import type { Vec2 } from '../scene';
import { applyLaserLeads } from './apply-laser-leads';
import type { CutGroup, CutSegment } from './job';
import { hasJobStartPower } from './job-start-power';
import { leadJobLines } from './laser-lead-rings';

function square(x: number, y: number, size: number): CutSegment {
  return {
    closed: true,
    polyline: [
      { x, y },
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
      { x, y },
    ],
  };
}

function group(segment: CutSegment, extra: Partial<CutGroup> = {}): CutGroup {
  return {
    kind: 'cut',
    layerId: 'L',
    color: '#000000',
    power: 50,
    speed: 1000,
    passes: 1,
    airAssist: false,
    segments: [segment],
    ...extra,
  };
}

const LEADS = {
  leadIn: true,
  leadOut: true,
  style: 'arc' as const,
  lengthMm: 1,
  angleDeg: 90,
  side: 'auto' as const,
  clearanceMm: 0.2,
  operationName: 'Cut',
};

describe('laser lead review follow-ups', () => {
  it('does not collapse a chain of near copies beyond the representative tolerance', () => {
    const inner = square(10, 10, 10);
    const job = {
      groups: [
        group(inner, { laserLeads: LEADS }),
        ...[0, 0.006, 0.012, 0.018].map((shift) =>
          group(square(shift, shift, 40), { laserLeads: LEADS }),
        ),
      ],
    };
    // Two outlines, so an even count: outside.
    expect(leadJobLines(job).sides[0]?.side).toBe('outside');
    const led = applyLaserLeads(job, { bed: null }).groups[0];
    expect(led?.kind).toBe('cut');
    if (led?.kind !== 'cut') throw new Error('expected cut');
    expect(led.segments[0]?.closed).toBe(false);
    expect(pointInPolygon(led.segments[0]?.polyline[0] as Vec2, inner.polyline)).toBe(false);
  });

  it.each([0, 0.001, 0.01, 0.1])('matches Ruida encoded burn at %s percent', (power) => {
    const device = { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'ruida' as const };
    expect(hasJobStartPower(group(square(0, 0, 40), { power }), device)).toBe(
      encodePower14(power).some((byte) => byte !== 0),
    );
  });

  it('counts an enclosing Ruida contour whose nonzero 14-bit power rounds to GRBL S0', () => {
    const inner = square(10, 10, 10);
    const led = applyLaserLeads(
      {
        groups: [
          group(inner, { laserLeads: LEADS }),
          group(square(0, 0, 40), { power: 0.01, laserLeads: LEADS }),
        ],
      },
      { bed: null, device: { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'ruida' } },
    ).groups[0];
    if (led?.kind !== 'cut') throw new Error('expected cut');
    expect(led.segments[0]?.closed).toBe(false);
    expect(pointInPolygon(led.segments[0]?.polyline[0] as Vec2, inner.polyline)).toBe(true);
  });
});
