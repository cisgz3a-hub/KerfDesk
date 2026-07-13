// Probing sequence builders (ADR-103 G2): exact line sequences, two-stage
// contact, thickness-compensated Z zero, bit-radius-compensated XY zeros,
// and per-corner sign symmetry.

import { describe, expect, it } from 'vitest';
import {
  buildCornerProbeLines,
  buildZProbeLines,
  DEFAULT_SIDE_CLEARANCE_MM,
  DEFAULT_SIDE_DROP_MM,
  DEFAULT_Z_PROBE_PARAMS,
  type CornerProbeParams,
} from './probe';

const CORNER: CornerProbeParams = {
  ...DEFAULT_Z_PROBE_PARAMS,
  bitDiameterMm: 6.35,
  corner: 'front-left',
  sideDropMm: DEFAULT_SIDE_DROP_MM,
  sideClearanceMm: DEFAULT_SIDE_CLEARANCE_MM,
};

describe('buildZProbeLines', () => {
  it('emits the two-stage cycle with thickness-compensated zero', () => {
    expect(buildZProbeLines(DEFAULT_Z_PROBE_PARAMS)).toEqual([
      'G54',
      'G21',
      'G91',
      'G38.2 Z-25.000 F150.000',
      'G0 Z2.000',
      'G38.2 Z-3.000 F25.000',
      'G10 L20 P0 Z15.000',
      'G0 Z5.000',
      'G90',
    ]);
  });

  it('slow re-touch runs strictly slower than the seek', () => {
    const lines = buildZProbeLines(DEFAULT_Z_PROBE_PARAMS);
    const probes = lines.filter((line) => line.startsWith('G38.2'));
    expect(probes).toHaveLength(2);
    // Seek first, slow re-touch second.
    expect(probes[0]).toContain('F150.000');
    expect(probes[1]).toContain('F25.000');
  });
});

describe('buildCornerProbeLines', () => {
  it('selects the canonical G54 WCS before any probe motion or coordinate commit', () => {
    expect(buildCornerProbeLines(CORNER)[0]).toBe('G54');
  });

  it('zeros X and Y one bit-radius outside the stock faces (front-left)', () => {
    const lines = buildCornerProbeLines(CORNER);
    expect(lines).toContain('G10 L20 P0 X-3.175');
    expect(lines).toContain('G10 L20 P0 Y-3.175');
    expect(lines).toContain('G10 L20 P0 Z15.000');
  });

  it('side probes descend to plate-flank height, not below the stock', () => {
    const lines = buildCornerProbeLines(CORNER);
    // thickness 15 − drop 6 = flank at work Z9, well above stock top (Z0).
    expect(lines.filter((line) => line === 'G0 Z9.000')).toHaveLength(2);
  });

  it('mirrors probe directions per corner and flips the zero signs', () => {
    const backRight = buildCornerProbeLines({ ...CORNER, corner: 'back-right' });
    expect(backRight).toContain('G10 L20 P0 X3.175');
    expect(backRight).toContain('G10 L20 P0 Y3.175');
    // Probes travel in −X / −Y toward the faces.
    expect(backRight.some((line) => line.startsWith('G38.2 X-40.000'))).toBe(true);
    expect(backRight.some((line) => line.startsWith('G38.2 Y-40.000'))).toBe(true);
  });

  it('every probe is followed by a back-off before the slow re-touch', () => {
    const lines = buildCornerProbeLines(CORNER);
    const probeIdx = lines
      .map((line, i) => (line.startsWith('G38.2') ? i : -1))
      .filter((i) => i >= 0);
    expect(probeIdx).toHaveLength(6);
    // Fast/slow pairs: after each fast probe the next motion backs off.
    for (let k = 0; k < probeIdx.length; k += 2) {
      const fast = probeIdx[k];
      if (fast === undefined) throw new Error('probe index missing');
      expect(lines[fast + 1]).toMatch(/^G0 [XYZ]-?\d/);
    }
  });

  it('ends parked just outside the corner in absolute mode', () => {
    const lines = buildCornerProbeLines(CORNER);
    expect(lines.at(-1)).toBe('G0 X-5.000 Y-5.000');
    // The last modal switch before the park is G90.
    const lastModal = [...lines].reverse().find((line) => line === 'G90' || line === 'G91');
    expect(lastModal).toBe('G90');
  });
});
