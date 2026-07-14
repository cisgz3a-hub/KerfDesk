import { describe, expect, it } from 'vitest';
import { SOFTWARE_ABORT_LABEL, SOFTWARE_ABORT_TITLE } from '../common/software-abort-copy';

describe('software abort copy', () => {
  it('names the host action without promising a physical stop', () => {
    expect(SOFTWARE_ABORT_LABEL).toBe('ABORT');
    expect(SOFTWARE_ABORT_TITLE).toContain('controller-specific');
    expect(SOFTWARE_ABORT_TITLE).toContain('not a safety-rated stop');
    expect(SOFTWARE_ABORT_TITLE).toContain('physical E-stop');
    expect(SOFTWARE_ABORT_TITLE).not.toMatch(/force|guarantee|Ctrl-X/i);
  });
});
