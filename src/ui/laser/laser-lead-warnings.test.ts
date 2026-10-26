import { describe, expect, it } from 'vitest';
import { laserLeadWarnings } from './laser-lead-warnings';

describe('laser lead warnings (ADR-626)', () => {
  it('says once per operation what perforation, tabs and fitting did to its leads', () => {
    const warnings = laserLeadWarnings([
      { kind: 'laser-leads-tabbed', layerId: 'cut', layerName: 'Cut', count: 1 },
      { kind: 'laser-leads-tabbed', layerId: 'cut', layerName: 'Cut', count: 2 },
      { kind: 'laser-leads-adjusted', layerId: 'cut', layerName: 'Cut', shortened: 1, omitted: 0 },
      { kind: 'laser-leads-adjusted', layerId: 'cut', layerName: 'Cut', shortened: 1, omitted: 1 },
      { kind: 'laser-leads-perforated', layerId: 'score', layerName: 'Score', count: 1 },
      { kind: 'laser-leads-perforated', layerId: 'score', layerName: 'Score', count: 2 },
    ]);
    expect(warnings).toEqual([
      'Lead-in/lead-out on layer "Cut": 3 shapes with tabs get no leads. A tabbed shape starts and stops at its tabs, where the edge is broken anyway.',
      'Lead-in/lead-out on layer "Cut": 2 shapes get a shorter lead and 1 shape gets no lead-in or no lead-out on at least one pass, because a full lead there would leave the scrap side, come too close to another cut line or run off the bed. Check the preview. Where a lead is missing, that shape starts or stops on its edge, as with leads off.',
      'Lead-in/lead-out on layer "Score": 3 shapes with perforation get no leads. Perforation cuts the line as dashes, so there is no closed shape to lead into.',
    ]);
  });

  it('says which operations leave the scrap side unknown, each on its own, and how to settle it', () => {
    const warnings = laserLeadWarnings([
      {
        kind: 'laser-leads-side-unknown',
        layerId: 'cut',
        layerName: 'Cut',
        count: 1,
        aroundName: 'Score',
      },
      {
        kind: 'laser-leads-side-unknown',
        layerId: 'cut',
        layerName: 'Cut',
        count: 2,
        aroundName: 'Border',
      },
    ]);
    expect(warnings).toEqual([
      'Lead-in/lead-out on layer "Cut": 1 shape inside a closed shape on layer "Score", which has no leads, gets no leads. That shape may be a part, or only a score line or border, so which side is scrap is unknown. Turn on leads for "Score" if it cuts parts out, or set Lead side to Always outside or Always inside.',
      'Lead-in/lead-out on layer "Cut": 2 shapes inside a closed shape on layer "Border", which has no leads, get no leads. That shape may be a part, or only a score line or border, so which side is scrap is unknown. Turn on leads for "Border" if it cuts parts out, or set Lead side to Always outside or Always inside.',
    ]);
  });

  it('says to close the outline when open lines close round a shape (ADR-626 Amd 8)', () => {
    const warnings = laserLeadWarnings([
      {
        kind: 'laser-leads-side-unknown',
        layerId: 'cut',
        layerName: 'Cut',
        count: 1,
        aroundName: 'Cut',
      },
      {
        kind: 'laser-leads-side-unknown',
        layerId: 'cut',
        layerName: 'Cut',
        count: 2,
        aroundName: 'Cut',
        aroundOpenPaths: true,
      },
    ]);
    expect(warnings).toEqual([
      'Lead-in/lead-out on layer "Cut": 1 shape inside a closed shape on layer "Cut", which has no leads, gets no leads. That shape may be a part, or only a score line or border, so which side is scrap is unknown. Turn on leads for "Cut" if it cuts parts out, or set Lead side to Always outside or Always inside.',
      'Lead-in/lead-out on layer "Cut": 2 shapes inside open lines on layer "Cut" get no leads. Those lines close round them but are not one closed shape, so they may be the outline of a part, and which side is scrap is unknown. Close the outline with Tools > Join paths, or set Lead side to Always outside or Always inside.',
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
