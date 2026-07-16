import { describe, expect, it } from 'vitest';
import {
  ABSOLUTE_HOME_REQUIRED_MESSAGE,
  absoluteCoordinatesHomeIssue,
} from './absolute-placement-safety';

describe('absoluteCoordinatesHomeIssue', () => {
  it('requires one confirmed Home for Absolute Coordinates on a homing laser', () => {
    expect(
      absoluteCoordinatesHomeIssue({
        machineKind: 'laser',
        startFrom: 'absolute',
        homingEnabled: true,
        homingState: 'unknown',
      }),
    ).toBe(ABSOLUTE_HOME_REQUIRED_MESSAGE);
    expect(
      absoluteCoordinatesHomeIssue({
        machineKind: 'laser',
        startFrom: 'absolute',
        homingEnabled: true,
        homingState: 'confirmed',
      }),
    ).toBeNull();
  });

  it('does not impose the Absolute gate on explicit relative modes or CNC setup', () => {
    expect(
      absoluteCoordinatesHomeIssue({
        machineKind: 'laser',
        startFrom: 'current-position',
        homingEnabled: true,
        homingState: 'unknown',
      }),
    ).toBeNull();
    expect(
      absoluteCoordinatesHomeIssue({
        machineKind: 'cnc',
        startFrom: 'absolute',
        homingEnabled: true,
        homingState: 'unknown',
      }),
    ).toBeNull();
  });
});
