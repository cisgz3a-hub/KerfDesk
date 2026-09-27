import { describe, expect, it } from 'vitest';
import { findM3LitPlannerDrains } from '../../__fixtures__/controllers/grbl-lit-drain-checker';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import { buildGcodeRenderModel } from '../gcode-view';
import type { CutGroup, FillGroup, Group, RasterGroup } from '../job';
import type { JobBounds } from '../job/job-bounds';
import { grblStrategy } from './grbl-strategy';

const COMPATIBLE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  airAssistCommand: 'M8',
  gcodeDialect: { dialectId: 'grbl-compatible' },
};
const DYNAMIC: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  airAssistCommand: 'M8',
  gcodeDialect: { dialectId: 'grbl-dynamic' },
};
const NEXT_ENVELOPE: JobBounds = { minX: 10, maxX: 12, minY: 9.5, maxY: 10.5 };

function vector(kind: 'cut' | 'fill', start: number, airAssist: boolean): CutGroup | FillGroup {
  const common = {
    layerId: `${kind}-${start}`,
    color: '#000',
    power: 50,
    powerMode: 'constant' as const,
    speed: 1000,
    passes: 1,
    airAssist,
    segments: [
      {
        polyline: [
          { x: start, y: 10 },
          { x: start + 2, y: 10 },
        ],
        closed: false,
        reverse: false,
      },
    ],
  };
  return kind === 'cut' ? { kind, ...common } : { kind, ...common, overscanMm: 0 };
}

function image(start: number, airAssist: boolean): RasterGroup {
  return {
    kind: 'raster',
    layerId: `image-${start}`,
    color: '#000',
    power: 60,
    speed: 1500,
    passes: 1,
    airAssist,
    sValues: new Uint16Array([600, 600]),
    pixelWidth: 2,
    pixelHeight: 1,
    bounds: { minX: start, maxX: start + 2, minY: 9.5, maxY: 10.5 },
    overscanMm: 0,
    dotWidthCorrectionMm: 0,
  };
}

function inspect(groups: ReadonlyArray<Group>, device: DeviceProfile, powers: number[]) {
  const output = grblStrategy.emit({ groups }, device, { finishPosition: null });
  expect(findM3LitPlannerDrains(output), output).toEqual([]);
  const parsed = buildGcodeRenderModel(output, { machineKind: 'laser' });
  if (parsed.kind !== 'ok') throw new Error(parsed.reason);
  const { model } = parsed;
  const moves = Array.from({ length: model.segmentCount }, (_, index) => ({
    xy: [0, 1, 3, 4].map((axis) => model.positions[index * 6 + axis]),
    power: model.segPower[index],
  }));
  expect(moves.filter(({ power }) => (power ?? 0) > 0)).toEqual([
    { xy: [8, 10, 10, 10], power: powers[0] },
    { xy: [10, 10, 12, 10], power: powers[1] },
  ]);
  const firstBurn = moves.findIndex(({ power }) => (power ?? 0) > 0);
  const secondBurn = moves.findIndex(({ power }, index) => index > firstBurn && (power ?? 0) > 0);
  const darkMoves = moves.slice(firstBurn + 1, secondBurn);
  // Held spindle/air changes must execute after real dark motion. The added
  // excursion follows the next existing path and cannot enlarge its Frame.
  expect(darkMoves.length, output).toBeGreaterThanOrEqual(2);
  for (const { xy, power } of darkMoves) {
    expect(power).toBe(0);
    for (const offset of [0, 2]) {
      expect(xy[offset]).toBeGreaterThanOrEqual(NEXT_ENVELOPE.minX);
      expect(xy[offset]).toBeLessThanOrEqual(NEXT_ENVELOPE.maxX);
      expect(xy[offset + 1]).toBeGreaterThanOrEqual(NEXT_ENVELOPE.minY);
      expect(xy[offset + 1]).toBeLessThanOrEqual(NEXT_ENVELOPE.maxY);
    }
  }
  return output;
}

describe.each([
  { label: 'Compatible M3 verbose', device: COMPATIBLE },
  { label: 'Dynamic M4 compact', device: DYNAMIC },
])('coincident vector to $label Image handoff', ({ device }) => {
  it.each(['cut', 'fill'] as const)(
    'darkens after M3 %s before changing Image mode or air',
    (kind) => {
      const output = inspect([vector(kind, 8, false), image(10, true)], device, [500, 600]);
      expect(output.split('\n').filter((line) => line === 'M8')).toHaveLength(1);
    },
  );

  it.each(['blank', 'collapsed'] as const)(
    'carries a held air transition through a %s Image to the next real burn',
    (kind) => {
      const middle: RasterGroup =
        kind === 'blank'
          ? { ...image(10, true), sValues: new Uint16Array([0, 0]) }
          : {
              ...image(10, true),
              sValues: new Uint16Array([600]),
              pixelWidth: 1,
              bounds: { minX: 10, maxX: 10.0004, minY: 9.9999, maxY: 10.0001 },
            };
      const output = inspect(
        [vector('cut', 8, false), middle, vector('cut', 10, true)],
        device,
        [500, 500],
      );
      expect(output.split('\n').filter((line) => line === 'M8')).toHaveLength(1);
    },
  );
});

describe('coincident M3 Image to following group handoff', () => {
  it.each(['cut', 'fill'] as const)('retains the Image end for the next %s entry', (kind) => {
    inspect([image(8, true), vector(kind, 10, false)], COMPATIBLE, [600, 500]);
  });

  it('retains the Image end for a second Image at the same coordinate', () => {
    inspect([image(8, true), image(10, false)], COMPATIBLE, [600, 600]);
  });
});
