import { describe, expect, it } from 'vitest';
import { findM3LitPlannerDrains } from '../../__fixtures__/controllers/grbl-lit-drain-checker';
import { burnGeometryKey, oracleBurns } from '../controllers/grbl/laser-burn-oracle.test-helper';
import { buildResumeProgram } from '../controllers/grbl/resume-program';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import { buildMotionManifest } from '../job/motion-manifest';
import type { FillGroup, Job } from '../job';
import { grblStrategy } from './grbl-strategy';

function fill(rows = 3, spans = 12): FillGroup {
  return {
    kind: 'fill',
    layerId: 'detail',
    color: '#000000',
    power: 30,
    speed: 6000,
    passes: 2,
    airAssist: true,
    fillStyle: 'scanline',
    fillRunwayPolicy: 'feed-matched-every-sweep',
    overscanMm: 5,
    segments: Array.from({ length: rows * spans }, (_, index) => {
      const row = Math.floor(index / spans);
      const reverse = row % 2 !== 0;
      const start = { x: 20 + (index % spans) * 0.2, y: 20 + row * 0.1 };
      const end = { x: start.x + 0.1, y: start.y };
      return { polyline: reverse ? [end, start] : [start, end], closed: false, reverse };
    }),
  };
}

function output(job: Job, compact = true, device: DeviceProfile = DEFAULT_DEVICE_PROFILE): string {
  return grblStrategy.emit(job, device, compact ? {} : { compactMotionWords: false });
}

function burns(gcode: string) {
  return oracleBurns(gcode).map((burn) => [burnGeometryKey(burn), burn.air]);
}

describe('lossless Fill motion compaction (ADR-460)', () => {
  it.each(['grbl-dynamic', 'grbl-raster'] as const)(
    'preserves all motion, feeds, power, air and pass order on %s',
    (dialectId) => {
      const device = {
        ...DEFAULT_DEVICE_PROFILE,
        gcodeDialect: { dialectId },
        scanningOffsets: [{ speedMmPerMin: 6000, offsetMm: 0.025 }],
      };
      const job = {
        groups: [fill(), { ...fill(), layerId: 'second', power: 60, airAssist: false }],
      };
      const compact = output(job, true, device);
      const verbose = output(job, false, device);
      expect(burns(compact)).toEqual(burns(verbose));
      expect(burns(compact).length).toBeGreaterThan(100);
      // Compaction changes no raw line count either, keeping provenance aligned.
      expect(buildMotionManifest(compact, { machineKind: 'laser' })).toEqual(
        buildMotionManifest(verbose, { machineKind: 'laser' }),
      );
      expect(compact).toMatch(/^X[\d.-]+S0$/m);
      expect(compact).not.toMatch(/^S[\d.-]+$/m);
    },
  );

  it.each(['grbl-compatible', 'neotronics-4040-safe'] as const)(
    'retains the conservative %s spelling',
    (dialectId) => {
      const device = { ...DEFAULT_DEVICE_PROFILE, gcodeDialect: { dialectId } };
      expect(output({ groups: [fill()] }, true, device)).toBe(
        output({ groups: [fill()] }, false, device),
      );
    },
  );

  it('restores the exact remaining burns from every line of a compact Fill program', () => {
    const compact = output({ groups: [fill(2, 4)] });
    const original = oracleBurns(compact);
    for (let fromLine = 1; fromLine <= compact.split('\n').length; fromLine += 1) {
      const resumed = buildResumeProgram(compact, fromLine, {
        machineKind: 'laser',
        safeZMm: 0,
        spindleSpinupSec: 0,
        plungeMmPerMin: 300,
      });
      const expected = original.filter((burn) => burn.line >= fromLine);
      if (resumed.kind === 'error') {
        expect(expected, resumed.reason).toEqual([]);
        expect(resumed.reason).toBe('Nothing left to run from that line.');
      } else {
        const actual = oracleBurns(resumed.lines.join('\n'), { x: 987.654, y: 876.543 });
        expect(
          actual.map((burn) => [burnGeometryKey(burn), burn.air]),
          `line ${fromLine}`,
        ).toEqual(expected.map((burn) => [burnGeometryKey(burn), burn.air]));
      }
    }
  });

  it.each([0, 37, 90])(
    'preserves both axes on a %s degree sweep across negative coordinates',
    (degrees) => {
      const radians = (degrees * Math.PI) / 180;
      const group = fill(2, 4);
      const rotated: FillGroup = {
        ...group,
        speed: 31.7,
        segments: group.segments.map((segment) => ({
          ...segment,
          polyline: segment.polyline.map(({ x, y }) => ({
            x: (x - 20) * Math.cos(radians) - (y - 20) * Math.sin(radians) - 0.1254,
            y: (x - 20) * Math.sin(radians) + (y - 20) * Math.cos(radians) - 0.1254,
          })),
        })),
      };
      const compact = output({ groups: [rotated] });
      const verbose = output({ groups: [rotated] }, false);
      expect(burns(compact)).toEqual(burns(verbose));
      expect(oracleBurns(compact)).toHaveLength(16);
      expect(oracleBurns(compact).every((burn) => burn.feed === 31)).toBe(true);
      expect(buildMotionManifest(compact, { machineKind: 'laser' })).toEqual(
        buildMotionManifest(verbose, { machineKind: 'laser' }),
      );
    },
  );

  it('keeps micrometre moves while skipping rounded-away spans and touching gaps', () => {
    const pairs = [
      [-0.0004, -0.0001],
      [-0.0004, 0.00149],
      [0.00149, 0.00151],
      [0.0021, 0.0022],
      [0.0022, 0.0031],
    ];
    const group: FillGroup = {
      ...fill(1, 1),
      passes: 1,
      fillRunwayPolicy: 'raster-full',
      overscanMm: 0,
      segments: pairs.map(([start = 0, end = 0]) => ({
        polyline: [
          { x: start, y: start },
          { x: end, y: end },
        ],
        closed: false,
        reverse: false,
      })),
    };
    const compact = output({ groups: [group] });
    expect(burns(compact)).toEqual(burns(output({ groups: [group] }, false)));
    expect(oracleBurns(compact).map((burn) => [burn.from, burn.to])).toEqual([
      [
        { x: 0, y: 0 },
        { x: 0.001, y: 0.001 },
      ],
      [
        { x: 0.001, y: 0.001 },
        { x: 0.002, y: 0.002 },
      ],
      [
        { x: 0.002, y: 0.002 },
        { x: 0.003, y: 0.003 },
      ],
    ]);
    expect(compact).not.toMatch(/^S[\d.-]+$/m);
  });

  it('restores G1 and axes after held M3 and air transitions at a coincident zero-runway entry', () => {
    const at = (start: number, airAssist: boolean): FillGroup => ({
      ...fill(1, 1),
      layerId: `at-${start}`,
      passes: 1,
      powerMode: 'constant',
      airAssist,
      fillRunwayPolicy: 'raster-full',
      overscanMm: 0,
      segments: [
        {
          polyline: [
            { x: start, y: 2 },
            { x: start + 1, y: 2 },
          ],
          closed: false,
          reverse: false,
        },
      ],
    });
    const device: DeviceProfile = { ...DEFAULT_DEVICE_PROFILE, airAssistCommand: 'M8' };
    const job = { groups: [at(10, true), at(11, false)] };
    const compact = output(job, true, device);
    expect(burns(compact)).toEqual(burns(output(job, false, device)));
    expect(oracleBurns(compact).map((burn) => [burn.beam, burn.air])).toEqual([
      [3, 'M8'],
      [3, 'off'],
    ]);
    expect(findM3LitPlannerDrains(compact)).toEqual([]);
    expect(buildMotionManifest(compact, { machineKind: 'laser' })).toEqual(
      buildMotionManifest(output(job, false, device), { machineKind: 'laser' }),
    );
  });

  it('reduces dense Fill bytes by at least 40 percent without dropping a span', () => {
    const job = { groups: [{ ...fill(100, 200), passes: 1 }] };
    const compact = output(job);
    const verbose = output(job, false);
    expect(compact.length).toBeLessThan(verbose.length * 0.6);
    expect(burns(compact)).toHaveLength(20_000);
    expect(burns(compact)).toEqual(burns(verbose));
  });
});
