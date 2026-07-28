import { describe, expect, it } from 'vitest';
import { mergeCncRecoveryWarnings } from './merge-cnc-recovery-warnings';

const SOURCE_ONLY_WARNING = 'Source-only warning';
const SHARED_WARNING = 'Shared warning';
const EMISSION_ONLY_WARNING = 'Emission-only warning';
const PROVENANCE_WARNING_LIMIT = 256;
const OVER_LIMIT_WARNING_COUNT = PROVENANCE_WARNING_LIMIT + 1;
const UNIQUE_WARNING_PREFIX = 'Unique warning ';

describe('mergeCncRecoveryWarnings', () => {
  it('keeps exact messages once in first-seen order', () => {
    expect(
      mergeCncRecoveryWarnings(
        [SOURCE_ONLY_WARNING, SHARED_WARNING],
        [SHARED_WARNING, EMISSION_ONLY_WARNING],
      ),
    ).toEqual([SOURCE_ONLY_WARNING, SHARED_WARNING, EMISSION_ONLY_WARNING]);
  });

  it('does not truncate distinct warnings', () => {
    const warnings = Array.from(
      { length: OVER_LIMIT_WARNING_COUNT },
      (_, index) => `${UNIQUE_WARNING_PREFIX}${index}`,
    );

    expect(mergeCncRecoveryWarnings(warnings, [])).toEqual(warnings);
  });
});
