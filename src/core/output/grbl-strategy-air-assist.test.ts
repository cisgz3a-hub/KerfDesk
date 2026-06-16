import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
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

    expect(gcode.indexOf('\nM8\n')).toBeLessThan(gcode.indexOf('\nM4 S0\n'));
    expect(gcode.lastIndexOf('\nM9\n')).toBeGreaterThan(gcode.lastIndexOf('\nM5\n'));
  });
});
