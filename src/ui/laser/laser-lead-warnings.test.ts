import { describe, expect, it } from 'vitest';
import { laserLeadWarnings } from './laser-lead-warnings';

describe('laser lead warnings (ADR-626)', () => {
  it('says once per operation what perforation, tabs and fitting did to its leads', () => {
    const warnings = laserLeadWarnings([
      { kind: 'laser-leads-tabbed', layerId: 'cut', layerName: 'Cut', count: 1 },
      { kind: 'laser-leads-tabbed', layerId: 'cut', layerName: 'Cut', count: 2 },
      { kind: 'laser-leads-adjusted', layerId: 'cut', layerName: 'Cut', shortened: 1, omitted: 0 },
      { kind: 'laser-leads-adjusted', layerId: 'cut', layerName: 'Cut', shortened: 1, omitted: 1 },
      { kind: 'laser-leads-perforated', layerId: 'score', layerName: 'Score' },
      { kind: 'laser-leads-perforated', layerId: 'score', layerName: 'Score' },
    ]);
    expect(warnings).toEqual([
      'Lead-in/lead-out on layer "Cut": 3 shapes with tabs get no leads. A tabbed shape starts and stops at its tabs, where the edge is broken anyway.',
      'Lead-in/lead-out on layer "Cut": 2 shapes get a shorter lead and 1 shape gets no lead-in or no lead-out on at least one pass, because a full lead there would leave the scrap side, come too close to another cut line or run off the bed. Check the preview. Where a lead is missing, that shape starts or stops on its edge, as with leads off.',
      'Lead-in/lead-out on layer "Score" is not used: perforation cuts every line as dashes, so there is no closed shape to lead into.',
    ]);
  });

  it('keeps two operations that share a name apart', () => {
    const warnings = laserLeadWarnings([
      { kind: 'laser-leads-tabbed', layerId: 'a:sub-1', layerName: 'Sub-layer 1', count: 1 },
      { kind: 'laser-leads-tabbed', layerId: 'b:sub-1', layerName: 'Sub-layer 1', count: 4 },
    ]);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('1 shape with tabs gets');
    expect(warnings[1]).toContain('4 shapes with tabs get');
  });
});
