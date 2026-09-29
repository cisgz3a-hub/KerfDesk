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

  // ADR-486 amendment 1 (weakness audit E-4).
  it('says a hole the kerf offset closed up is missing and will not be cut', () => {
    const [warning] = compileDiagnosticWarnings({
      groups: [],
      diagnostics: [
        { kind: 'kerf-offset-closed-up', layerName: 'Cut', count: 1, kerfOffsetMm: 0.15 },
      ],
    });

    expect(warning).toBe(
      'Kerf offset on layer "Cut" closed up 1 hole or slot narrower than the 0.3 mm kerf (twice its Kerf Offset), so it is missing from the job and will NOT be cut. Check the preview before running, and widen it or use a smaller kerf offset.',
    );
  });

  it('names parts when a negative kerf offset shrinks them to nothing', () => {
    const [warning] = compileDiagnosticWarnings({
      groups: [],
      diagnostics: [
        { kind: 'kerf-offset-closed-up', layerName: 'Inlay', count: 2, kerfOffsetMm: -0.1 },
      ],
    });

    expect(warning).toContain('shrank 2 parts narrower than the 0.2 mm kerf');
    expect(warning).toContain('they are missing from the job');
    expect(warning).toContain('a kerf offset closer to 0');
  });

  it('gives one line per layer for holes closed up in objects compiled apart', () => {
    const warnings = compileDiagnosticWarnings({
      groups: [],
      diagnostics: [
        { kind: 'kerf-offset-closed-up', layerName: 'Cut', count: 1, kerfOffsetMm: 0.15 },
        { kind: 'kerf-offset-failed', layerName: 'Cut' },
        { kind: 'kerf-offset-closed-up', layerName: 'Cut', count: 2, kerfOffsetMm: 0.15 },
        { kind: 'kerf-offset-closed-up', layerName: 'Score', count: 1, kerfOffsetMm: 0.15 },
      ],
    });

    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain('layer "Cut" closed up 3 holes or slots');
    expect(warnings[1]).toContain('could not be generated');
    expect(warnings[2]).toContain('layer "Score" closed up 1 hole or slot narrower');
  });

  it('adds no warning when compilation has no diagnostic', () => {
    expect(compileDiagnosticWarnings({ groups: [] })).toEqual([]);
  });

  it('names a skipped raster whose luma dimensions do not match', () => {
    const [warning] = compileDiagnosticWarnings({
      groups: [],
      diagnostics: [
        {
          kind: 'raster-source-luma-mismatch',
          layerName: 'Photo Engrave',
          source: 'portrait.png',
          expectedPixels: 16,
          actualPixels: 15,
        },
      ],
    });

    expect(warning).toContain('Image "portrait.png" on layer "Photo Engrave"');
    expect(warning).toContain('15 samples');
    expect(warning).toContain('require 16');
    expect(warning).toContain('missing from the job');
  });
});
