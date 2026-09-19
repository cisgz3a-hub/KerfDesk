import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { Group, Job } from '../job';
import { marlinStrategy } from './marlin-strategy';
import { smoothiewareStrategy } from './smoothieware-strategy';

function vector(mode: 'constant' | 'dynamic', passes = 1): Group {
  return {
    kind: 'cut',
    layerId: mode,
    color: '#ff0000',
    power: 50,
    speed: 1500,
    passes,
    powerMode: mode,
    airAssist: false,
    segments: [
      {
        polyline: [
          { x: 10, y: 10 },
          { x: 20, y: 20 },
        ],
        closed: false,
      },
    ],
  };
}

const JOB: Job = {
  groups: [
    vector('constant', 2),
    {
      kind: 'raster',
      layerId: 'image',
      color: '#808080',
      power: 100,
      speed: 1500,
      passes: 1,
      airAssist: false,
      sValues: Float64Array.of(1),
      pixelWidth: 1,
      pixelHeight: 1,
      bounds: { minX: 10, minY: 10, maxX: 11, maxY: 11 },
      overscanMm: 0,
      dotWidthCorrectionMm: 0,
    },
    vector('dynamic'),
  ],
};

function sValue(line: string, fallback: number): number {
  const value = /\bS([\d.]+)/.exec(line)?.[1];
  return value === undefined ? fallback : Number(value);
}

describe('native controller power modes', () => {
  it('Smoothie maps layer modes to M221 and settles before every immediate override', () => {
    const out = smoothiewareStrategy
      .emit(JOB, {
        ...DEFAULT_DEVICE_PROFILE,
        controllerKind: 'smoothieware',
        maxPowerS: 1,
      })
      .trim()
      .split('\n');
    expect(out).not.toEqual(expect.arrayContaining(['M3 S0', 'M4 S0', 'M5']));
    expect(out).toContain('M221 S100 P1');
    expect(out).toContain('M221 S100 P0');
    out.forEach((line, i) => {
      if (line.startsWith('M221')) expect(out[i - 1]).toBe('M400');
    });
    // Reset the percent override at each group re-arm; never emit S0.100 here.
    expect(
      out.filter((line) => /^M221 .*P/.test(line)).every((line) => line.includes('S100')),
    ).toBe(true);
    expect(out.slice(-3)).toEqual(['M400', 'M221 S0', 'G0 X0.000 Y0.000 S0']);
  });

  it('Marlin re-arms continuous inline power after raster and exits stale modes', () => {
    const out = marlinStrategy
      .emit(JOB, {
        ...DEFAULT_DEVICE_PROFILE,
        controllerKind: 'marlin',
        maxPowerS: 1,
        gcodeDialect: { dialectId: 'marlin-inline' },
      })
      .trim()
      .split('\n');
    // Independently model the relevant Marlin 2.1.2.6 M3/M4/M5 dispatch:
    // I selects a mode, M5 I leaves it, and G1 S only controls continuous power.
    let mode: 'standard' | 'continuous' | 'dynamic' = 'dynamic';
    let power = 999;
    const burns: number[] = [];
    for (const line of out) {
      if (/^M5\b/.test(line)) {
        power = 0;
        if (/\bI\b/.test(line)) mode = 'standard';
      } else if (/^M[34]\b/.test(line)) {
        if (/\bI\b/.test(line)) mode = line.startsWith('M3') ? 'continuous' : 'dynamic';
        power = sValue(line, power);
      } else if (/^G0\b/.test(line)) power = 0;
      else if (/^G1\b/.test(line)) {
        expect(mode).toBe('continuous');
        power = sValue(line, power);
        if (power > 0) burns.push(power);
      }
    }
    expect(burns.length).toBeGreaterThanOrEqual(4);
    expect(mode).toBe('standard');
    expect(power).toBe(0);
    expect(out[0]).toBe('M5 I');
    expect(out.some((line) => /^M4\b/.test(line))).toBe(false);
    expect(out.slice(-2)).toEqual(['M5 I', 'G0 X0.000 Y0.000 S0']);
  });
});
