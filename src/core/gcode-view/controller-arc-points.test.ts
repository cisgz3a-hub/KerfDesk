import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { buildProgramTimeline } from '../gcode-time';
import { deviceProgramTimingOptions } from '../gcode-time/program-timing-options';
import {
  controllerArcBudgetSegments,
  controllerArcPoints,
  GRBL_DEFAULT_ARC_TOLERANCE_MM,
} from './controller-arc-points';

describe('controllerArcPoints (ADR-407)', () => {
  it('splits an arc into as many chords as mc_arc does', () => {
    const radius = 10;
    const sweep = Math.PI / 2;
    const tolerance = GRBL_DEFAULT_ARC_TOLERANCE_MM;
    const segments = Math.floor(
      (0.5 * sweep * radius) / Math.sqrt(tolerance * (2 * radius - tolerance)),
    );
    const points = controllerArcPoints({ x: 0, y: 0 }, radius, 0, sweep, tolerance);
    expect(points).toHaveLength(segments + 1);
    expect(segments).toBe(39);
    const [a, b] = points;
    if (a === undefined || b === undefined) throw new Error('expected points');
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    // mc_arc rounds the count down, so a chord can sag a little past $12.
    expect(radius - Math.hypot(midX, midY)).toBeLessThan(tolerance * 1.05);
  });

  it('keeps an arc too small to split as one chord', () => {
    expect(controllerArcPoints({ x: 0, y: 0 }, 0.05, 0, 0.1, 0.002)).toHaveLength(2);
  });

  it('times GRBL laser arcs through the controller interpolation', () => {
    const options = deviceProgramTimingOptions(DEFAULT_DEVICE_PROFILE, 'laser');
    expect(options.controllerArcToleranceMm).toBe(GRBL_DEFAULT_ARC_TOLERANCE_MM);
    expect(deviceProgramTimingOptions(DEFAULT_DEVICE_PROFILE, 'cnc').controllerArcToleranceMm).toBe(
      undefined,
    );
    const program = ['G21', 'G90', 'M4 S0', 'G0 X10 Y0 S0', 'G3 X0 Y10 I-10 J0 F3000 S500', 'M5'];
    const limits = { accelMmPerSec2: 500, junctionDeviationMm: 0.01, maxFeedMmPerMin: 6000 };
    const timed = buildProgramTimeline(program.join('\n'), limits, options);
    if (timed.kind !== 'ok') throw new Error('expected a timeline');
    expect(timed.timeline.totalRouteMm).toBeCloseTo(10 + (Math.PI * 10) / 2, 3);
    expect(timed.timeline.segmentDistanceMm.length).toBeGreaterThanOrEqual(1 + 39);
  });

  it('keeps a program that fits the countdown budget as G1 inside it as arcs', () => {
    const options = deviceProgramTimingOptions(DEFAULT_DEVICE_PROFILE, 'laser');
    const limits = { accelMmPerSec2: 1000, junctionDeviationMm: 0.01, maxFeedMmPerMin: 6000 };
    const g1 = ['G21', 'G90', 'M4 S0'];
    const arcs = ['G21', 'G90', 'G17', 'M4 S0'];
    const fmt = (value: number): string => value.toFixed(3);
    for (let disc = 0; disc < 16; disc += 1) {
      const radius = 5 + disc * 2.5;
      const cx = 100;
      const cy = 100 + disc * 0.25;
      g1.push(`G0 X${fmt(cx + radius)} Y${fmt(cy)} S0`);
      arcs.push(`G0 X${fmt(cx + radius)} Y${fmt(cy)} S0`);
      for (let quarter = 0; quarter < 4; quarter += 1) {
        const a0 = (quarter * Math.PI) / 2;
        const chords = controllerArcBudgetSegments(radius, Math.PI / 2);
        for (let step = 1; step <= chords; step += 1) {
          const angle = a0 + ((Math.PI / 2) * step) / chords;
          const x = cx + radius * Math.cos(angle);
          const y = cy + radius * Math.sin(angle);
          g1.push(`G1 X${fmt(x)} Y${fmt(y)} F6000 S500`);
        }
        const from = { x: cx + radius * Math.cos(a0), y: cy + radius * Math.sin(a0) };
        const to = {
          x: cx + radius * Math.cos(a0 + Math.PI / 2),
          y: cy + radius * Math.sin(a0 + Math.PI / 2),
        };
        arcs.push(
          `G3 X${fmt(to.x)} Y${fmt(to.y)} I${fmt(cx - from.x)} J${fmt(cy - from.y)} F6000 S500`,
        );
      }
    }
    const unbounded = buildProgramTimeline(g1.join('\n'), limits, options);
    if (unbounded.kind !== 'ok') throw new Error('expected a G1 timeline');
    const budget = unbounded.timeline.segmentDistanceMm.length;
    const arcTimed = buildProgramTimeline(arcs.join('\n'), limits, options);
    if (arcTimed.kind !== 'ok') throw new Error('expected an arc timeline');
    // mc_arc's chords outnumber the G1 chords the arcs replace...
    expect(arcTimed.timeline.segmentDistanceMm.length).toBeGreaterThan(budget * 2);
    // ...but the arcs count against the budget as those G1 chords.
    expect(
      buildProgramTimeline(arcs.join('\n'), limits, { ...options, maxSegments: budget }).kind,
    ).toBe('ok');
    expect(
      buildProgramTimeline(arcs.join('\n'), limits, { ...options, maxSegments: budget / 2 }).kind,
    ).toBe('unavailable');
  });
});
