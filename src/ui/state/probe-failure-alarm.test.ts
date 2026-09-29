// Which alarms leave the machine position and the work origin standing
// (controller audit 2 M-1, ADR-375; the firmware evidence is in
// probe-failure-alarm.ts).

import { describe, expect, it } from 'vitest';
import { isProbeFailureAlarm } from './probe-failure-alarm';

describe('isProbeFailureAlarm', () => {
  it.each([4, 5])('ALARM:%i stops only the probe move', (code) => {
    expect(isProbeFailureAlarm(code)).toBe(true);
  });

  // grblHAL's 13 (probe protection) and FluidNC's 18 (probe hard limit) stop
  // motion outright and may lose steps; a text alarm names no code.
  it.each([1, 2, 3, 6, 9, 10, 13, 18, null, undefined])('ALARM:%s does not', (code) => {
    expect(isProbeFailureAlarm(code)).toBe(false);
  });
});
