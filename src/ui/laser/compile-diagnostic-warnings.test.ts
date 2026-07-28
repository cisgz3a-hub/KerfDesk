import { describe, expect, it } from 'vitest';

import type { Job } from '../../core/job';
import { compileDiagnosticWarnings } from './compile-diagnostic-warnings';

describe('compileDiagnosticWarnings', () => {
  it('surfaces a precision-collapsed fill as an advisory Job Review warning', () => {
    const job: Job = {
      groups: [],
      diagnostics: [{ kind: 'fill-collapsed-at-precision', layerName: 'Micro Fill' }],
    };

    expect(compileDiagnosticWarnings(job)).toEqual([
      'Fill on layer "Micro Fill" is missing from the job because every hatch sweep rounds to a stationary point at emitted G-code precision. Check the preview, and enlarge the artwork or use a Line operation if this microscopic detail must remain visible.',
    ]);
  });

  it('names a capped Follow Shape fill without promising a fill-only outline cut', () => {
    const job: Job = {
      groups: [],
      diagnostics: [{ kind: 'offset-fill-pass-limit', layerName: 'Fill Only', passLimit: 2000 }],
    };

    const [warning] = compileDiagnosticWarnings(job);

    expect(warning).toContain('Follow Shape on layer "Fill Only"');
    expect(warning).toContain('2000 inward-offset levels');
    expect(warning).toContain('usable interior remained');
    expect(warning).toContain('some remaining interior fill is missing');
    expect(warning).not.toContain('outline still cuts');
  });

  it('adds no warning when compilation has no diagnostic', () => {
    expect(compileDiagnosticWarnings({ groups: [] })).toEqual([]);
  });
});
