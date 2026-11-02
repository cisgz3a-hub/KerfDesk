import { describe, expect, it } from 'vitest';
import { grblHalMayHoldResumeTail, reportedGrblBuildDate } from './held-resume-tail';

describe('grblHAL held resume tail (ADR-684)', () => {
  it('reads the build date from a $I VER line', () => {
    expect(reportedGrblBuildDate(['[VER:1.1f.20231005:]', '[OPT:VNMSL,511,1024]'])).toBe(20231005);
    expect(reportedGrblBuildDate(['[VER:1.1h.20190830:test]'])).toBe(20190830);
    expect(reportedGrblBuildDate(['[OPT:V,15,128]'])).toBeNull();
    expect(reportedGrblBuildDate([])).toBeNull();
  });

  it('applies to grblHAL before build 20260928 and to grblHAL of unknown build', () => {
    // The Falcon A1 Pro's published build (rayforge PR #461).
    expect(
      grblHalMayHoldResumeTail({ grblHal: true, buildInfoLines: ['[VER:1.1f.20231005:]'] }),
    ).toBe(true);
    expect(
      grblHalMayHoldResumeTail({ grblHal: true, buildInfoLines: ['[VER:1.1f.20260923:]'] }),
    ).toBe(true);
    expect(grblHalMayHoldResumeTail({ grblHal: true, buildInfoLines: [] })).toBe(true);
  });

  it('does not apply to a grblHAL build with the fix, or to other firmware', () => {
    expect(
      grblHalMayHoldResumeTail({ grblHal: true, buildInfoLines: ['[VER:1.1f.20260928:]'] }),
    ).toBe(false);
    expect(
      grblHalMayHoldResumeTail({ grblHal: true, buildInfoLines: ['[VER:1.1f.20261015:]'] }),
    ).toBe(false);
    expect(
      grblHalMayHoldResumeTail({ grblHal: false, buildInfoLines: ['[VER:1.1h.20190830:]'] }),
    ).toBe(false);
  });
});
