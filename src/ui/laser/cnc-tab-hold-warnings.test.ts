import { describe, expect, it } from 'vitest';
import type { Job } from '../../core/job';
import type { CncTabHoldShape } from '../../core/job/cnc-compilation-sidecar-types';
import { cncTabHoldWarnings, layersWithNeverThroughLoops } from './cnc-tab-hold-warnings';

// ADR-258 Amendment 5: one line per layer and kind, naming the shapes by size.

function shape(overrides: Partial<CncTabHoldShape>): CncTabHoldShape {
  return {
    layerId: 'L1',
    layerName: 'Cut out',
    kind: 'fewer-tabs',
    role: 'hole',
    widthMm: 8,
    heightMm: 8,
    tabsSet: 4,
    tabsCut: 1,
    tabWidthMm: 6,
    cutWidthMm: 3.175,
    ...overrides,
  };
}

function job(tabHoldShapes: ReadonlyArray<CncTabHoldShape>): Job {
  return { groups: [], cncCompilation: { vcarveOperations: [], tabHoldShapes } };
}

describe('cncTabHoldWarnings', () => {
  it('says how many tabs small loops got instead of the set count', () => {
    const warnings = cncTabHoldWarnings(
      job([shape({}), shape({ widthMm: 12, heightMm: 12, tabsCut: 2 })]),
    );

    expect(warnings).toEqual([
      'Layer "Cut out": 2 holes (8 × 8 mm, 12 × 12 mm) are too small for 4 tabs of 6 mm beside ' +
        'the 3.2 mm cut, so each gets 1 to 2 tabs, as many as still let them cut through.',
    ]);
  });

  it('names the narrowest bridge a turning outline leaves', () => {
    const [warning] = cncTabHoldWarnings(
      job([shape({ kind: 'narrow-bridge', role: 'part', tabsCut: 3, bridgeMm: 1.43 })]),
    );

    expect(warning).toContain('the tabs on 1 part (8 × 8 mm) hold by as little as 1.4 mm');
    expect(warning).toContain('Edit positions');
  });

  it('tells an open outline to close itself, since it has no tab handles (ADR-258 Amd 8)', () => {
    const [warning] = cncTabHoldWarnings(
      job([
        shape({
          kind: 'narrow-bridge',
          role: 'part',
          tabsCut: 4,
          bridgeMm: 0.4,
          openOutline: true,
        }),
      ]),
    );

    expect(warning).toContain('Close the open outline with Tools > Join paths');
    expect(warning).not.toContain('Edit positions');
  });

  it('says an open outline the bit closes is tabbed as a closed shape', () => {
    const [warning] = cncTabHoldWarnings(
      job([shape({ kind: 'closed-gap', role: 'part', widthMm: 80, heightMm: 60, tabsCut: 4 })]),
    );

    expect(warning).toContain('1 open outline (80 × 60 mm) ends so close to its start that the');
    expect(warning).toContain('Join paths');
  });

  it('puts never-through shapes first, lists three sizes, and counts the rest', () => {
    const never = [5, 4, 3, 2].map((size) =>
      shape({ kind: 'never-through', widthMm: size, heightMm: size, tabsCut: 0 }),
    );
    const warnings = cncTabHoldWarnings(job([shape({}), ...never]));

    expect(warnings[0]).toContain('4 holes (5 × 5 mm, 4 × 4 mm, 3 × 3 mm and 1 more)');
    expect(warnings[0]).toContain('NOT cut through');
    expect(layersWithNeverThroughLoops(job(never))).toEqual(new Set(['L1']));
  });

  it('says nothing for a job without the evidence', () => {
    expect(cncTabHoldWarnings({ groups: [] })).toEqual([]);
  });
});
