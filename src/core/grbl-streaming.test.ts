// The Start window derives from a receive capacity the controller reported.
// A value above any usable ring proves only grblHAL's default 1024-byte ring:
// grblHAL prints its free count as a uint16, so 65535 is just the field's
// largest value
// (https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/report.c#L1342-L1347,
// stream.h#L211-L214 and #L52-L53; controller audit P-3/S-2).

import { describe, expect, it } from 'vitest';
import {
  isOversizedRxCapacityReport,
  MAX_PLAUSIBLE_REPORTED_RX_BYTES,
  rxWindowFromReportedCapacity,
} from './grbl-streaming';

describe('rxWindowFromReportedCapacity', () => {
  it('keeps the 8-byte margin below a plausible report', () => {
    expect(rxWindowFromReportedCapacity(128)).toBe(120);
    expect(rxWindowFromReportedCapacity(1024)).toBe(1016);
    expect(rxWindowFromReportedCapacity(MAX_PLAUSIBLE_REPORTED_RX_BYTES)).toBe(4096);
  });

  it('counts a report above any usable ring as the grblHAL default ring', () => {
    expect(isOversizedRxCapacityReport(4104)).toBe(false);
    expect(isOversizedRxCapacityReport(4105)).toBe(true);
    expect(rxWindowFromReportedCapacity(4105)).toBe(1016);
    expect(rxWindowFromReportedCapacity(65535)).toBe(1016);
  });

  it('returns null for a value that cannot bound a window', () => {
    expect(rxWindowFromReportedCapacity(8)).toBeNull();
    expect(rxWindowFromReportedCapacity(12.5)).toBeNull();
    expect(rxWindowFromReportedCapacity(undefined)).toBeNull();
    expect(rxWindowFromReportedCapacity(9)).toBe(1);
  });
});
