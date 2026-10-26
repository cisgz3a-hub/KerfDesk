// ADR-398 Amendment 2: a Marlin image layer with zero overscan can end its last
// row on a burn. The row's zero-length close (`G1 X.. S0`) plans no Marlin
// block (planner.cpp:2247-2248), so its zero power is never applied
// (stepper.cpp:2574-2584), and continuous inline power stays lit while the head
// is stopped (stepper.cpp:2345-2349). The raster's closing `M5` (`M5 I`)
// synchronizes first (M3-M5.cpp), so written straight after that row it
// stopped the head with the beam on. The raster now reports that lit ending and
// leaves its `M5` for the next laser-off move, as it does under GRBL M3. The
// oracle is src/__fixtures__/controllers/marlin-lit-drain-checker.ts.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { findMarlinLitPlannerDrains } from '../../__fixtures__/controllers/marlin-lit-drain-checker';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import type { CutGroup, Group, RasterGroup } from '../job';
import { emitRasterGroupWithEnd, type EmitRasterInput } from '../raster/emit-raster';
import { OUTPUT_FUZZ_RUNS } from './__fixtures__/laser-job-arbitraries';
import { marlinStrategy } from './marlin-strategy';

const INLINE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  controllerKind: 'marlin',
  maxPowerS: 255,
  airAssistCommand: 'M8',
  gcodeDialect: { dialectId: 'marlin-inline' },
};
const FAN: DeviceProfile = { ...INLINE, gcodeDialect: { dialectId: 'marlin-fan' } };
const DEVICES = [
  ['inline', INLINE],
  ['fan', FAN],
] as const;

// Two rows that both end on a burn: X29..31 left to right, then X31..28 back.
function image(patch: Partial<RasterGroup> = {}): RasterGroup {
  return {
    kind: 'raster',
    layerId: 'R',
    color: '#000000',
    power: 50,
    speed: 3000,
    passes: 1,
    airAssist: false,
    sValues: new Uint16Array([0, 200, 200, 200, 200, 200]),
    pixelWidth: 3,
    pixelHeight: 2,
    bounds: { minX: 28, minY: 30, maxX: 31, maxY: 32 },
    overscanMm: 0,
    dotWidthCorrectionMm: 0,
    ...patch,
  };
}

const CUT: CutGroup = {
  kind: 'cut',
  layerId: 'B',
  color: '#ff0000',
  power: 30,
  speed: 1200,
  passes: 1,
  airAssist: false,
  segments: [
    {
      polyline: [
        { x: 40, y: 390 },
        { x: 60, y: 390 },
      ],
      closed: false,
    },
  ],
};

describe('a Marlin image layer with zero overscan ends dark', () => {
  describe.each(DEVICES)('%s', (_label, device) => {
    it.each([
      ['a cut', [image(), CUT]],
      ['another image', [image(), image()]],
      ['a cut, the image with air', [image({ airAssist: true }), CUT]],
    ] as const)('image, then %s', (_next, groups) => {
      const out = marlinStrategy.emit({ groups }, device);
      expect(findMarlinLitPlannerDrains(out)).toEqual([]);
    });
  });

  it('inline: the closing M5 I follows the next operation’s travel', () => {
    const out = marlinStrategy.emit({ groups: [image(), CUT] }, INLINE);
    expect(out).toContain(
      [
        'G1 X28.000 F3000 S200',
        'G1 X28.000 S0',
        '; layer B color #ff0000 power 30% speed 1200 mm/min passes 1',
        '; pass 1 of 1',
        'G0 X40.000 Y390.000 F6000 S0',
        'M5 I',
        'M3 I S0',
        'G1 X60.000 Y390.000 F1200 S77',
      ].join('\n'),
    );
  });

  it('inline: the zero-length row closes are still written', () => {
    const out = marlinStrategy.emit({ groups: [image(), CUT] }, INLINE);
    expect(out).toContain('G1 X31.000 F3000 S200\nG1 X31.000 S0\nG0 X31.000 Y31.500 F6000 S0');
    expect(out).toContain('G1 X28.000 F3000 S200\nG1 X28.000 S0\n');
  });

  it('inline: an air change waits for the travel too', () => {
    const out = marlinStrategy.emit({ groups: [image({ airAssist: true }), CUT] }, INLINE);
    expect(out).toContain('G0 X40.000 Y390.000 F6000 S0\nM5 I\nM3 I S0\nM9\nG1 X60.000');
  });

  it('inline: an image last in the job keeps its ending', () => {
    const out = marlinStrategy.emit({ groups: [image()] }, INLINE);
    expect(out.endsWith('G1 X28.000 S0\nM5 I\nG0 X0.000 Y0.000 F6000 S0\n')).toBe(true);
  });

  it('reports the pre-fix inline bytes', () => {
    const before = [
      'M5 I',
      'M3 I S0',
      'G0 X29.000 Y30.500 F6000 S0',
      'G1 X31.000 F3000 S200',
      'G1 X31.000 S0',
      'M5 I',
      'M3 I S0',
      'G0 X40.000 Y390.000 F6000 S0',
      'G1 X60.000 Y390.000 F1200 S77',
      'M5 I',
    ];
    expect(findMarlinLitPlannerDrains(before.join('\n'))).toEqual([
      'line 6 "M5 I" drains with the beam lit at 200',
    ]);
  });

  it('holds for random zero-overscan images followed by another group', () => {
    const arbImage = fc
      .record({
        width: fc.integer({ min: 1, max: 6 }),
        height: fc.integer({ min: 1, max: 3 }),
        pixelMm: fc.constantFrom(0.0004, 0.1, 1),
        dotWidthCorrectionMm: fc.constantFrom(0, 0.05),
        bidirectional: fc.boolean(),
        airAssist: fc.boolean(),
        seed: fc.array(fc.integer({ min: 0, max: 255 }), { minLength: 18, maxLength: 18 }),
      })
      .map(({ width, height, pixelMm, seed, ...rest }) =>
        image({
          ...rest,
          sValues: new Uint16Array(width * height).map((_, i) => seed[i] ?? 0),
          pixelWidth: width,
          pixelHeight: height,
          bounds: { minX: 20, minY: 20, maxX: 20 + width * pixelMm, maxY: 20 + height * pixelMm },
        }),
      );
    const arbNext = fc.constantFrom<ReadonlyArray<Group>>([CUT], [image()], []);
    fc.assert(
      fc.property(arbImage, arbNext, (first, next) =>
        DEVICES.every(
          ([, device]) =>
            findMarlinLitPlannerDrains(marlinStrategy.emit({ groups: [first, ...next] }, device))
              .length === 0,
        ),
      ),
      { numRuns: OUTPUT_FUZZ_RUNS },
    );
  });
});

describe('the raster lines stay those of M4 with stopKeepsPower', () => {
  const input = (overscanMm: number): EmitRasterInput => ({
    sValues: new Uint16Array([0, 200, 200, 200, 200, 200]),
    width: 3,
    height: 2,
    bounds: { minX: 28, minY: 30, maxX: 31, maxY: 32 },
    feedMmPerMin: 3000,
    overscanMm,
    laserModeCommand: 'M4',
    deferClosingM5WhenLit: true,
  });

  it('with overscan the group is byte-identical and writes its own M5', () => {
    const m4 = emitRasterGroupWithEnd(input(2));
    const marlin = emitRasterGroupWithEnd({ ...input(2), stopKeepsPower: true });
    expect(marlin).toEqual(m4);
    expect(marlin.closingM5Deferred).toBe(false);
  });

  it('without overscan only the closing M5 is left to the caller', () => {
    const m4 = emitRasterGroupWithEnd(input(0));
    const marlin = emitRasterGroupWithEnd({ ...input(0), stopKeepsPower: true });
    expect(m4.closingM5Deferred).toBe(false);
    expect(marlin.closingM5Deferred).toBe(true);
    expect(`${marlin.gcode}M5\n`).toBe(m4.gcode);
  });
});

describe('Marlin image output with overscan keeps its bytes', () => {
  it('inline: an image, then a cut', () => {
    const out = marlinStrategy.emit({ groups: [image({ overscanMm: 2 }), CUT] }, INLINE);
    expect(out).toBe(
      [
        'M5 I',
        'G21',
        'G90',
        'M3 I S0',
        '; image layer R color #000000 power 50%',
        '; 3 x 2 px, 3.000 x 2.000 mm',
        '; feed 3000 mm/min, overscan 2.000 mm, dot width correction 0.000 mm',
        'M5 I',
        'M3 I S0',
        'G0 X27.000 Y30.500 F6000 S0',
        'G1 X29.000 F3000 S0 ; kerfdesk:laser-off-motion',
        'G1 X31.000 S200',
        'G1 X33.000 S0 ; kerfdesk:laser-off-motion',
        'G0 X33.000 Y31.500 F6000 S0',
        'G1 X31.000 F3000 S0 ; kerfdesk:laser-off-motion',
        'G1 X28.000 S200',
        'G1 X26.000 S0 ; kerfdesk:laser-off-motion',
        'M5 I',
        'M3 I S0',
        '; layer B color #ff0000 power 30% speed 1200 mm/min passes 1',
        '; pass 1 of 1',
        'G0 X40.000 Y390.000 F6000 S0',
        'G1 X60.000 Y390.000 F1200 S77',
        'M5 I',
        'G0 X0.000 Y0.000 F6000 S0',
        '',
      ].join('\n'),
    );
  });
});
