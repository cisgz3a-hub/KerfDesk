import { describe, expect, it } from 'vitest';
import type { CncGroup, Job } from '../job';
import { findCncSecondaryToolFeedIssues } from './cnc-secondary-tool-feed';

function group(overrides: Partial<CncGroup> = {}): CncGroup {
  return {
    kind: 'cnc',
    layerId: 'L1',
    color: '#ff0000',
    cutType: 'pocket',
    toolId: 'clear-6mm',
    toolName: '6 mm clearing bit',
    toolDiameterMm: 6,
    layerPrimaryToolId: 'vbit-3mm',
    feedMmPerMin: 150,
    plungeMmPerMin: 120,
    spindleRpm: 10_000,
    spindleSpinupSec: 3,
    depthPerPassMm: 0.5,
    safeZMm: 3.81,
    passes: [
      {
        kind: 'contour',
        zMm: -0.5,
        closed: true,
        polyline: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 0 },
        ],
      },
    ],
    ...overrides,
  };
}

describe('secondary CNC cutter feed advisories', () => {
  it('reports exact shared values when a compiled group uses a secondary cutter', () => {
    const issues = findCncSecondaryToolFeedIssues({ groups: [group()] });

    expect(issues).toEqual([
      {
        code: 'cnc-secondary-tool-feed-retained',
        message: expect.stringMatching(
          /Layer L1.*6 mm clearing bit.*vbit-3mm.*150 mm\/min.*120 mm\/min.*10000 RPM.*0.5 mm\/pass/i,
        ),
      },
    ]);
  });

  it('stays silent for the primary tool and deduplicates repeated secondary groups', () => {
    const primary = group({ toolId: 'vbit-3mm' });
    const secondary = group();
    const job: Job = { groups: [primary, secondary, secondary] };

    expect(findCncSecondaryToolFeedIssues(job)).toHaveLength(1);
    expect(findCncSecondaryToolFeedIssues({ groups: [primary] })).toEqual([]);
  });

  it('does not claim depth/pass for a secondary operation that does not use it', () => {
    const { depthPerPassMm: _omitted, ...finishing } = group({ cutType: 'relief-finish' });
    const [issue] = findCncSecondaryToolFeedIssues({
      groups: [finishing],
    });

    expect(issue?.message).toContain('150 mm/min, plunge 120 mm/min, 10000 RPM');
    expect(issue?.message).not.toContain('mm/pass');
  });

  it('does not collapse operations with different depth-per-pass applicability', () => {
    const { depthPerPassMm: _omitted, ...finishing } = group({ cutType: 'relief-finish' });
    const issues = findCncSecondaryToolFeedIssues({ groups: [finishing, group()] });

    expect(issues).toHaveLength(2);
    expect(issues[0]?.message).not.toContain('mm/pass');
    expect(issues[1]?.message).toContain('0.5 mm/pass');
  });
});
