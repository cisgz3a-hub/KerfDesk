import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { findPlungedTravelIssues } from '../invariants';
import type { CncGroup } from '../job';
import { cncGrblStrategy, emitCncJobWithPassSpans } from './cnc-grbl-strategy';

function group(passes: CncGroup['passes']): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'L1',
    color: '#ff0000',
    cutType: 'profile-on-path',
    toolDiameterMm: 3.175,
    feedMmPerMin: 1000,
    plungeMmPerMin: 300,
    spindleRpm: 12000,
    spindleSpinupSec: 3,
    safeZMm: 3.81,
    passes,
  };
}

describe('cncGrblStrategy fine-contour emission', () => {
  it('preserves real motion with a bounded fourth decimal instead of omitting it', () => {
    const gcode = cncGrblStrategy.emit(
      {
        groups: [
          group([
            {
              kind: 'contour',
              zMm: -2,
              polyline: [
                { x: 10, y: 20 },
                { x: 10.0004, y: 20.0004 },
                { x: 10, y: 20 },
              ],
              closed: true,
            },
          ]),
        ],
      },
      DEFAULT_DEVICE_PROFILE,
    );

    const plungeIndex = gcode.indexOf('G1 Z-2.000 F300');
    const fineCutIndex = gcode.indexOf('G1 X10.0004 Y20.0004 F1000');
    expect(gcode).toContain('G0 X10.0000 Y20.0000');
    expect(plungeIndex).toBeGreaterThan(-1);
    expect(fineCutIndex).toBeGreaterThan(plungeIndex);
    expect(gcode).toContain('G1 X10.0000 Y20.0000');
    expect(findPlungedTravelIssues(gcode, { safeZMm: 3.81 })).toEqual([]);
  });

  it('preserves five-decimal motion that fits the controller parser budget', () => {
    const gcode = cncGrblStrategy.emit(
      {
        groups: [
          group([
            {
              kind: 'contour',
              zMm: -2,
              polyline: [
                { x: 10, y: 20 },
                { x: 10.00004, y: 20.00004 },
                { x: 10, y: 20 },
              ],
              closed: true,
            },
          ]),
        ],
      },
      DEFAULT_DEVICE_PROFILE,
    );

    expect(gcode).toContain('G0 X10.00000 Y20.00000');
    expect(gcode).toContain('G1 X10.00004 Y20.00004 F1000');
    expect(gcode).toContain('G1 X10.00000 Y20.00000');
  });

  it('raises the whole pass precision instead of dropping a later fine segment', () => {
    const gcode = cncGrblStrategy.emit(
      {
        groups: [
          group([
            {
              kind: 'contour',
              zMm: -2,
              polyline: [
                { x: 10, y: 20 },
                { x: 10.0004, y: 20 },
                { x: 10.00044, y: 20.00004 },
              ],
              closed: false,
            },
          ]),
        ],
      },
      DEFAULT_DEVICE_PROFILE,
    );

    expect(gcode).toContain('G0 X10.00000 Y20.00000');
    expect(gcode).toContain('G1 X10.00040 Y20.00000 F1000');
    expect(gcode).toContain('G1 X10.00044 Y20.00004');
  });

  it('emits rounded ninth-decimal prefixes that GRBL parses distinctly', () => {
    const gcode = cncGrblStrategy.emit(
      {
        groups: [
          group([
            {
              kind: 'contour',
              zMm: -2,
              polyline: [
                { x: 0.1234567994, y: 0 },
                { x: 0.1234567996, y: 0 },
              ],
              closed: false,
            },
          ]),
        ],
      },
      DEFAULT_DEVICE_PROFILE,
    );

    expect(gcode).toContain('G0 X.12345679 Y.00000000');
    expect(gcode).toContain('G1 X.12345680 Y.00000000 F1000');
  });

  it('preserves fine motion on one axis when a constant large axis gives back decimals', () => {
    const gcode = cncGrblStrategy.emit(
      {
        groups: [
          group([
            {
              kind: 'contour',
              zMm: -2,
              polyline: [
                { x: 10_000, y: 20 },
                { x: 10_000, y: 20.00004 },
                { x: 10_000, y: 20 },
              ],
              closed: true,
            },
          ]),
        ],
      },
      DEFAULT_DEVICE_PROFILE,
    );

    expect(gcode).toContain('G0 X10000.000 Y20.00000');
    expect(gcode).toContain('G1 X10000.000 Y20.00004 F1000');
    expect(gcode).toContain('G1 X10000.000 Y20.00000');
  });

  it('emits a leading-dot eighth decimal when that is the parser-valid representation', () => {
    const gcode = cncGrblStrategy.emit(
      {
        groups: [
          group([
            {
              kind: 'contour',
              zMm: -2,
              polyline: [
                { x: 0, y: 0 },
                { x: 0.00000004, y: 0 },
              ],
              closed: false,
            },
          ]),
        ],
      },
      DEFAULT_DEVICE_PROFILE,
    );

    expect(gcode).toContain('G0 X.00000000 Y.00000000');
    expect(gcode).toContain('G1 X.00000004 Y.00000000 F1000');
  });

  it('raises precision so signed fine motion does not become parser-stationary', () => {
    const gcode = cncGrblStrategy.emit(
      {
        groups: [
          group([
            {
              kind: 'contour',
              zMm: -2,
              polyline: [
                { x: -0.00001, y: 0 },
                { x: 0.00001, y: 0 },
                { x: 1, y: 0 },
              ],
              closed: false,
            },
          ]),
        ],
      },
      DEFAULT_DEVICE_PROFILE,
    );

    expect(gcode).toContain('G0 X-0.00001 Y0.00000');
    expect(gcode).toContain('G1 X0.00001 Y0.00000 F1000');
    expect(gcode).toContain('G1 X1.00000 Y0.00000');
  });

  it('emits lateral motion through the exact parser-prefix fallback', () => {
    const gcode = cncGrblStrategy.emit(
      {
        groups: [
          group([
            {
              kind: 'contour',
              zMm: -2,
              polyline: [
                { x: 10.1234556, y: 20 },
                { x: 10.1234564, y: 20 },
              ],
              closed: false,
            },
          ]),
        ],
      },
      DEFAULT_DEVICE_PROFILE,
    );

    const plungeIndex = gcode.indexOf('G1 Z-2.000 F300');
    expect(gcode).toContain('G0 X10.123455 Y20.000000');
    expect(gcode.indexOf('G1 X10.123456 Y20.000000 F1000')).toBeGreaterThan(plungeIndex);
  });

  it('preserves fine and ordinary contours together without hiding either pass', () => {
    const gcode = cncGrblStrategy.emit(
      {
        groups: [
          group([
            {
              kind: 'contour',
              zMm: -1,
              polyline: [
                { x: 10, y: 20 },
                { x: 10.0004, y: 20.0004 },
                { x: 10, y: 20 },
              ],
              closed: true,
            },
            {
              kind: 'contour',
              zMm: -2,
              polyline: [
                { x: 40, y: 40 },
                { x: 60, y: 40 },
                { x: 40, y: 40 },
              ],
              closed: true,
            },
          ]),
        ],
      },
      DEFAULT_DEVICE_PROFILE,
    );

    expect(gcode).toContain('G1 X10.0004 Y20.0004 F1000');
    expect(gcode).toContain('G0 X40.000 Y40.000');
    expect(gcode).toContain('G1 X60.000 Y40.000 F1000');
    expect(findPlungedTravelIssues(gcode, { safeZMm: 3.81 })).toEqual([]);
  });

  it('records fine passes and keeps same-XY depth chaining', () => {
    const finePolyline = [
      { x: 10, y: 20 },
      { x: 10.0004, y: 20.0004 },
      { x: 10, y: 20 },
    ];
    const emitted = emitCncJobWithPassSpans(
      {
        groups: [
          group([
            { kind: 'contour', zMm: -1, polyline: finePolyline, closed: true },
            { kind: 'contour', zMm: -2, polyline: finePolyline, closed: true },
          ]),
        ],
      },
      DEFAULT_DEVICE_PROFILE,
    );

    expect(emitted.gcode).toContain(
      'G1 X10.0000 Y20.0000\nG1 Z-2.000 F300\nG1 X10.0004 Y20.0004 F1000',
    );
    expect(emitted.spans).toHaveLength(2);
    expect(emitted.spans.map((span) => span.passIndex)).toEqual([0, 1]);
  });

  it('repositions when the selected contour word precision changes', () => {
    const gcode = cncGrblStrategy.emit(
      {
        groups: [
          group([
            {
              kind: 'contour',
              zMm: -1,
              polyline: [
                { x: 0, y: 0 },
                { x: 10, y: 20 },
              ],
              closed: false,
            },
            {
              kind: 'contour',
              zMm: -2,
              polyline: [
                { x: 10, y: 20 },
                { x: 10.0004, y: 20.0004 },
                { x: 10, y: 20 },
              ],
              closed: true,
            },
          ]),
        ],
      },
      DEFAULT_DEVICE_PROFILE,
    );

    expect(gcode).toContain('G1 X10.000 Y20.000 F1000');
    expect(gcode).toContain('G0 X10.0000 Y20.0000\nG1 Z-2.000 F300');
    expect(gcode).toContain('G1 X10.0004 Y20.0004 F1000');
  });

  it('also repositions from detail text into an ordinary three-decimal pass', () => {
    const gcode = cncGrblStrategy.emit(
      {
        groups: [
          group([
            {
              kind: 'contour',
              zMm: -1,
              polyline: [
                { x: 10, y: 20 },
                { x: 10.0004, y: 20.0004 },
                { x: 10, y: 20 },
              ],
              closed: true,
            },
            {
              kind: 'contour',
              zMm: -2,
              polyline: [
                { x: 10, y: 20 },
                { x: 30, y: 20 },
              ],
              closed: false,
            },
          ]),
        ],
      },
      DEFAULT_DEVICE_PROFILE,
    );

    expect(gcode).toContain('G1 X10.0000 Y20.0000');
    expect(gcode).toContain('G0 X10.000 Y20.000\nG1 Z-2.000 F300');
    expect(gcode).toContain('G1 X30.000 Y20.000 F1000');
  });
});
