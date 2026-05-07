/**
 * === FILE: /src/core/plan/FillGenerator.ts ===
 *
 * Purpose:    Generates scanline toolpaths for fill/engrave operations.
 *             Takes closed boundary paths and produces a set of parallel
 *             line segments that fill the interior of the shapes.
 *
 *             Algorithm:
 *             1. Rotate geometry by -angle (work in axis-aligned space)
 *             2. Compute bounding box
 *             3. Cast horizontal rays at `interval` spacing
 *             4. Find intersections with all polygon edges
 *             5. Sort intersections, pair with even-odd rule
 *             6. Create line segments between pairs
 *             7. Rotate segments back by +angle
 *             8. Apply overscanning extension
 *             9. Apply bidirectional alternation
 *
 * Dependencies:
 *             - /src/core/types.ts
 *             - /src/core/job/Job.ts (FlatPath)
 * Last updated: Phase 5, Step 18c — Fill scanline generation
 */

import { type Point } from '../types';
import { type FlatPath } from '../job/Job';
import { flatPathsFromCompoundPath } from '../job/CompoundPathOutput';
import { type CompoundPath } from '../geometry/CompoundPath';

// ─── PUBLIC TYPES ────────────────────────────────────────────────

export interface ScanlineSegment {
  from: Point;
  to: Point;
}

/** A single burn segment within a scanline row (actual boundary, no overscanning). */
export interface FillSegment {
  actualFrom: Point;
  actualTo: Point;
}

/**
 * One scanline row containing all burn segments and overscan motion boundaries.
 * The planner uses this to emit continuous G1 motion with inline S-value toggling:
 *   rapid(overscanFrom) → G1 S0(approach) → G1 S{power}(burn) → G1 S0(gap) → ... → G1 S0(exit to overscanTo)
 */
export interface FillScanlineRow {
  /** Ordered burn segments on this row (in traversal direction). */
  segments: FillSegment[];
  /** Start of machine motion including overscan (laser OFF). */
  overscanFrom: Point;
  /** End of machine motion including overscan (laser OFF). */
  overscanTo: Point;
}

export interface FillSettings {
  interval: number;         // mm between scanlines
  angle: number;            // degrees (0 = horizontal)
  biDirectional: boolean;
  overscanning: number;     // mm extension beyond boundary
}

// ─── PUBLIC API ──────────────────────────────────────────────────

/**
 * Generate scanline segments that fill the interior of closed paths.
 *
 * Returns an ordered list of ScanlineSegments. If bidirectional,
 * alternating segments run in opposite directions. Overscanning
 * extends each segment beyond the boundary.
 */
export function generateFillScanlines(
  paths: FlatPath[],
  settings: FillSettings,
  /** Continues serpentine parity across cross-hatch passes (second angle). */
  initialStripIndex: number = 0,
): ScanlineSegment[] {
  // Filter to closed paths only — open paths can't define a fill region
  const closed = paths.filter(p => p.closed);
  if (closed.length === 0) return [];

  const angleRad = (settings.angle * Math.PI) / 180;

  // Step 1: Collect all edges from all closed paths
  const edges = extractEdges(closed);

  // Step 2: Rotate edges by -angle (so we can scan horizontally)
  const rotatedEdges = edges.map(e => ({
    x1: e.x1 * Math.cos(-angleRad) - e.y1 * Math.sin(-angleRad),
    y1: e.x1 * Math.sin(-angleRad) + e.y1 * Math.cos(-angleRad),
    x2: e.x2 * Math.cos(-angleRad) - e.y2 * Math.sin(-angleRad),
    y2: e.x2 * Math.sin(-angleRad) + e.y2 * Math.cos(-angleRad),
  }));

  // Step 3: Compute bounding box of rotated geometry
  let minY = Infinity, maxY = -Infinity;
  for (const e of rotatedEdges) {
    minY = Math.min(minY, e.y1, e.y2);
    maxY = Math.max(maxY, e.y1, e.y2);
  }

  // Guard against extreme scanline counts from corrupt or tiny intervals
  const MIN_FILL_INTERVAL = 0.01; // mm — finer than any laser can achieve
  const MAX_SCANLINES = 50000;

  const rawInterval = Number(settings.interval);
  let safeInterval = Math.max(
    MIN_FILL_INTERVAL,
    Number.isFinite(rawInterval) && rawInterval > 0 ? rawInterval : 0.1,
  );

  const spanY = maxY - minY;
  const estimatedLines = spanY > 0 ? Math.ceil(spanY / safeInterval) : 0;
  if (estimatedLines > MAX_SCANLINES) {
    console.warn(
      `[FillGenerator] Interval ${safeInterval}mm would produce ${estimatedLines} scanlines. Clamping to ${MAX_SCANLINES}.`,
    );
    safeInterval = spanY / MAX_SCANLINES;
  }

  // Step 4: Generate scanlines
  const segments: ScanlineSegment[] = [];

  // Offset start by half-interval to avoid landing exactly on vertices
  const startY = minY + safeInterval / 2;
  let stripIndex = initialStripIndex;

  for (let y = startY; y < maxY; y += safeInterval) {
    // Step 4a: Find all intersections at this Y
    const intersections = findIntersections(rotatedEdges, y);

    if (intersections.length < 2) {
      continue;
    }

    // Step 4b: Sort by X
    intersections.sort((a, b) => a - b);

    // Step 4c: Pair using even-odd rule
    for (let i = 0; i < intersections.length - 1; i += 2) {
      let x1 = intersections[i];
      let x2 = intersections[i + 1];

      // Step 5: Apply overscanning (extend beyond boundary)
      x1 -= settings.overscanning;
      x2 += settings.overscanning;

      // Step 6: Rotate back to world coordinates
      const from = rotatePoint(x1, y, angleRad);
      const to = rotatePoint(x2, y, angleRad);

      // Step 7: Serpentine — alternate each burn segment (not empty Y rows)
      // TODO: Extra laser-off overscan past segment ends for cleaner bidirectional turnarounds
      if (settings.biDirectional && stripIndex % 2 === 1) {
        segments.push({ from: to, to: from });
      } else {
        segments.push({ from, to });
      }
      stripIndex++;
    }
  }

  return segments;
}

/**
 * Generate scanline rows for fill/engrave operations.
 *
 * Unlike generateFillScanlines (which bakes overscanning into the burn area),
 * this function returns rows with SEPARATE actual boundaries and overscan
 * motion boundaries. The planner uses this to emit:
 *   - Overscan approach: G1 S0 (motion with laser OFF)
 *   - Burn segments: G1 S{power} (laser ON within actual boundary)
 *   - Gaps between segments: G1 S0 (laser OFF)
 *   - Overscan exit: G1 S0 (motion with laser OFF)
 *
 * This matches how LightBurn handles overscanning on GRBL and is correct
 * per the GRBL laser mode spec: inline S-value changes don't cause motion
 * stops, so the machine maintains constant velocity across the entire row.
 */
export function generateFillRows(
  paths: FlatPath[],
  settings: FillSettings,
  initialRowIndex: number = 0,
): FillScanlineRow[] {
  const closed = paths.filter(p => p.closed);
  if (closed.length === 0) return [];

  const angleRad = (settings.angle * Math.PI) / 180;
  const edges = extractEdges(closed);

  const rotatedEdges = edges.map(e => ({
    x1: e.x1 * Math.cos(-angleRad) - e.y1 * Math.sin(-angleRad),
    y1: e.x1 * Math.sin(-angleRad) + e.y1 * Math.cos(-angleRad),
    x2: e.x2 * Math.cos(-angleRad) - e.y2 * Math.sin(-angleRad),
    y2: e.x2 * Math.sin(-angleRad) + e.y2 * Math.cos(-angleRad),
  }));

  let minY = Infinity, maxY = -Infinity;
  for (const e of rotatedEdges) {
    minY = Math.min(minY, e.y1, e.y2);
    maxY = Math.max(maxY, e.y1, e.y2);
  }

  const MIN_FILL_INTERVAL = 0.01;
  const MAX_SCANLINES = 50000;
  const rawInterval = Number(settings.interval);
  let safeInterval = Math.max(
    MIN_FILL_INTERVAL,
    Number.isFinite(rawInterval) && rawInterval > 0 ? rawInterval : 0.1,
  );
  const spanY = maxY - minY;
  const estimatedLines = spanY > 0 ? Math.ceil(spanY / safeInterval) : 0;
  if (estimatedLines > MAX_SCANLINES) {
    safeInterval = spanY / MAX_SCANLINES;
  }

  const rows: FillScanlineRow[] = [];
  const startY = minY + safeInterval / 2;
  let rowIndex = initialRowIndex;
  const os = Math.max(0, settings.overscanning);

  for (let y = startY; y < maxY; y += safeInterval) {
    const intersections = findIntersections(rotatedEdges, y);
    if (intersections.length < 2) continue;
    intersections.sort((a, b) => a - b);

    // Build segments from even-odd pairs (actual boundaries, no overscanning)
    const segs: FillSegment[] = [];
    for (let i = 0; i < intersections.length - 1; i += 2) {
      const x1 = intersections[i];
      const x2 = intersections[i + 1];
      segs.push({
        actualFrom: rotatePoint(x1, y, angleRad),
        actualTo: rotatePoint(x2, y, angleRad),
      });
    }
    if (segs.length === 0) continue;

    // Overscan extends beyond the first and last segment of the row
    const firstX = intersections[0];
    const lastX = intersections[intersections.length - 1 - ((intersections.length % 2 === 1) ? 1 : 0)];
    const osFrom = rotatePoint(firstX - os, y, angleRad);
    const osTo = rotatePoint(lastX + os, y, angleRad);

    // Bidirectional: alternate entire rows (not individual segments)
    const reversed = settings.biDirectional && rowIndex % 2 === 1;
    if (reversed) {
      // Reverse segment order and swap from/to within each segment
      const revSegs: FillSegment[] = [];
      for (let i = segs.length - 1; i >= 0; i--) {
        revSegs.push({
          actualFrom: segs[i].actualTo,
          actualTo: segs[i].actualFrom,
        });
      }
      rows.push({
        segments: revSegs,
        overscanFrom: osTo,   // start from the right side
        overscanTo: osFrom,   // end at the left side
      });
    } else {
      rows.push({
        segments: segs,
        overscanFrom: osFrom,
        overscanTo: osTo,
      });
    }
    rowIndex++;
  }

  return rows;
}

/**
 * T2-15 Pass 2: generate fill rows from CompoundPath inputs while keeping
 * each compound's edge pool isolated. This avoids unrelated overlapping
 * objects canceling each other out under one global even-odd pass.
 */
export function generateFillRowsForCompoundPaths(
  paths: readonly CompoundPath[],
  settings: FillSettings,
  initialRowIndex: number = 0,
): FillScanlineRow[] {
  const rows: FillScanlineRow[] = [];
  let rowIndex = initialRowIndex;

  for (const path of paths) {
    const compoundRows = generateFillRows(
      flatPathsFromCompoundPath(path).filter(flatPath => flatPath.closed),
      settings,
      rowIndex,
    );
    rows.push(...compoundRows);
    rowIndex += compoundRows.length;
  }

  return rows;
}

/**
 * Calculate the expected number of scanlines for a given set of
 * paths and interval. Used for progress estimation.
 */
export function estimateScanlineCount(
  paths: FlatPath[],
  interval: number,
  angle: number
): number {
  if (interval <= 0) return 0;

  const closed = paths.filter(p => p.closed);
  if (closed.length === 0) return 0;

  const angleRad = (angle * Math.PI) / 180;

  // Compute rotated bounding box height
  let minY = Infinity, maxY = -Infinity;
  for (const path of closed) {
    const n = path.coords.length / 2;
    for (let i = 0; i < n; i++) {
      const x = path.coords[i * 2];
      const y = path.coords[i * 2 + 1];
      const ry = x * Math.sin(-angleRad) + y * Math.cos(-angleRad);
      minY = Math.min(minY, ry);
      maxY = Math.max(maxY, ry);
    }
  }

  const spanY = maxY - minY;
  const MIN_FILL_INTERVAL = 0.01;
  const MAX_SCANLINES = 50000;
  let safeInterval = Math.max(MIN_FILL_INTERVAL, interval);
  const estimatedLines = spanY > 0 ? Math.ceil(spanY / safeInterval) : 0;
  if (estimatedLines > MAX_SCANLINES) {
    safeInterval = spanY / MAX_SCANLINES;
  }

  return Math.max(0, Math.floor(spanY / safeInterval));
}

// ─── EDGE EXTRACTION ─────────────────────────────────────────────

interface Edge {
  x1: number; y1: number;
  x2: number; y2: number;
}

/**
 * Extract all edges from closed FlatPaths.
 * Each consecutive pair of coordinates forms an edge.
 * The last point connects back to the first (closing edge).
 */
function extractEdges(paths: FlatPath[]): Edge[] {
  const edges: Edge[] = [];

  for (const path of paths) {
    const n = path.coords.length / 2;
    if (n < 2) continue;

    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;  // Wraps to first point for closing edge
      edges.push({
        x1: path.coords[i * 2],
        y1: path.coords[i * 2 + 1],
        x2: path.coords[j * 2],
        y2: path.coords[j * 2 + 1],
      });
    }
  }

  return edges;
}

// ─── RAY-EDGE INTERSECTION ───────────────────────────────────────

/**
 * Find all X-coordinates where a horizontal ray at height Y
 * intersects the given edges.
 *
 * Uses standard line-segment intersection with a horizontal line.
 * Handles edge cases:
 * - Horizontal edges are skipped (they don't produce crossings)
 * - Vertices are counted once (not double-counted at edge joints)
 */
function findIntersections(edges: Edge[], y: number): number[] {
  const intersections: number[] = [];

  for (const edge of edges) {
    const { y1, y2 } = edge;

    // Skip horizontal edges — they don't contribute crossings
    if (y1 === y2) continue;

    // Check if Y is within the edge's Y range
    // Use strict inequality on one end to avoid double-counting vertices
    const yMin = Math.min(y1, y2);
    const yMax = Math.max(y1, y2);

    if (y < yMin || y >= yMax) continue;

    // Compute X at intersection via linear interpolation
    const t = (y - y1) / (y2 - y1);
    const x = edge.x1 + t * (edge.x2 - edge.x1);
    intersections.push(x);
  }

  return intersections;
}

// ─── ROTATION ────────────────────────────────────────────────────

/**
 * Rotate a point by angle (radians) around the origin.
 */
function rotatePoint(x: number, y: number, angleRad: number): Point {
  return {
    x: x * Math.cos(angleRad) - y * Math.sin(angleRad),
    y: x * Math.sin(angleRad) + y * Math.cos(angleRad),
  };
}
