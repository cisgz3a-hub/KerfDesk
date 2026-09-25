// Marlin travel feed (2026-09-25 controller audit, MA-8).
//
// Stock Marlin has no separate rapid rate. G0_FEEDRATE is commented out
// (Marlin 2.1.2.8 Configuration_adv.h:3721 `//#define G0_FEEDRATE 3000`), every
// G0-specific branch of G0_G1() sits under `#ifdef G0_FEEDRATE`
// (gcode/motion/G0_G1.cpp:47-73), and an F word on any move sets the one modal
// feed rate (gcode.cpp:213-214, get_destination_from_command()). So a bare G0
// runs at the last cut's feed, and the first one at whatever a Frame, a jog or
// power-on (DEFAULT_FEEDRATE_MM_M 4000) left modal.
//
// Each Marlin G0 therefore carries its own F: the profile's maximum feed, which
// is the rate the job estimate times rapids at, so the two agree. The next move
// that relies on the modal feed gets the cut feed restated. A build that does
// define G0_FEEDRATE (without VARIABLE_G0_FEEDRATE) still keeps the G0's F as
// the modal feed afterwards (G0_G1.cpp:62-71 backs it up after
// get_destination_from_command()), so the restatement is needed there too.

import { effectiveGcodeFeedMmPerMin, formatGcodeFeedMmPerMin } from '../gcode/feed-word';

const TRAVEL = /^G0\b/;
const FEED_MOTION = /^G[123]\b/;
const FEED_WORD = /\bF(\d+(?:\.\d+)?)/;

/** Give every G0 in a verbose GRBL-shaped body its own F, and restate the
 *  cut feed on the first feed move after it that has none. */
export function withMarlinTravelFeed(body: string, travelFeedMmPerMin: number): string {
  const travelFeedWord = `F${formatGcodeFeedMmPerMin(effectiveGcodeFeedMmPerMin(travelFeedMmPerMin))}`;
  let cutFeedWord: string | null = null;
  let feedIsTravel = false;
  return body
    .split('\n')
    .map((line) => {
      if (TRAVEL.test(line)) {
        feedIsTravel = true;
        return feedWordOf(line) === null ? withFeedWord(line, travelFeedWord) : line;
      }
      if (!FEED_MOTION.test(line)) return line;
      const own = feedWordOf(line);
      if (own !== null) {
        cutFeedWord = own;
        feedIsTravel = false;
        return line;
      }
      if (!feedIsTravel || cutFeedWord === null) return line;
      feedIsTravel = false;
      return withFeedWord(line, cutFeedWord);
    })
    .join('\n');
}

function feedWordOf(line: string): string | null {
  const code = line.replace(/;.*$/, '');
  const match = FEED_WORD.exec(code);
  return match === null ? null : `F${match[1] ?? ''}`;
}

// Before the power word or a trailing comment, where the emitter writes F.
function withFeedWord(line: string, feedWord: string): string {
  const at = / S-?\d| ;/.exec(line);
  if (at === null) return `${line} ${feedWord}`;
  return `${line.slice(0, at.index)} ${feedWord}${line.slice(at.index)}`;
}
