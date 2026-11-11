// What a Moshiboard cannot express, named per job (ADR-705 Amendment 4, code
// quality audit C2 D2-P2-2, D2-P3-3).
import { describe, expect, it } from 'vitest';
import type { CutGroup, Job } from '../../job';
import { moshiPowerNotes } from './moshi-power-notes';

function cut(overrides: Partial<CutGroup> = {}): CutGroup {
  return {
    kind: 'cut',
    layerId: 'Cut',
    color: '#f00',
    power: 80,
    speed: 1200,
    passes: 1,
    airAssist: false,
    segments: [
      {
        polyline: [
          { x: 10, y: 10 },
          { x: 50, y: 10 },
        ],
        closed: false,
      },
    ],
    ...overrides,
  };
}

const job = (...groups: CutGroup[]): Job => ({ groups });

describe('moshiPowerNotes', () => {
  it('says nothing for one layer at one power with no air', () => {
    expect(moshiPowerNotes(job(cut()))).toEqual([]);
  });

  it('names burned tabs, which cut through at dial power', () => {
    const notes = moshiPowerNotes(job(cut(), cut({ power: 16, tabSpanPowerPercent: 20 })));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('burned tabs are set to 20 %');
    expect(notes[0]).toContain('cut through');
  });

  it('names layers of different power, which all burn at dial power', () => {
    const notes = moshiPowerNotes(job(cut({ layerId: 'Score', power: 10 }), cut()));
    expect(notes).toEqual([expect.stringContaining('10 %, 80 % power')]);
  });

  it('names layers asking for air, which the board cannot switch', () => {
    expect(moshiPowerNotes(job(cut({ airAssist: true })))).toEqual([
      expect.stringContaining('Air assist is on for layer Cut'),
    ]);
  });
});
