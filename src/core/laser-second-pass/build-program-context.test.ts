import { describe, expect, it } from 'vitest';
import { buildLaserSecondPassProgram, LASER_SECOND_PASS_WRITER_VERSION } from './build-program';
import { simulateProgram } from './program-oracle.test-helper';
import type { LaserSecondPassSelection, LaserSecondPassWriterVersion } from './types';

function paint(x: number, y: number): LaserSecondPassSelection {
  return {
    version: 1,
    maxPowerS: 1000,
    strokes: [{ id: 'spot', mode: 'paint', powerScale: 1, radiusMm: 1, points: [{ x, y }] }],
  };
}

function ready(
  source: string,
  selection: LaserSecondPassSelection,
  writerVersion?: LaserSecondPassWriterVersion,
) {
  const result = buildLaserSecondPassProgram(
    source,
    selection,
    writerVersion === undefined ? {} : { writerVersion },
  );
  if (result.kind !== 'ready') throw new Error(result.message);
  return result;
}

describe('writer 3 preserves connected feed-motion context', () => {
  it('retains rapid approach corners within the same source context', () => {
    const source =
      'G21\nG90\nM4S0\nG0X0Y0S0\nG1X10F600S300\n' + 'G0X20Y20S0\nG0X20Y0S0\nG1X80F600S300\nM5\n';
    const result = ready(source, paint(60, 0));
    const moves = simulateProgram(result.gcode);
    expect(
      moves.some(
        (move) => move.rapid && move.from.x === 10 && move.to.x === 20 && move.to.y === 20,
      ),
    ).toBe(true);
    expect(moves.some((move) => move.rapid && move.from.y === 20 && move.to.y === 0)).toBe(true);
    expect(result.motionBounds).toEqual({ minX: 0, maxX: 80, minY: 0, maxY: 20 });
    expect(moves.filter((move) => move.power > 0)).toHaveLength(1);
  });

  it.each(['S0', 'M5\nM3S0', 'G0\nG1', 'G1X10S0'])(
    'retains the stop from %s even when the next source segment has the same beam mode',
    (stop) => {
      const source = `G21\nG90\nM3S0\nG0X0Y0S0\nG1X10F600S300\n${stop}\nG1X20S300\nM5\n`;
      const result = ready(source, {
        ...paint(10, 0),
        strokes: [{ ...paint(10, 0).strokes[0]!, radiusMm: 30 }],
      });
      // Writer 3 darkens using actual motion, then preserves the source stop
      // with M5/rearm even though both burns use M3.
      expect(result.gcode).toContain('G1X11Y0F600S0\nM5\nM3 S0\nG1X10Y0F600S0');
    },
  );

  it('preserves a standalone M4 S change as a source stop', () => {
    const source = 'G21\nG90\nM4S0\nG0X0Y0S0\nG1X10F600S300\nS200\nG1X20S300\nM5\n';
    const result = ready(source, {
      ...paint(10, 0),
      strokes: [{ ...paint(10, 0).strokes[0]!, radiusMm: 30 }],
    });
    expect(result.gcode).toContain('G1X10F600S300\nM5\nM4 S0\nX20F600S300');
  });

  it('preserves a standalone S0 stop before rapid positioning into the next burn', () => {
    const source = 'G21\nG90\nM3S0\nG0X0Y0S0\nG1X10F600S300\nS0\nG0X15Y5\nG1X20S300\nM5\n';
    const result = ready(source, {
      ...paint(10, 0),
      strokes: [{ ...paint(10, 0).strokes[0]!, radiusMm: 30 }],
    });
    const lines = result.gcode.split('\n');
    const firstBurn = lines.findIndex((line) => line === 'G1X10F600S300');
    const stop = lines.indexOf('M5', firstBurn);
    const rapid = lines.findIndex((line) => line === 'G0X15Y5S0');
    expect(stop).toBeGreaterThan(firstBurn);
    expect(rapid).toBeGreaterThan(stop);
  });
  it('retains feed changes and dark turns, painting only the chosen second row', () => {
    const source =
      'G21\nG90\nM4S0\nG0X-2Y0S0\nG1X0F600S0\nX10S300\n' +
      'X20F1200S300\nX20Y5S0\nX0Y5S300\nX-2S0\nM5\n';
    const result = ready(source, paint(5, 5));
    expect(result.motionBounds).toEqual({ minX: -2, maxX: 20, minY: 0, maxY: 5 });
    const moves = simulateProgram(result.gcode);
    for (const original of simulateProgram(source)) {
      expect(moves.some((move) => move.to.x === original.to.x && move.to.y === original.to.y)).toBe(
        true,
      );
    }
    const burns = moves.filter((move) => move.power > 0);
    expect(burns).toEqual([
      { from: { x: 6, y: 5 }, to: { x: 4, y: 5 }, rapid: false, feed: 1200, power: 300, mode: 4 },
    ]);
  });

  it('does not treat redundant beam and coolant words as proof of a stop', () => {
    const source =
      'G21\nG90\nM8\nM4S0\nG0X-2Y0S0\nG1X0F600S0\n' + 'X40S300\nM8\nM4\nX80S300\nX82S0\nM5\nM9\n';
    const result = ready(source, paint(70, 0));
    expect(result.motionBounds).toEqual({ minX: -2, maxX: 82, minY: 0, maxY: 0 });
    expect(result.gcode).toContain('X40');
    expect(result.gcode.match(/^M8$/gm)).toHaveLength(1);
    expect(result.gcode.match(/^M4 S0$/gm)).toHaveLength(1);
  });

  it('retains a contour corner and its unpainted approach and departure', () => {
    const source = 'G21\nG90\nM3S0\nG0X-1Y0S0\nG1X0F6000S0\n' + 'X20S500\nY20\nX0\nY0\nX-1S0\nM5\n';
    const result = ready(source, paint(20, 10));
    const moves = simulateProgram(result.gcode);
    expect(result.motionBounds).toEqual({ minX: -1, maxX: 20, minY: 0, maxY: 20 });
    expect(moves.filter((move) => move.power > 0)).toEqual([
      {
        from: { x: 20, y: 9 },
        to: { x: 20, y: 11 },
        rapid: false,
        feed: 6000,
        power: 500,
        mode: 3,
      },
    ]);
  });

  it('keeps erase/repaint ownership while retaining the dark route', () => {
    const source = 'G21\nG90\nM4S0\nG0X-2Y0S0\nG1X0F600S0\nX10S300\nX12S0\nM5\n';
    const selection = paint(5, 0);
    const stroke = selection.strokes[0]!;
    const result = ready(source, {
      ...selection,
      strokes: [
        { ...stroke, radiusMm: 4 },
        { ...stroke, id: 'erase', mode: 'erase', radiusMm: 2 },
        { ...stroke, id: 'repaint', radiusMm: 0.5, powerScale: 2 },
      ],
    });
    expect(
      simulateProgram(result.gcode)
        .filter((move) => move.power > 0)
        .map((move) => [move.from.x, move.to.x, move.power]),
    ).toEqual([
      [1, 3, 300],
      [4.5, 5.5, 600],
      [7, 9, 300],
    ]);
    expect(result.motionBounds).toEqual({ minX: -2, maxX: 12, minY: 0, maxY: 0 });
  });
});

it('keeps archived writers 1 and 2 byte-identical while new passes use writer 3', () => {
  const source =
    'G21\nG90\nG54\nG94\nM4 S0\nG0 X-5 Y0 S0\nG1 X0 F600 S0\nG1 X10 S200\nG1 X15 S0\nM5\n';
  const prelude = '; KerfDesk selective second pass\nG21\nG90\nG54\nG94\nG17\nM5\n';
  expect(ready(source, paint(5, 0), 1).gcode).toBe(
    prelude + 'G0X-5Y0S0\nM4 S0\nG1X0F600S0\nG1X4S0\nG1X6S200\nG1X10S0\nG1X15S0\nM5\n',
  );
  expect(ready(source, paint(5, 0), 2).gcode).toBe(
    prelude + 'G0X-1Y0S0\nM4 S0\nG1X0F600\nX4\nX6S200\nX10S0\nX11\nM5\n',
  );
  expect(LASER_SECOND_PASS_WRITER_VERSION).toBe(3);
  expect(ready(source, paint(5, 0)).gcode).toBe(ready(source, paint(5, 0), 3).gcode);
  expect(ready(source, paint(5, 0), 3).gcode).toBe(
    prelude + 'G0X-5Y0S0\nM4 S0\nG1X0F600\nX4\nX6S200\nX10S0\nX15\nM5\n',
  );
});
