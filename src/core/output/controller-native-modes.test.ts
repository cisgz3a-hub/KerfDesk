import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { buildGcodeRenderModel, type GcodeRenderModel } from '../gcode-view';
import { buildProgramTime } from '../gcode-time';
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

const FILL_TO_CUT_JOB: Job = {
  groups: [
    {
      kind: 'fill',
      layerId: 'fill',
      color: '#ff0000',
      power: 50,
      powerMode: 'dynamic',
      speed: 6000,
      passes: 1,
      airAssist: false,
      overscanMm: 1,
      segments: [
        {
          polyline: [
            { x: 10, y: 10 },
            { x: 20, y: 10 },
          ],
          closed: false,
          reverse: false,
        },
      ],
    },
    {
      kind: 'cut',
      layerId: 'cut',
      color: '#ff0000',
      power: 50,
      powerMode: 'constant',
      speed: 6000,
      passes: 1,
      airAssist: false,
      segments: [
        {
          polyline: [
            { x: 22, y: 10 },
            { x: 30, y: 10 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

function renderModel(gcode: string): GcodeRenderModel {
  const parsed = buildGcodeRenderModel(gcode, { machineKind: 'laser' });
  if (parsed.kind !== 'ok') throw new Error(parsed.reason);
  expect(parsed.model.unsupportedWords).toEqual([]);
  return parsed.model;
}

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
        // Every native entry follows a drain that applies PWM zero before ACK.
        expect(mode).toBe('standard');
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

  // OR-1: the GRBL body no longer re-arms between passes, so the derived
  // per-pass pairs are gone too. Marlin's `M5 I` synchronizes before it zeroes
  // continuous inline power (M3-M5.cpp M5()), so that pair stopped the head
  // with the last pass's power still applied.
  it('writes no per-pass re-entry into a multi-pass Marlin inline or Smoothie layer', () => {
    const twoPass: Job = { groups: [vector('dynamic', 2)] };
    const marlin = marlinStrategy
      .emit(twoPass, {
        ...DEFAULT_DEVICE_PROFILE,
        controllerKind: 'marlin',
        maxPowerS: 255,
        gcodeDialect: { dialectId: 'marlin-inline' },
      })
      .split('\n');
    expect(marlin.filter((line) => line === 'M3 I S0')).toHaveLength(1);
    expect(marlin.filter((line) => line === 'M5 I')).toEqual(['M5 I', 'M5 I']);
    expect(
      marlin.slice(marlin.indexOf('; pass 2 of 2'), marlin.indexOf('; pass 2 of 2') + 2),
    ).toEqual(['; pass 2 of 2', 'G0 X10.000 Y10.000 S0']);
    const smoothie = smoothiewareStrategy
      .emit(twoPass, { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'smoothieware', maxPowerS: 1 })
      .split('\n');
    expect(smoothie.filter((line) => line.startsWith('M221 S100'))).toEqual(['M221 S100 P0']);
  });

  it('drains and turns off before repeated Marlin inline entry after S0', () => {
    const output = marlinStrategy.emit(FILL_TO_CUT_JOB, {
      ...DEFAULT_DEVICE_PROFILE,
      controllerKind: 'marlin',
      maxPowerS: 255,
      gcodeDialect: { dialectId: 'marlin-inline' },
    });
    const lines = output.trim().split('\n');
    const leadOutLine = lines.indexOf('G0 X21.000 Y10.000 S0');
    const approachLine = lines.indexOf('G0 X22.000 Y10.000 S0');
    expect(leadOutLine).toBeGreaterThan(0);
    expect(approachLine).toBeGreaterThan(leadOutLine);
    expect(lines.slice(leadOutLine, leadOutLine + 3)).toEqual([
      'G0 X21.000 Y10.000 S0',
      'M5 I',
      'M3 I S0',
    ]);
    const model = renderModel(output);
    expect(model.events).toContainEqual({
      kind: 'synchronization',
      line: leadOutLine + 1,
      code: 'spindle',
      isBeforeMotion: true,
    });
    // Explicit off/on events establish the stop for both LASER_POWER_SYNC
    // builds, even though the previous motion already commanded S0.
    expect(model.events).toContainEqual({
      kind: 'synchronization',
      line: leadOutLine + 2,
      code: 'spindle',
      isBeforeMotion: true,
    });
    const limits = { accelMmPerSec2: 500, junctionDeviationMm: 0.01, maxFeedMmPerMin: 6000 };
    const timed = buildProgramTime(model, limits);
    const leadOut = [...model.segLine].indexOf(leadOutLine);
    const approach = [...model.segLine].indexOf(approachLine);
    expect(leadOut).toBeGreaterThanOrEqual(0);
    expect(approach).toBe(leadOut + 1);
    expect(timed.segExitVelocityMmPerSec[leadOut]).toBe(0);
    expect(timed.segEntryVelocityMmPerSec[approach]).toBe(0);
    const withoutTeardown = buildProgramTime(
      renderModel(output.replace(/^M5 I\n(?=M3 I S0)/gm, '')),
      limits,
    );
    expect(withoutTeardown.segExitVelocityMmPerSec[leadOut]).toBeGreaterThan(0);
    expect(withoutTeardown.segEntryVelocityMmPerSec[approach]).toBeGreaterThan(0);
    expect(timed.totalSeconds).toBeGreaterThan(withoutTeardown.totalSeconds);
  });
});
