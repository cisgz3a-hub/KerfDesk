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
