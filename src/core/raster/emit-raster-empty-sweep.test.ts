import { describe, expect, it } from 'vitest';
import { findM3LitPlannerDrains } from '../../__fixtures__/controllers/grbl-lit-drain-checker';
import {
  DEFAULT_DEVICE_PROFILE,
  NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  type DeviceProfile,
} from '../devices';
import type { CutGroup, RasterGroup } from '../job';
import { grblStrategy } from '../output/grbl-strategy';
import { emitRasterGroupWithEnd, type EmitRasterInput } from './emit-raster';

const COMPATIBLE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  gcodeDialect: { dialectId: 'grbl-compatible' },
};

function trailingEmptySweeps(compactMotionWords: boolean, count: number): EmitRasterInput {
  return {
    sValues: new Uint16Array([500, 500, ...Array.from({ length: count }, () => [0, 500]).flat()]),
    width: 2,
    height: count + 1,
    // All rows round to Y0. The first row burns to X0.001, while every
    // following span has both endpoints rounded to that same X0.001.
    bounds: { minX: 0, minY: 0, maxX: 0.0012, maxY: 0.0004 },
    feedMmPerMin: 1500,
    overscanMm: 0,
    bidirectional: true,
    laserModeCommand: 'M3',
    compactMotionWords,
    deferClosingM5WhenLit: true,
  };
}

function imageGroup(input: EmitRasterInput): RasterGroup {
  return {
    kind: 'raster',
    layerId: 'collapsed-image',
    color: '#000',
    power: 50,
    speed: input.feedMmPerMin,
    passes: 1,
    airAssist: false,
    sValues: input.sValues,
    pixelWidth: input.width,
    pixelHeight: input.height,
    bounds: input.bounds,
    overscanMm: input.overscanMm,
    dotWidthCorrectionMm: 0,
    bidirectional: true,
  };
}

const NEXT_CUT: CutGroup = {
  kind: 'cut',
  layerId: 'next-cut',
  color: '#000',
  power: 30,
  speed: 1000,
  passes: 1,
  airAssist: false,
  segments: [
    {
      polyline: [
        { x: 5, y: 5 },
        { x: 6, y: 5 },
      ],
      closed: false,
    },
  ],
};

describe.each([false, true])('raster empty sweeps, compact=%s', (compactMotionWords) => {
  it.each([1, 3])('preserves the lit ending across %s collapsed trailing sweeps', (count) => {
    const result = emitRasterGroupWithEnd(trailingEmptySweeps(compactMotionWords, count));

    expect(result.closingM5Deferred, result.gcode).toBe(true);
    expect(result.gcode.trimEnd()).toMatch(/S500$/);
  });

  it.each(['M3', 'M4'] as const)(
    'keeps the first engraving feed after an initial collapsed %s burn',
    (laserModeCommand) => {
      const result = emitRasterGroupWithEnd({
        ...trailingEmptySweeps(compactMotionWords, 1),
        laserModeCommand,
        width: 4,
        sValues: new Uint16Array([500, 0, 0, 0, 700, 700, 700, 700]),
        bounds: { minX: 0, minY: 0, maxX: 0.0016, maxY: 0.0004 },
        deferredEntry: { entryLines: ['M8'] },
      });
      const commands = result.gcode.split('\n').map((line) => line.replaceAll(' ', ''));

      const firstBurn = commands.findIndex((line) => line.endsWith('S700'));
      expect(firstBurn, result.gcode).toBeGreaterThan(0);
      const feedWords = commands
        .slice(0, firstBurn + 1)
        .flatMap((line) => [...line.matchAll(/F(\d+(?:\.\d+)?)/g)].map((word) => Number(word[1])));
      expect(feedWords.at(-1), result.gcode).toBe(1500);
      // Even if its burn disappears, the first written positioning move still
      // owns the deferred opening and must release it exactly once.
      expect(commands.filter((line) => line === 'M8')).toHaveLength(1);
      const firstTravel = commands.findIndex((line) => line.startsWith('G0'));
      expect(commands.slice(firstTravel, firstTravel + 4)).toEqual([
        compactMotionWords ? 'G0X0Y0S0' : 'G0X0.000Y0.000S0',
        'M8',
        'M5',
        `${laserModeCommand}S0`,
      ]);
    },
  );
});

describe.each([
  { label: 'GRBL Compatible M3 verbose', device: COMPATIBLE, deferred: true },
  { label: '4040 M4 compact', device: NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, deferred: false },
])('empty raster sweeps at $label group handoffs', ({ device, deferred }) => {
  it.each([1, 3])('keeps the closing drain dark after %s collapsed final sweeps', (count) => {
    const output = grblStrategy.emit(
      { groups: [imageGroup(trailingEmptySweeps(false, count)), NEXT_CUT] },
      device,
      { finishPosition: null },
    );

    expect(findM3LitPlannerDrains(output), output).toEqual([]);
    if (deferred) {
      expect(output).toContain('G0 X5.000 Y5.000 S0\nM5\nM3 S0\nG1 X6.000 Y5.000 F1000 S300');
    } else {
      expect(output).toContain('M4 S0');
      expect(output).toContain('X0.001F1500S500');
      expect(output).toContain('G1 X6.000 Y5.000 F1000 S300');
    }
  });
});
