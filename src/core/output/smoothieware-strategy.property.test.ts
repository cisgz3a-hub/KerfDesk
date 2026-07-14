import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import { collectG1SValues, findLaserOnTravelIssues, findOutOfBoundsCoords } from '../invariants';
import {
  arbLaserJob,
  arbMixedLaserJob,
  OUTPUT_BED_HEIGHT,
  OUTPUT_BED_WIDTH,
  OUTPUT_FUZZ_RUNS,
  singleCutJob,
} from './__fixtures__/laser-job-arbitraries';
import { smoothiewareStrategy } from './smoothieware-strategy';

const SMOOTHIE_DEVICE: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  controllerKind: 'smoothieware',
  maxPowerS: 1,
};

describe('smoothiewareStrategy property tests', () => {
  it('is deterministic across mixed cut and fill jobs', () => {
    fc.assert(
      fc.property(
        arbMixedLaserJob,
        (job) =>
          smoothiewareStrategy.emit(job, SMOOTHIE_DEVICE) ===
          smoothiewareStrategy.emit(job, SMOOTHIE_DEVICE),
      ),
      { numRuns: OUTPUT_FUZZ_RUNS },
    );
  });

  it('keeps every travel laser-off across mixed jobs', () => {
    fc.assert(
      fc.property(
        arbMixedLaserJob,
        (job) =>
          findLaserOnTravelIssues(smoothiewareStrategy.emit(job, SMOOTHIE_DEVICE)).length === 0,
      ),
      { numRuns: OUTPUT_FUZZ_RUNS },
    );
  });

  it('keeps in-bed cut jobs inside the configured work area', () => {
    fc.assert(
      fc.property(
        arbLaserJob,
        (job) =>
          findOutOfBoundsCoords(smoothiewareStrategy.emit(job, SMOOTHIE_DEVICE), {
            width: OUTPUT_BED_WIDTH,
            height: OUTPUT_BED_HEIGHT,
          }).length === 0,
      ),
      { numRuns: OUTPUT_FUZZ_RUNS },
    );
  });

  it('maps percentage power to the documented fractional S scale', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100 }), (power) => {
        const values = collectG1SValues(
          smoothiewareStrategy.emit(singleCutJob(power), SMOOTHIE_DEVICE),
        );
        const expected = power / 100;
        return (
          values.length > 0 &&
          values.every((value) => value >= 0 && value <= 1 && value === expected)
        );
      }),
      { numRuns: OUTPUT_FUZZ_RUNS },
    );
  });

  it('pins the profile maximum used by the fractional-scale contract', () => {
    expect(SMOOTHIE_DEVICE.maxPowerS).toBe(1);
  });
});
