/**
 * T2-19: burn-bounds analyzer test helper. Built on top of T2-18's
 * semantic parser. The parser produces a flat move list with derived
 * `laserOn` flags and per-move `fromXY/toXY`; this analyzer walks
 * that list to produce the actionable derivations tests need:
 *
 *   - tight burnBounds (only moves where the laser was actually firing)
 *   - tight rapidBounds (G0 moves)
 *   - tight totalBounds (any motion)
 *   - per-segment burn / rapid lists with start, end, power, feed
 *   - overscanRegions: contiguous laser-off motion on G1/G2/G3 (i.e.
 *     not rapid, but laser is off — typical raster gap-bridges or
 *     fill overscan)
 *   - distance totals (burn + rapid)
 *   - laserOnTime estimate based on feed × distance per burn segment
 *   - mid-job laser-off events (M5 emitted between motion lines —
 *     surfaces unexpected laser cuts during a single operation)
 *
 * Tests built on this can pin "the job burns within rectangle X×Y",
 * "frame and burn cover the same area", "no surprise overscan
 * outside the declared region", and other contracts that pure
 * substring matching (or even per-move scanning) cannot express.
 *
 * Pure function. Lives under `tests/helpers/` so the auto-discovery
 * runner skips it.
 */

import type { ParsedGcode, ParsedMove } from './parseGcode';
import type { AABB } from '../../src/core/types';

export interface XY { x: number; y: number }

export interface BurnSegment {
  fromXY: XY;
  toXY: XY;
  power: number;
  feed: number | null;
  /** Index into `parsed.moves` for traceback. */
  lineIndex: number;
}

export interface RapidSegment {
  fromXY: XY;
  toXY: XY;
  lineIndex: number;
}

/**
 * A region of contiguous G1/G2/G3 motion with the laser OFF (S=0 or
 * laserMode='off'). Typical sources: raster gap-bridges between burn
 * segments, fill overscan approach/exit, programmed S=0 dwell. Tests
 * use this to verify motion outside the declared burn area is bounded.
 */
export interface OverscanRegion {
  bounds: AABB;
  /** Distance traveled in this region in mm. */
  distance: number;
  /** Indices into `parsed.moves` covered by this region. */
  lineIndices: number[];
}

export interface MidJobLaserOff {
  lineIndex: number;
  position: XY;
}

export interface BurnAnalysis {
  burnSegments: BurnSegment[];
  rapidSegments: RapidSegment[];
  burnBounds: AABB;
  rapidBounds: AABB;
  totalBounds: AABB;
  overscanRegions: OverscanRegion[];
  totalDistanceBurn: number;
  totalDistanceRapid: number;
  /** Estimate in seconds: sum of (segmentDistance / feed) across burn
   *  segments. Returns 0 if any burn segment has no feed declared
   *  (the test should know to declare feeds before relying on time
   *  estimates). */
  laserOnTime: number;
  midJobLaserOff: MidJobLaserOff[];
}

const EMPTY_AABB: AABB = {
  minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity,
};

function copyAABB(a: AABB): AABB {
  return { minX: a.minX, minY: a.minY, maxX: a.maxX, maxY: a.maxY };
}

function expandAABB(a: AABB, x: number, y: number): void {
  if (x < a.minX) a.minX = x;
  if (x > a.maxX) a.maxX = x;
  if (y < a.minY) a.minY = y;
  if (y > a.maxY) a.maxY = y;
}

function distance(a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function analyzeBurnBounds(parsed: ParsedGcode): BurnAnalysis {
  const burnSegments: BurnSegment[] = [];
  const rapidSegments: RapidSegment[] = [];
  const burnBounds = copyAABB(EMPTY_AABB);
  const rapidBounds = copyAABB(EMPTY_AABB);
  const totalBounds = copyAABB(EMPTY_AABB);
  const overscanRegions: OverscanRegion[] = [];
  let totalDistanceBurn = 0;
  let totalDistanceRapid = 0;
  let laserOnTime = 0;
  let laserOnTimeValid = true;
  const midJobLaserOff: MidJobLaserOff[] = [];

  let currentOverscan: OverscanRegion | null = null;
  function flushOverscan(): void {
    if (currentOverscan && currentOverscan.lineIndices.length > 0) {
      overscanRegions.push(currentOverscan);
    }
    currentOverscan = null;
  }

  // Walk moves; the parser already populated modalBefore/modalAfter
  // and the derived `laserOn` flag for motion lines. We just classify.
  // An M5 is "mid-job" only if a later burn move follows it — the
  // trailing job-end M5 is the safe-state default and must not surface
  // as an event. We collect candidates as we go, then promote them
  // when we see a subsequent burn move.
  let lastMotionLaserOn: boolean | null = null;
  const pendingLaserOff: MidJobLaserOff[] = [];
  for (const move of parsed.moves) {
    if (move.type === 'modal' && move.modalAfter.laserMode === 'off' &&
        move.modalBefore.laserMode !== 'off' && lastMotionLaserOn === true) {
      pendingLaserOff.push({
        lineIndex: move.lineIndex,
        position: { x: move.modalAfter.position.x, y: move.modalAfter.position.y },
      });
    }

    if (move.type !== 'rapid' && move.type !== 'cut' && move.type !== 'arc') {
      continue;
    }
    if (!move.fromXY || !move.toXY) continue;

    expandAABB(totalBounds, move.toXY.x, move.toXY.y);
    expandAABB(totalBounds, move.fromXY.x, move.fromXY.y);

    const dist = distance(move.fromXY, move.toXY);

    if (move.type === 'rapid') {
      rapidSegments.push({ fromXY: { ...move.fromXY }, toXY: { ...move.toXY }, lineIndex: move.lineIndex });
      expandAABB(rapidBounds, move.toXY.x, move.toXY.y);
      expandAABB(rapidBounds, move.fromXY.x, move.fromXY.y);
      totalDistanceRapid += dist;
      flushOverscan();
      continue;
    }

    // cut / arc
    if (move.laserOn === true) {
      const power = move.modalAfter.spindle;
      const feed = move.feed ?? move.modalAfter.feed ?? null;
      burnSegments.push({
        fromXY: { ...move.fromXY },
        toXY: { ...move.toXY },
        power,
        feed,
        lineIndex: move.lineIndex,
      });
      expandAABB(burnBounds, move.toXY.x, move.toXY.y);
      expandAABB(burnBounds, move.fromXY.x, move.fromXY.y);
      totalDistanceBurn += dist;
      // Time estimate: feed is mm/min; convert to seconds. If any
      // segment has no feed, mark the totalTime as invalid (returns 0).
      if (feed != null && feed > 0) {
        laserOnTime += (dist / feed) * 60;
      } else {
        laserOnTimeValid = false;
      }
      lastMotionLaserOn = true;
      // A burn fired AFTER the pending M5(s) — promote them all to
      // real mid-job events.
      for (const e of pendingLaserOff) midJobLaserOff.push(e);
      pendingLaserOff.length = 0;
      flushOverscan();
    } else {
      // G1/G2/G3 with laser off — overscan / gap-bridge motion.
      lastMotionLaserOn = false;
      if (!currentOverscan) {
        currentOverscan = {
          bounds: copyAABB(EMPTY_AABB),
          distance: 0,
          lineIndices: [],
        };
      }
      expandAABB(currentOverscan.bounds, move.toXY.x, move.toXY.y);
      expandAABB(currentOverscan.bounds, move.fromXY.x, move.fromXY.y);
      currentOverscan.distance += dist;
      currentOverscan.lineIndices.push(move.lineIndex);
    }
  }
  flushOverscan();

  return {
    burnSegments,
    rapidSegments,
    burnBounds,
    rapidBounds,
    totalBounds,
    overscanRegions,
    totalDistanceBurn,
    totalDistanceRapid,
    laserOnTime: laserOnTimeValid ? laserOnTime : 0,
    midJobLaserOff,
  };
}
