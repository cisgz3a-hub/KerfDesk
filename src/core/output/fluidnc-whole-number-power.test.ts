// ADR-567 Amendment 2 (controller audit v4 E1-P2-1): FluidNC keeps S as a
// whole SpindleSpeed before its speed_map, so version 3's fractional S words
// for a small $30 were truncated: at $30=1 every power below 100% burned
// nothing, and at $30=20 S6.98 (34.9%) ran as S6 (30%). Version 4 sends
// FluidNC whole S, judged here by an independent FluidNC power model.

import { describe, expect, it } from 'vitest';
import {
  fluidncPowerPercent,
  linearFluidncSpeedMap,
} from '../../__fixtures__/controllers/fluidnc-laser-power-model';
import { emitPreparedGcode, prepareOutput } from '../../io/gcode';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import { profileCatalogEntryById } from '../devices/profile-catalog';
import { compileJob } from '../job/compile-job';
import { vectorPowerReachesController } from '../job/job-start-power';
import type { CutGroup, Job, RasterGroup } from '../job';
import { encodeCanonicalBase64 } from '../relief/depth-map-base64';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type RasterImage,
} from '../scene';
import { grblStrategy } from './grbl-strategy';
import { scaleS } from './grbl-laser-lines';
import {
  CURRENT_LASER_POWER_SCALE_VERSION,
  powerScaleVersionForDevice,
  type LaserPowerScaleVersion,
} from './laser-power-scale-version';

function fluidnc(maxPowerS: number): DeviceProfile {
  return { ...DEFAULT_DEVICE_PROFILE, controllerKind: 'fluidnc', maxPowerS };
}

function line(power: number): CutGroup {
  return {
    kind: 'cut',
    layerId: `line-${power}`,
    color: '#000000',
    power,
    speed: 1200,
    passes: 1,
    airAssist: false,
    segments: [
      {
        closed: false,
        polyline: [
          { x: 10, y: 10 },
          { x: 30, y: 10 },
        ],
      },
    ],
  };
}

function burnS(gcode: string): ReadonlyArray<string> {
  return gcode
    .split('\n')
    .filter((text) => text.startsWith('G1 X30.000 Y10.000'))
    .map((text) => /S([\d.]+)/.exec(text)?.[1] ?? 'none');
}

/** What FluidNC burns for each S word, as a percent of full power. */
function burned(sWords: ReadonlyArray<string | number>, top: number): ReadonlyArray<number> {
  return sWords.map((s) =>
    Number(fluidncPowerPercent(Number(s), linearFluidncSpeedMap(top)).toFixed(2)),
  );
}

// Luma 0x00, 0x80, 0xFE and 0xFF: full, mid, almost-white and white.
const PIXELS = Uint8Array.from([0, 128, 254, 255]);

function grayscaleRaster(device: DeviceProfile, version: LaserPowerScaleVersion): Job {
  const image: RasterImage = {
    kind: 'raster-image',
    id: 'R1',
    source: 'photo.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    lumaBase64: encodeCanonicalBase64(PIXELS),
    pixelWidth: PIXELS.length,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: PIXELS.length, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'threshold',
    linesPerMm: 1,
  };
  const layer = {
    ...createLayer({ id: 'image', color: '#808080', mode: 'image' as const }),
    ditherAlgorithm: 'grayscale' as const,
    linesPerMm: 1,
    minPower: 10,
    power: 60,
  };
  return compileJob({ objects: [image], layers: [layer] }, device, version);
}

function rasterValues(job: Job): ReadonlyArray<number> {
  const group = job.groups[0];
  if (group?.kind !== 'raster') throw new Error('expected one raster group');
  return Array.from((group as RasterGroup).sValues);
}

describe('FluidNC whole-number S (ADR-567 Amendment 2)', () => {
  it('maps FluidNC to whole-S rounding from version 4 only', () => {
    expect(CURRENT_LASER_POWER_SCALE_VERSION).toBe(4);
    expect(powerScaleVersionForDevice(fluidnc(20))).toBe(1);
    expect(powerScaleVersionForDevice(fluidnc(20), 3)).toBe(3);
    expect(powerScaleVersionForDevice(fluidnc(20), 2)).toBe(2);
    // GRBL and grblHAL keep float S, so they keep the virtual range.
    expect(powerScaleVersionForDevice({ ...DEFAULT_DEVICE_PROFILE, maxPowerS: 20 })).toBe(4);
    expect(
      powerScaleVersionForDevice({ ...DEFAULT_DEVICE_PROFILE, controllerKind: 'grblhal' }),
    ).toBe(4);
  });

  it('at $30=1 burns what it sends instead of truncating S0.6 to nothing', () => {
    const job = { groups: [line(30), line(60), line(100)] };
    const sent = burnS(grblStrategy.emit(job, fluidnc(1)));
    expect(sent).toEqual(['0', '1', '1']);
    expect(burned(sent, 1)).toEqual([0, 100, 100]);
    // Version 3's fractional bytes: FluidNC ran the 60% line at S0.
    const before = burnS(grblStrategy.emit(job, fluidnc(1), { laserPowerScaleVersion: 3 }));
    expect(before).toEqual(['0.3', '0.6', '1']);
    expect(burned(before, 1)).toEqual([0, 0, 100]);
  });

  it('at $30=20 lands each Line within half a step of its set power', () => {
    const powers = [33, 60, 100];
    const job = { groups: powers.map(line) };
    const sent = burnS(grblStrategy.emit(job, fluidnc(20)));
    expect(sent).toEqual(['7', '12', '20']);
    const now = burned(sent, 20);
    expect(now).toEqual([35, 60, 100]);
    for (const [index, power] of powers.entries()) {
      expect(Math.abs((now[index] ?? 0) - power)).toBeLessThanOrEqual(2.5);
    }
    // Version 3 sent S6.6, which FluidNC ran as S6: 30%, three points low.
    const before = burnS(grblStrategy.emit(job, fluidnc(20), { laserPowerScaleVersion: 3 }));
    expect(before).toEqual(['6.6', '12', '20']);
    expect(burned(before, 20)).toEqual([30, 60, 100]);
  });

  it('compiles a $30=20 grayscale image in whole S', () => {
    const values = rasterValues(grayscaleRaster(fluidnc(20), 4));
    expect(values).toEqual([12, 7, 2, 0]);
    // 60% / min 10%: the mid grey is meant to burn at 34.9%.
    expect(burned(values, 20)).toEqual([60, 35, 10, 0]);
    expect(grblStrategy.emit(grayscaleRaster(fluidnc(20), 4), fluidnc(20))).not.toMatch(/S\d+\.\d/);
    // Version 3 compiled S6.98 for the mid grey, and FluidNC burned 30%.
    const before = rasterValues(grayscaleRaster(fluidnc(20), 3));
    expect(before).toEqual([12, 6.98, 2.04, 0]);
    expect(burned(before, 20)).toEqual([60, 30, 10, 0]);
  });

  it('keeps $30=255 bytes unchanged from version 3', () => {
    const device = fluidnc(255);
    const job = { groups: [line(33), line(60)] };
    expect(grblStrategy.emit(job, device)).toBe(
      grblStrategy.emit(job, device, { laserPowerScaleVersion: 3 }),
    );
    expect(burnS(grblStrategy.emit(job, device))).toEqual(['84', '153']);
    expect(rasterValues(grayscaleRaster(device, 4))).toEqual(
      rasterValues(grayscaleRaster(device, 3)),
    );
    expect(burned(rasterValues(grayscaleRaster(device, 4)), 255)[0]).toBe(60);
  });

  it('counts a FluidNC power that rounds to S0 as not reaching the controller', () => {
    expect(vectorPowerReachesController(30, fluidnc(1))).toBe(false);
    expect(vectorPowerReachesController(60, fluidnc(1))).toBe(true);
    expect(vectorPowerReachesController(2, fluidnc(20))).toBe(false);
    expect(vectorPowerReachesController(3, fluidnc(20))).toBe(true);
    expect(scaleS(30, 1, powerScaleVersionForDevice(fluidnc(1)))).toBe(0);
    // GRBL keeps float S, so its 30% still reaches a $30=1 range as S0.3.
    expect(vectorPowerReachesController(30, { ...DEFAULT_DEVICE_PROFILE, maxPowerS: 1 })).toBe(
      true,
    );
  });

  it('sends a connected FluidNC $30=20 whole S, and a version 3 record keeps its bytes', () => {
    const catalog = profileCatalogEntryById('generic-fluidnc')?.profile;
    if (catalog === undefined) throw new Error('missing generic-fluidnc profile');
    const prepared = prepareOutput(lineProject(catalog, 33), { laserMaxPowerS: 20 });
    if (!prepared.ok) throw new Error('expected prepared output');
    expect(prepared.laserPowerScaleVersion).toBe(4);
    // Lit G1 words only; compact output spells `G1X…` with no space.
    const sWords = (gcode: string) =>
      gcode
        .split('\n')
        .filter((text) => /^G1(?!\d)/.test(text))
        .map((text) => /S([\d.]+)/.exec(text.split(';')[0] ?? '')?.[1])
        .filter((s) => s !== undefined && Number(s) > 0);
    expect(new Set(sWords(emitPreparedGcode(prepared).gcode))).toEqual(new Set(['7']));
    const archived = { ...prepared, laserPowerScaleVersion: 3 as const };
    expect(new Set(sWords(emitPreparedGcode(archived).gcode))).toEqual(new Set(['6.6']));
  });
});

function lineProject(device: DeviceProfile, power: number): Project {
  const color = '#ff0000';
  return {
    ...createProject(device),
    scene: {
      layers: [{ ...createLayer({ id: 'line', color }), power }],
      objects: [
        {
          kind: 'imported-svg',
          id: 'line-object',
          source: 'line.svg',
          transform: IDENTITY_TRANSFORM,
          bounds: { minX: 19, minY: 20, maxX: 20, maxY: 20 },
          paths: [
            {
              color,
              polylines: [
                {
                  points: [
                    { x: 19, y: 20 },
                    { x: 20, y: 20 },
                  ],
                  closed: false,
                },
              ],
            },
          ],
        },
      ],
    },
  };
}
