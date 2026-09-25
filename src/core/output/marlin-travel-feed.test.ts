// MA-8 (2026-09-25 controller audit): on stock Marlin every G0 runs at the last
// F the program set (G0_FEEDRATE is commented out, Configuration_adv.h:3721;
// gcode.cpp:213-214 sets the one modal feed from any move's F). KerfDesk timed
// Marlin G0 as a rapid at the profile's max feed while the bytes let it crawl
// at the cut feed. Adapted from src/__audit_repro__/MA/ma-8-g0-modal-feed.test.ts:
// the FIFO firmware model there is replaced by the same modal-feed rule
// applied line by line.

import { describe, expect, it } from 'vitest';
import { profileCatalogEntryById } from '../devices/profile-catalog';
import { estimateJobDuration, type Job } from '../job';
import { marlinStrategy } from './marlin-strategy';
import { withMarlinTravelFeed } from './marlin-travel-feed';

const SHORT_CUT_FAR_FROM_HOME: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'L1',
      color: '#ff0000',
      power: 50,
      speed: 300,
      passes: 1,
      airAssist: false,
      segments: [
        {
          polyline: [
            { x: 200, y: 200 },
            { x: 260, y: 200 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

type MarlinMove = { readonly motion: 'G0' | 'G1'; readonly feed: number; readonly mm: number };

/** Each move with the feed stock Marlin runs it at: the modal F, which any F
 *  on a G0 or G1 sets; power-on starts at DEFAULT_FEEDRATE_MM_M 4000
 *  (module/motion.cpp:131-134). */
function marlinMoves(program: string): MarlinMove[] {
  let feed = 4000;
  let x = 0;
  let y = 0;
  const moves: MarlinMove[] = [];
  for (const raw of program.split('\n')) {
    const line = raw.replace(/;.*$/, '').trim();
    const motion = /^G([01])\b/.exec(line)?.[1];
    if (motion === undefined) continue;
    feed = wordValue(line, 'F') ?? feed;
    const nextX = wordValue(line, 'X') ?? x;
    const nextY = wordValue(line, 'Y') ?? y;
    moves.push({ motion: `G${motion}` as 'G0' | 'G1', feed, mm: Math.hypot(nextX - x, nextY - y) });
    x = nextX;
    y = nextY;
  }
  return moves;
}

function wordValue(line: string, letter: string): number | undefined {
  const match = new RegExp(`\\b${letter}(-?\\d+(?:\\.\\d+)?)`).exec(line);
  return match === null ? undefined : Number(match[1]);
}

describe('MA-8: Marlin G0 carries its own feed', () => {
  const marlinProfile = profileCatalogEntryById('generic-marlin-laser')?.profile;
  if (marlinProfile === undefined) throw new Error('Generic Marlin profile missing');

  it('moves every G0 at the profile max feed and every burn at its cut feed', () => {
    const program = marlinStrategy.emit(SHORT_CUT_FAR_FROM_HOME, marlinProfile);
    expect(program).toMatch(/^G0 X200\.000 Y200\.000 F6000 S0$/m);
    expect(program).toMatch(/^G1 X260\.000 Y200\.000 F300 S\d+$/m);
    expect(program.trimEnd().split('\n').slice(-1)).toEqual(['G0 X0.000 Y0.000 F6000 S0']);
    for (const move of marlinMoves(program)) {
      expect(move.feed).toBe(move.motion === 'G0' ? marlinProfile.maxFeed : 300);
    }
  });

  it('keeps Job Review within reach of what Marlin runs', () => {
    const program = marlinStrategy.emit(SHORT_CUT_FAR_FROM_HOME, marlinProfile);
    const estimate = estimateJobDuration(SHORT_CUT_FAR_FROM_HOME, marlinProfile, {
      initialPosition: { x: 0, y: 0 },
    });
    expect(estimate.unavailableReason).toBeUndefined();
    // Cruise-only time is a lower bound for a real board (no acceleration).
    const marlinSeconds = marlinMoves(program).reduce((sum, m) => sum + (m.mm / m.feed) * 60, 0);
    // Before the fix: about 18.5 s estimated against about 82 s on Marlin.
    expect(marlinSeconds).toBeLessThan(estimate.totalSeconds * 1.25);
  });
});

describe('withMarlinTravelFeed', () => {
  it('adds the travel feed to G0 and restates the cut feed on the next move without one', () => {
    const body = [
      'G1 X1.000 Y0.000 F1200 S500',
      'G1 X2.000 Y0.000',
      'G0 X5.000 Y5.000 S0',
      'G1 X6.000 Y5.000 S500',
      'G1 X7.000 Y5.000',
      'G0 X0.000 Y0.000 S0',
    ].join('\n');
    expect(withMarlinTravelFeed(body, 6000).split('\n')).toEqual([
      'G1 X1.000 Y0.000 F1200 S500',
      'G1 X2.000 Y0.000',
      'G0 X5.000 Y5.000 F6000 S0',
      'G1 X6.000 Y5.000 F1200 S500',
      'G1 X7.000 Y5.000',
      'G0 X0.000 Y0.000 F6000 S0',
    ]);
  });

  it('leaves a move that states its own feed, and a laser-off comment, alone', () => {
    const body = [
      'G1 X1.000 Y0.000 F800 S0 ; kerfdesk:laser-off-motion',
      'G0 X5.000 Y5.000',
      'G1 X6.000 Y5.000 F1500 S500',
      'M5',
    ].join('\n');
    expect(withMarlinTravelFeed(body, 6000).split('\n')).toEqual([
      'G1 X1.000 Y0.000 F800 S0 ; kerfdesk:laser-off-motion',
      'G0 X5.000 Y5.000 F6000',
      'G1 X6.000 Y5.000 F1500 S500',
      'M5',
    ]);
  });
});
