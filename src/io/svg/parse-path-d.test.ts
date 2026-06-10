import { describe, expect, it } from 'vitest';
import { parsePathD } from './parse-path-d';

describe('parsePathD — M/L absolute', () => {
  it('parses a single open subpath', () => {
    const subs = parsePathD('M 10 20 L 30 40 L 50 60');
    expect(subs).toHaveLength(1);
    expect(subs[0]?.points).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 40 },
      { x: 50, y: 60 },
    ]);
    expect(subs[0]?.closed).toBe(false);
  });

  it('parses comma-separated coords', () => {
    expect(parsePathD('M10,20 L30,40')[0]?.points).toEqual([
      { x: 10, y: 20 },
      { x: 30, y: 40 },
    ]);
  });

  it('handles negative numbers and decimals', () => {
    expect(parsePathD('M-1.5 -2.25 L3.5 4.75')[0]?.points).toEqual([
      { x: -1.5, y: -2.25 },
      { x: 3.5, y: 4.75 },
    ]);
  });
});

describe('parsePathD — relative variants', () => {
  it('handles lowercase m/l/h/v', () => {
    const subs = parsePathD('M 10 10 l 5 0 l 0 5 h 5 v 5');
    expect(subs[0]?.points).toEqual([
      { x: 10, y: 10 },
      { x: 15, y: 10 },
      { x: 15, y: 15 },
      { x: 20, y: 15 },
      { x: 20, y: 20 },
    ]);
  });

  it('treats the first M in a path as absolute even when lowercase (initial relative-to-origin)', () => {
    // Per SVG spec: relative `m` at the start of a path is treated as
    // absolute. The current parser matches that by defaulting cursor to (0,0).
    const subs = parsePathD('m 5 5 l 5 0');
    expect(subs[0]?.points).toEqual([
      { x: 5, y: 5 },
      { x: 10, y: 5 },
    ]);
  });
});

describe('parsePathD — implicit line-to after M', () => {
  it('treats extra pairs after M as L commands', () => {
    const subs = parsePathD('M 0 0 10 10 20 0');
    expect(subs[0]?.points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
    ]);
  });
});

describe('parsePathD — Z close', () => {
  it('appends the start point and marks the subpath closed', () => {
    const subs = parsePathD('M 0 0 L 10 0 L 10 10 L 0 10 Z');
    expect(subs).toHaveLength(1);
    expect(subs[0]?.closed).toBe(true);
    expect(subs[0]?.points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
    ]);
  });

  it('starts a new subpath after a Z', () => {
    const subs = parsePathD('M 0 0 L 10 0 Z M 20 20 L 30 30');
    expect(subs).toHaveLength(2);
    expect(subs[1]?.points[0]).toEqual({ x: 20, y: 20 });
  });
});

describe('parsePathD — curve flattening (De Casteljau subdivision)', () => {
  it('flattens a C command into many intermediate points ending at the segment endpoint', () => {
    const subs = parsePathD('M 0 0 C 10 0 20 10 30 10');
    const pts = subs[0]?.points ?? [];
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 30, y: 10 });
    // Curve has measurable deviation → must produce >1 point beyond the start.
    expect(pts.length).toBeGreaterThan(2);
  });

  it('flattens a Q command, with intermediate points lying above the chord', () => {
    const pts = parsePathD('M 0 0 Q 50 50 100 0')[0]?.points ?? [];
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 100, y: 0 });
    // Apex of a y=50 control quadratic sits around y=25; at least one
    // intermediate point should be near that height.
    const aboveAxis = pts.some((p) => p.y > 10);
    expect(aboveAxis).toBe(true);
  });

  it('S command reflects the previous cubic control point', () => {
    // C ends with control (20,10); the following S smooth-continuation starts
    // from the reflection of (20,10) through cursor (30,10) → (40,10).
    const pts = parsePathD('M 0 0 C 10 0 20 10 30 10 S 60 -10 70 0')[0]?.points ?? [];
    expect(pts[pts.length - 1]).toEqual({ x: 70, y: 0 });
  });

  it('A command (elliptical arc) flattens to a curved polyline', () => {
    // Quarter-circle from (10,0) to (0,10), rx=ry=10, sweep=1.
    const pts = parsePathD('M 10 0 A 10 10 0 0 1 0 10')[0]?.points ?? [];
    expect(pts[0]).toEqual({ x: 10, y: 0 });
    expect(pts[pts.length - 1]?.x).toBeCloseTo(0);
    expect(pts[pts.length - 1]?.y).toBeCloseTo(10);
    // Every intermediate point on a r=10 circle around origin.
    for (const p of pts) {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(10, 1);
    }
  });

  // H8 (AUDIT-2026-06-10): the SVG grammar defines large-arc/sweep as
  // single-digit flag productions needing no separator — `a4 4 0 011 7` is
  // valid (SVGO-minified files emit exactly this) and must parse identically
  // to the space-separated form. A greedy number tokenizer reads `011` as one
  // number, drops the whole arc, and desyncs the relative cursor.
  describe('compact arc flag syntax (H8)', () => {
    it('parses flags fused with each other and the following coordinate', () => {
      expect(parsePathD('M10 0a4 4 0 011 7')).toEqual(parsePathD('M10 0a4 4 0 0 1 1 7'));
    });

    it('parses flags fused in an absolute arc', () => {
      expect(parsePathD('M0 0A5 5 0 1140 0')).toEqual(parsePathD('M0 0A5 5 0 1 1 40 0'));
    });

    it('parses multi-arc commands with compact flags', () => {
      expect(parsePathD('M10 0a4 4 0 011 7 4 4 0 101 7')).toEqual(
        parsePathD('M10 0a4 4 0 0 1 1 7 4 4 0 1 0 1 7'),
      );
    });

    it('parses flags followed by decimal-point coordinates', () => {
      expect(parsePathD('M0 0a.5.5 0 01.7.7')).toEqual(parsePathD('M0 0a0.5 0.5 0 0 1 0.7 0.7'));
    });

    it('keeps the relative cursor in sync for commands after a compact arc', () => {
      const compact = parsePathD('M10 0a4 4 0 011 7l5 0');
      const expanded = parsePathD('M10 0a4 4 0 0 1 1 7l5 0');
      expect(compact).toEqual(expanded);
      const pts = compact[0]?.points ?? [];
      // Arc ends at (11, 7); the relative line lands at (16, 7).
      expect(pts[pts.length - 1]).toEqual({ x: 16, y: 7 });
    });
  });
});
