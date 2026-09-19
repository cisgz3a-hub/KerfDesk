import { describe, expect, it } from 'vitest';
import { INTENTIONAL_LASER_OFF_MOTION_COMMENT } from '../gcode-comments';
import { buildGcodeRenderModel } from './gcode-render-model';
import {
  SEG_KIND,
  SEG_MOTION,
  type BuildRenderModelOptions,
  type GcodeRenderModel,
} from './render-model-types';

function model(text: string, options: BuildRenderModelOptions = {}): GcodeRenderModel {
  const result = buildGcodeRenderModel(text, options);
  if (result.kind !== 'ok') throw new Error(result.reason);
  return result.model;
}

describe('laser feed travel classification', () => {
  it.each(['M3', 'M4'])(
    'uses modal power and %s enable state without changing feed motion',
    (arm) => {
      const parsed = model(
        [
          `${arm} S0`,
          'G1 X3 F1500',
          'X23 S300',
          'X26 S0',
          'X30',
          'S200',
          'X31',
          'M5',
          'X34',
          `${arm}`,
          'X35',
        ].join('\n'),
        { machineKind: 'laser' },
      );
      expect([...parsed.segKind]).toEqual([
        SEG_KIND.travel,
        SEG_KIND.cut,
        SEG_KIND.travel,
        SEG_KIND.travel,
        SEG_KIND.cut,
        SEG_KIND.travel,
        SEG_KIND.cut,
      ]);
      expect([...parsed.segMotion]).toEqual(Array(7).fill(SEG_MOTION.linear));
      expect([...parsed.segFeed]).toEqual(Array(7).fill(1500));
      expect([...parsed.segPower]).toEqual([0, 300, 0, 0, 200, 200, 200]);
      expect(parsed.stats.cutMm).toBe(22);
      expect(parsed.stats.travelMm).toBe(13);
    },
  );

  it('does not infer an enabled laser from S alone or a rapid at nonzero S', () => {
    const parsed = model('G1 X3 S300 F1500\nM3\nG0 X4\nG1 X5', { machineKind: 'laser' });
    expect([...parsed.segKind]).toEqual([SEG_KIND.travel, SEG_KIND.travel, SEG_KIND.cut]);
  });

  it('applies the completed block modal state regardless of S/M word order', () => {
    const parsed = model('G1 X3 S300 M4 F1500\nX6 M5 S200\nX9 S0 M3\nX12 S100', {
      machineKind: 'laser',
    });
    expect([...parsed.segKind]).toEqual([
      SEG_KIND.cut,
      SEG_KIND.travel,
      SEG_KIND.travel,
      SEG_KIND.cut,
    ]);
  });

  it('classifies laser-off arcs as travel while keeping arc length and motion type', () => {
    const parsed = model('G0 X10\nM4 S0\nG3 X0 Y10 I-10 J0 F600\nG3 X-10 Y0 I0 J-10 S300', {
      machineKind: 'laser',
    });
    expect(parsed.stats.cutMm).toBeCloseTo(5 * Math.PI, 4);
    expect(parsed.stats.travelMm).toBeCloseTo(10 + 5 * Math.PI, 4);
    const arcs = [...parsed.segMotion].slice(1);
    expect(arcs.every((motion) => motion === SEG_MOTION.ccw)).toBe(true);
  });

  it('counts the audited 318 pairs of 3 mm S0 runways as 1908 mm of feed travel', () => {
    const lines = ['G21 G90', 'M4 S0'];
    for (let pass = 0; pass < 3; pass += 1) {
      for (let row = 0; row < 106; row += 1) {
        lines.push(`G0 X0 Y${row}`, 'G1 X3 S0 F1500', 'G1 X23 S300', 'G1 X26 S0');
      }
    }
    const parsed = model(lines.join('\n'), { machineKind: 'laser' });
    let runwayMm = 0;
    for (let index = 0; index < parsed.segmentCount; index += 1) {
      if (
        parsed.segKind[index] !== SEG_KIND.travel ||
        parsed.segMotion[index] !== SEG_MOTION.linear
      )
        continue;
      const base = index * 6;
      runwayMm += Math.abs(parsed.positions[base + 3]! - parsed.positions[base]!);
    }
    expect(runwayMm).toBe(1908);
    expect(parsed.stats.cutMm).toBeCloseTo(6360, 1);
    expect(parsed.stats.cutBounds?.minX).toBe(3);
    expect(parsed.stats.cutBounds?.maxX).toBe(23);
  });

  it('recognizes an intentional off annotation only for its own unpowered line', () => {
    const parsed = model(
      [
        'M4 S0',
        `G1 X3 F1500 ; ${INTENTIONAL_LASER_OFF_MOTION_COMMENT}`,
        'X4',
        `X5 S300 ; ${INTENTIONAL_LASER_OFF_MOTION_COMMENT}`,
        `; ${INTENTIONAL_LASER_OFF_MOTION_COMMENT}`,
        'X6 S0',
      ].join('\n'),
    );
    expect([...parsed.segKind]).toEqual([
      SEG_KIND.travel,
      SEG_KIND.cut,
      SEG_KIND.cut,
      SEG_KIND.cut,
    ]);
  });

  it.each([undefined, 'cnc'] as const)(
    'preserves CNC/unknown G1 S0, M5, M4 reverse-spindle, and Z semantics (%s)',
    (machineKind) => {
      const parsed = model('G1 X3 F100 S0\nM5\nX6\nM4 S0\nX9\nG1 Z-1\nG0 Z5', { machineKind });
      expect([...parsed.segKind]).toEqual([
        SEG_KIND.cut,
        SEG_KIND.cut,
        SEG_KIND.cut,
        SEG_KIND.plunge,
        SEG_KIND.retract,
      ]);
      expect(parsed.stats.cutMm).toBe(9);
    },
  );

  it('does not let an annotation override explicit CNC context', () => {
    const parsed = model(`M4 S0\nG1 X3 F100 ; ${INTENTIONAL_LASER_OFF_MOTION_COMMENT}`, {
      machineKind: 'cnc',
    });
    expect([...parsed.segKind]).toEqual([SEG_KIND.cut]);
  });

  it('tracks Marlin fan PWM separately from spindle state', () => {
    const parsed = model('M107\nG1 X3 F1500\nM106 S128\nX23\nM107\nX26\nM106 S0\nX27\nM106\nX28', {
      machineKind: 'laser',
      laserPowerControl: 'fan',
    });
    expect([...parsed.segKind]).toEqual([
      SEG_KIND.travel,
      SEG_KIND.cut,
      SEG_KIND.travel,
      SEG_KIND.travel,
      SEG_KIND.cut,
    ]);
    expect([...parsed.segPower]).toEqual([0, 128, 0, 0, 255]);
    expect(parsed.stats.cutMm).toBe(21);
  });

  it('does not treat an auxiliary fan as the laser enable in spindle mode', () => {
    const parsed = model('M4 S300\nM107\nG1 X3 F600\nM5\nM106 S255\nX6', { machineKind: 'laser' });
    expect([...parsed.segKind]).toEqual([SEG_KIND.cut, SEG_KIND.travel]);
  });
});
