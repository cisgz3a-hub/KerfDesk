// Code quality audit C2, D3 (test strength), mutant R10: every image row after
// the first opens with a controlled laser-off seek, `G1 … F<travel> S0`. On a
// dialect with modal F the row's burns inherit that travel feed unless the
// sweep writes the layer feed again on its first burn. This reads the program
// as a modal-F controller would and checks the feed of every lit move.
import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { DeviceProfile } from '../devices';
import type { Job } from '../job';
import { grblStrategy } from '../output/grbl-strategy';

const LAYER_FEED = 3000;
const TRAVEL_FEED = 800;

const threeRowImage: Job = {
  groups: [
    {
      kind: 'raster',
      layerId: 'image',
      color: '#000000',
      power: 50,
      speed: LAYER_FEED,
      passes: 1,
      airAssist: false,
      sValues: new Uint16Array([500, 500, 500, 500, 500, 500, 500, 500, 500]),
      pixelWidth: 3,
      pixelHeight: 3,
      bounds: { minX: 0, minY: 0, maxX: 3, maxY: 3 },
      overscanMm: 0,
      dotWidthCorrectionMm: 0,
    },
  ],
};

type Move = { readonly line: string; readonly feed: number | null; readonly power: number };

/** Every G1 move with the feed and power it runs at, read with modal G0/G1, F
 *  and S. Words may be packed (`X3F3000S500`), as compact output writes them. */
function feedMoves(gcode: string): Move[] {
  let motion: number | null = null;
  let feed: number | null = null;
  let power = 0;
  const moves: Move[] = [];
  for (const raw of gcode.split('\n')) {
    const line = raw.replace(/;.*$/, '').trim();
    let moved = false;
    for (const [, letter, value] of line.matchAll(/([A-Z])(-?\d*\.?\d+)/g)) {
      const n = Number(value);
      if (letter === 'G' && (n === 0 || n === 1)) motion = n;
      else if (letter === 'F') feed = n;
      else if (letter === 'S') power = n;
      else if (letter === 'X' || letter === 'Y') moved = true;
    }
    if (moved && motion === 1) moves.push({ line, feed, power });
  }
  return moves;
}

describe('image rows after a controlled laser-off seek (C2 D3, R10)', () => {
  it('burns every row at the layer feed on a modal-F GRBL 1.1 profile', () => {
    const profile: DeviceProfile = {
      ...DEFAULT_DEVICE_PROFILE,
      controllerKind: 'grbl-v1.1',
      controlledLaserOffTravelFeedMmPerMin: TRAVEL_FEED,
    };
    const moves = feedMoves(grblStrategy.emit(threeRowImage, profile));
    const lit = moves.filter((move) => move.power > 0);

    // The fixture must exercise what the guard protects: a controlled G1 S0
    // seek at the travel feed opens each of the three rows.
    const seeks = moves.filter((move) => move.power === 0 && move.feed === TRAVEL_FEED);
    expect(seeks.length).toBeGreaterThanOrEqual(3);
    expect(lit).toHaveLength(3);
    expect(lit.map((move) => move.feed)).toEqual([LAYER_FEED, LAYER_FEED, LAYER_FEED]);
  });
});
