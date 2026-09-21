import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
// Deep import: the devices barrel is at its public-export ratchet, and the
// catalog itself reaches the profiles this way too.
import {
  FALCON_A1_PRO_GRBLHAL_PROFILE,
  FALCON_COMPATIBLE_PROFILE,
} from '../devices/falcon-profiles';
import type { Job } from '../job';
import { grblStrategy } from './grbl-strategy';

describe('grblStrategy air assist coolant emission', () => {
  it('does not emit coolant commands when device air assist is disabled', () => {
    const gcode = grblStrategy.emit(
      {
        groups: [
          {
            kind: 'cut',
            layerId: 'L1',
            color: '#000000',
            power: 30,
            speed: 1000,
            passes: 1,
            airAssist: true,
            segments: [
              {
                closed: false,
                polyline: [
                  { x: 1, y: 1 },
                  { x: 5, y: 1 },
                ],
              },
            ],
          },
        ],
      },
      { ...DEFAULT_DEVICE_PROFILE, airAssistCommand: 'none' },
    );

    expect(gcode).not.toMatch(/^M[789]$/m);
  });

  it('turns M8 on before line motion and M9 off before the park move', () => {
    const gcode = grblStrategy.emit(
      {
        groups: [
          {
            kind: 'cut',
            layerId: 'L1',
            color: '#000000',
            power: 30,
            speed: 1000,
            passes: 1,
            airAssist: true,
            segments: [
              {
                closed: false,
                polyline: [
                  { x: 1, y: 1 },
                  { x: 5, y: 1 },
                ],
              },
            ],
          },
        ],
      },
      { ...DEFAULT_DEVICE_PROFILE, airAssistCommand: 'M8' },
    );

    expect(gcode).toContain('\nM8\n');
    expect(gcode).toContain('\nM9\n');
    expect(gcode.indexOf('\nM8\n')).toBeLessThan(gcode.indexOf('\nG0 X1.000'));
    expect(gcode.lastIndexOf('\nM9\n')).toBeLessThan(gcode.lastIndexOf('\nG0 X0.000 Y0.000 S0'));
  });

  it('turns air off before a following non-air group moves', () => {
    const gcode = grblStrategy.emit(
      {
        groups: [
          {
            kind: 'cut',
            layerId: 'air',
            color: '#000000',
            power: 30,
            speed: 1000,
            passes: 1,
            airAssist: true,
            segments: [
              {
                closed: false,
                polyline: [
                  { x: 1, y: 1 },
                  { x: 5, y: 1 },
                ],
              },
            ],
          },
          {
            kind: 'cut',
            layerId: 'dry',
            color: '#ff0000',
            power: 30,
            speed: 1000,
            passes: 1,
            airAssist: false,
            segments: [
              {
                closed: false,
                polyline: [
                  { x: 10, y: 1 },
                  { x: 15, y: 1 },
                ],
              },
            ],
          },
        ],
      },
      { ...DEFAULT_DEVICE_PROFILE, airAssistCommand: 'M8' },
    );

    expect(gcode).toContain('\nM9\n');
    expect(gcode.indexOf('\nM9\n')).toBeLessThan(gcode.indexOf('\n; layer dry'));
  });

  it('keeps M8 on through a raster group and emits M9 after raster M5', () => {
    const gcode = grblStrategy.emit(
      {
        groups: [
          {
            kind: 'raster',
            layerId: 'image',
            color: '#808080',
            power: 50,
            speed: 1000,
            passes: 1,
            airAssist: true,
            sValues: new Uint16Array([500]),
            pixelWidth: 1,
            pixelHeight: 1,
            bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
            overscanMm: 0,
            dotWidthCorrectionMm: 0,
          },
        ],
      },
      { ...DEFAULT_DEVICE_PROFILE, airAssistCommand: 'M8' },
    );

    // Anchored on the raster body, not on '\nM4 S0\n': since ADR-257 the preamble
    // itself arms M4, so the first M4 in the file precedes the coolant line and is
    // not the raster's own arm. The invariant under test is "air on before burning".
    expect(gcode.indexOf('\nM8\n')).toBeLessThan(gcode.indexOf('; image layer'));
    expect(gcode.lastIndexOf('\nM9\n')).toBeGreaterThan(gcode.lastIndexOf('\nM5\n'));
  });
});

// Mid-program air cycling on firmware that cannot restart the pump (ADR-335).
//
// The pattern under test is Air-on, Air-off, Air-on. Plain cycling emits
// `M8 a M9 b M8 c M9`, and that middle M9/M8 pair is what a Creality A1 fails
// to honour: `$152` keeps the pump in standby after the M9 and the restart is
// the step users report losing. Everything else about the emitted program is
// unchanged, and every other controller family keeps the cycling.

function cutGroup(layerId: string, airAssist: boolean, x: number): Job['groups'][number] {
  return {
    kind: 'cut',
    layerId,
    color: '#000000',
    power: 30,
    speed: 1000,
    passes: 1,
    airAssist,
    segments: [
      {
        closed: false,
        polyline: [
          { x, y: 1 },
          { x: x + 4, y: 1 },
        ],
      },
    ],
  };
}

function sandwichJob(): Job {
  return {
    groups: [cutGroup('wet-a', true, 1), cutGroup('dry-b', false, 10), cutGroup('wet-c', true, 20)],
  };
}

function coolantLines(gcode: string): ReadonlyArray<string> {
  return gcode.split('\n').filter((line) => line === 'M7' || line === 'M8' || line === 'M9');
}

describe('grblStrategy mid-program air cycling (ADR-335)', () => {
  it('cycles M9 then M8 over an Air-off operation by default', () => {
    const gcode = grblStrategy.emit(sandwichJob(), {
      ...DEFAULT_DEVICE_PROFILE,
      airAssistCommand: 'M8',
    });

    // The behaviour every other controller family honours, kept deliberately.
    expect(coolantLines(gcode)).toEqual(['M8', 'M9', 'M8', 'M9']);
    expect(gcode.indexOf('\nM9\n')).toBeLessThan(gcode.indexOf('; layer dry-b'));
  });

  it('holds air on across the Air-off operation when the restart is unreliable', () => {
    const gcode = grblStrategy.emit(sandwichJob(), {
      ...DEFAULT_DEVICE_PROFILE,
      airAssistCommand: 'M8',
      airAssistRestartUnreliable: true,
    });

    expect(coolantLines(gcode)).toEqual(['M8', 'M9']);
    // Air is on before the first burn and off only after the last one.
    expect(gcode.indexOf('\nM8\n')).toBeLessThan(gcode.indexOf('; layer wet-a'));
    expect(gcode.lastIndexOf('\nM9\n')).toBeGreaterThan(gcode.lastIndexOf('; layer wet-c'));
  });

  it('still never pre-arms the pump before the first operation that wants air', () => {
    const gcode = grblStrategy.emit(
      { groups: [cutGroup('dry-a', false, 1), cutGroup('wet-b', true, 10)] },
      { ...DEFAULT_DEVICE_PROFILE, airAssistCommand: 'M8', airAssistRestartUnreliable: true },
    );

    expect(coolantLines(gcode)).toEqual(['M8', 'M9']);
    expect(gcode.indexOf('\nM8\n')).toBeGreaterThan(gcode.indexOf('; layer dry-a'));
  });

  it('still turns air off at the last operation that wanted it, not at program end', () => {
    const gcode = grblStrategy.emit(
      { groups: [cutGroup('wet-a', true, 1), cutGroup('dry-b', false, 10)] },
      { ...DEFAULT_DEVICE_PROFILE, airAssistCommand: 'M8', airAssistRestartUnreliable: true },
    );

    expect(coolantLines(gcode)).toEqual(['M8', 'M9']);
    expect(gcode.indexOf('\nM9\n')).toBeLessThan(gcode.indexOf('; layer dry-b'));
  });

  it('bridges every gap, not only the first', () => {
    const gcode = grblStrategy.emit(
      {
        groups: [
          cutGroup('wet-a', true, 1),
          cutGroup('dry-b', false, 10),
          cutGroup('wet-c', true, 20),
          cutGroup('dry-d', false, 30),
          cutGroup('wet-e', true, 40),
        ],
      },
      { ...DEFAULT_DEVICE_PROFILE, airAssistCommand: 'M8', airAssistRestartUnreliable: true },
    );

    expect(coolantLines(gcode)).toEqual(['M8', 'M9']);
  });

  it('leaves a job with no air at all untouched', () => {
    const gcode = grblStrategy.emit(
      { groups: [cutGroup('dry-a', false, 1), cutGroup('dry-b', false, 10)] },
      { ...DEFAULT_DEVICE_PROFILE, airAssistCommand: 'M8', airAssistRestartUnreliable: true },
    );

    expect(coolantLines(gcode)).toEqual([]);
  });

  it('applies to the shipped Falcon A1 Pro profile', () => {
    const gcode = grblStrategy.emit(sandwichJob(), FALCON_A1_PRO_GRBLHAL_PROFILE);

    expect(FALCON_A1_PRO_GRBLHAL_PROFILE.airAssistRestartUnreliable).toBe(true);
    expect(coolantLines(gcode)).toEqual(['M8', 'M9']);
  });

  it('leaves the Falcon-compatible GRBL profile cycling, since stock GRBL restarts fine', () => {
    const gcode = grblStrategy.emit(sandwichJob(), {
      ...FALCON_COMPATIBLE_PROFILE,
      airAssistCommand: 'M8',
    });

    expect(FALCON_COMPATIBLE_PROFILE.airAssistRestartUnreliable).toBeUndefined();
    expect(coolantLines(gcode)).toEqual(['M8', 'M9', 'M8', 'M9']);
  });
});
