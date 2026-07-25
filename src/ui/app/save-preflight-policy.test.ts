import { describe, expect, it } from 'vitest';

import type { PreflightIssue } from '../../core/preflight';
import { partitionSavePreflight } from './save-preflight-policy';

describe('partitionSavePreflight', () => {
  it('keeps every non-advisory issue blocking, including non-finite scan offsets', () => {
    const issues: ReadonlyArray<PreflightIssue> = [
      { code: 'non-finite-coordinate', message: 'Line 3: X is NaN.' },
      { code: 'scan-offset-out-of-range', message: 'Layer L1 scan offset NaN must be finite.' },
      { code: 'empty-output', message: 'No cuts.' },
      { code: 'out-of-bed', message: 'Line 9: X exceeds the bed.' },
    ];

    const split = partitionSavePreflight(issues);

    expect(split.blocking).toEqual(issues);
    expect(split.advisories).toEqual([]);
  });

  // Audit 4.3: rule 7 says configured no-go zones "may warn in Job Review, but
  // must never refuse Frame or Start". Start already demoted this code; the
  // export path did not, so a job Start would stream could not be saved.
  it('demotes no-go-zone uncertainty to a save advisory (rule 7)', () => {
    const split = partitionSavePreflight([
      {
        code: 'no-go-zone-collision',
        message: 'No-go zones cannot be checked from this hand-set origin.',
      },
      { code: 'non-finite-coordinate', message: 'Line 3: X is NaN.' },
    ]);

    expect(split.advisories.map((issue) => issue.code)).toEqual(['no-go-zone-collision']);
    // Compile integrity is untouched — that one still refuses.
    expect(split.blocking.map((issue) => issue.code)).toEqual(['non-finite-coordinate']);
  });

  it('demotes the scan-offset magnitude cap to a save advisory (rule 7)', () => {
    const split = partitionSavePreflight([
      {
        code: 'scan-offset-above-cap',
        message: 'Layer L1 bidirectional scan offset 4.01 mm exceeds the device limit of ±4 mm.',
      },
      { code: 'out-of-bed', message: 'Line 9: X exceeds the bed.' },
    ]);

    expect(split.blocking.map((issue) => issue.code)).toEqual(['out-of-bed']);
    expect(split.advisories.map((issue) => issue.code)).toEqual(['scan-offset-above-cap']);
  });
});
