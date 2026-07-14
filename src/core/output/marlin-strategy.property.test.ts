import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import {
  collectG1SValues,
  expectedS,
  findLaserOnTravelIssues,
  findOutOfBoundsCoords,
} from '../invariants';
import {
  arbLaserJob,
  arbMixedLaserJob,
  OUTPUT_BED_HEIGHT,
  OUTPUT_BED_WIDTH,
  OUTPUT_FUZZ_RUNS,
  singleCutJob,
} from './__fixtures__/laser-job-arbitraries';
import { marlinStrategy } from './marlin-strategy';

const MARLIN_INLINE_DEVICE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  controllerKind: 'marlin',
  maxPowerS: 255,
  gcodeDialect: { dialectId: 'marlin-inline' },
};

const MARLIN_FAN_DEVICE: DeviceProfile = {
  ...MARLIN_INLINE_DEVICE,
  gcodeDialect: { dialectId: 'marlin-fan' },
};

const MARLIN_DEVICES = [MARLIN_INLINE_DEVICE, MARLIN_FAN_DEVICE] as const;

describe('marlinStrategy property tests', () => {
  it('is deterministic for inline and fan power across mixed jobs', () => {
    fc.assert(
      fc.property(arbMixedLaserJob, (job) =>
        MARLIN_DEVICES.every(
          (device) => marlinStrategy.emit(job, device) === marlinStrategy.emit(job, device),
        ),
      ),
      { numRuns: OUTPUT_FUZZ_RUNS },
    );
  });

  it('keeps every travel laser-off for inline and fan power', () => {
    fc.assert(
      fc.property(arbMixedLaserJob, (job) =>
        MARLIN_DEVICES.every(
          (device) => findLaserOnTravelIssues(marlinStrategy.emit(job, device)).length === 0,
        ),
      ),
      { numRuns: OUTPUT_FUZZ_RUNS },
    );
  });

  it('keeps in-bed cut jobs inside the configured work area', () => {
    fc.assert(
      fc.property(arbLaserJob, (job) =>
        MARLIN_DEVICES.every(
          (device) =>
            findOutOfBoundsCoords(marlinStrategy.emit(job, device), {
              width: OUTPUT_BED_WIDTH,
              height: OUTPUT_BED_HEIGHT,
            }).length === 0,
        ),
      ),
      { numRuns: OUTPUT_FUZZ_RUNS },
    );
  });

  it('maps percentage power to documented inline and fan PWM scales', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (power) => {
        const expected = expectedS(power, 255);
        const inlineValues = collectG1SValues(
          marlinStrategy.emit(singleCutJob(power), MARLIN_INLINE_DEVICE),
        );
        const fanOutput = marlinStrategy.emit(singleCutJob(power), MARLIN_FAN_DEVICE);
        const fanValues = collectFanValues(fanOutput);
        return (
          inlineValues.length > 0 &&
          inlineValues.every((value) => value === expected) &&
          fanValues.every((value) => value >= 0 && value <= 255) &&
          (expected === 0 ? fanValues.length === 0 : fanValues.includes(expected)) &&
          !/^G[01][^\n]*\bS[-+]?\d/m.test(fanOutput)
        );
      }),
      { numRuns: OUTPUT_FUZZ_RUNS },
    );
  });

  it('pins the configured maximums used by the property contracts', () => {
    expect(MARLIN_INLINE_DEVICE.maxPowerS).toBe(255);
    expect(MARLIN_FAN_DEVICE.maxPowerS).toBe(255);
  });
});

function collectFanValues(gcode: string): readonly number[] {
  const values: number[] = [];
  for (const line of gcode.split('\n')) {
    const match = /^M106\s+S(\d+)\s*$/.exec(line.trim());
    if (match?.[1] !== undefined) values.push(Number.parseInt(match[1], 10));
  }
  return values;
}
