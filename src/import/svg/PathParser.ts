/**
 * === FILE: /src/import/svg/PathParser.ts ===
 *
 * Purpose:    Parse SVG path "d" attribute into PathGeometry.
 *
 *             Supported commands:
 *               M/m  moveto          (x y)+
 *               L/l  lineto          (x y)+
 *               H/h  horizontal      x+
 *               V/v  vertical        y+
 *               C/c  cubic bezier    (x1 y1 x2 y2 x y)+
 *               S/s  smooth cubic    (x2 y2 x y)+
 *               Q/q  quadratic       (x1 y1 x y)+
 *               T/t  smooth quad     (x y)+
 *               A/a  arc             (rx ry rot large sweep x y)+
 *               Z/z  close
 *
 *             Handles:
 *             - Uppercase (absolute) and lowercase (relative)
 *             - Implicit repeated commands
 *             - Smooth curve reflected control points
 *             - Arcs approximated as cubic beziers
 *
 * Dependencies: /src/core/scene/SceneObject.ts (PathGeometry, SubPath, PathSegment)
 * Last updated: SVG Import feature
 */

import {
  type PathGeometry,
  type SubPath,
  type PathSegment,
} from '../../core/scene/SceneObject';
import { assertSvgLimit } from './SvgComplexityLimits';

export interface SvgPathParseWarning {
  code: 'SVG_PATH_MALFORMED';
  command: string;
  message: string;
}

export interface ParsePathDataOptions {
  onWarning?: (warning: SvgPathParseWarning) => void;
}

// ─── PUBLIC API ──────────────────────────────────────────────────

/**
 * Parse an SVG path "d" attribute string into a PathGeometry.
 *
 * Example: "M 10 10 L 90 10 L 90 90 Z" → PathGeometry with one closed subpath
 */
export function parsePathData(d: string, options: ParsePathDataOptions = {}): PathGeometry {
  if (!d || d.trim() === '') return { type: 'path', subPaths: [] };

  const tokens = tokenize(d);
  assertSvgLimit('MAX_PATH_TOKENS', tokens.length);
  const subPaths = buildSubPaths(tokens, options);

  return { type: 'path', subPaths };
}

// ─── TOKENIZER ───────────────────────────────────────────────────

type Token = { type: 'command'; value: string } | { type: 'number'; value: number };

/**
 * Tokenize SVG path data into commands and numbers.
 * Handles: "M10,20L30-40.5" → [M, 10, 20, L, 30, -40.5]
 */
function tokenize(d: string): Token[] {
  const tokens: Token[] = [];
  // Match: command letters OR signed numbers (including scientific notation)
  const pattern = /([MmLlHhVvCcSsQqTtAaZz])|([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(d)) !== null) {
    if (match[1]) {
      tokens.push({ type: 'command', value: match[1] });
    } else if (match[2]) {
      tokens.push({ type: 'number', value: parseFloat(match[2]) });
    }
  }

  return tokens;
}

// ─── SUB-PATH BUILDER ────────────────────────────────────────────

function buildSubPaths(tokens: Token[], options: ParsePathDataOptions): SubPath[] {
  const subPaths: SubPath[] = [];
  let currentSegments: PathSegment[] = [];
  let segmentCount = 0;
  let curX = 0, curY = 0;       // Current point
  let startX = 0, startY = 0;   // Start of current subpath (for Z)
  let lastCmd = '';              // For implicit command repetition
  let lastCp2X = 0, lastCp2Y = 0; // Last control point (for S/T smooth curves)

  let i = 0;

  function warnMalformed(command: string): void {
    options.onWarning?.({
      code: 'SVG_PATH_MALFORMED',
      command,
      message: `Skipped malformed SVG path command "${command}" because it did not include the required numeric operands.`,
    });
  }

  function nextTokenIsNumber(): boolean {
    return i < tokens.length && tokens[i].type === 'number';
  }

  function readNumbers(count: number, command: string): number[] | null {
    const values: number[] = [];
    for (let n = 0; n < count; n++) {
      if (i >= tokens.length || tokens[i].type !== 'number') {
        warnMalformed(command);
        return null;
      }
      values.push((tokens[i++] as { type: 'number'; value: number }).value);
    }
    return values;
  }

  function finishSubPath(closed: boolean): void {
    if (currentSegments.length > 0) {
      if (closed) {
        pushSegment({ type: 'close' });
      }
      subPaths.push({ segments: [...currentSegments], closed });
      currentSegments = [];
    }
  }

  function pushSegment(segment: PathSegment): void {
    segmentCount++;
    assertSvgLimit('MAX_PATH_SEGMENTS', segmentCount);
    currentSegments.push(segment);
  }

  function pushSegments(segments: PathSegment[]): void {
    for (const segment of segments) {
      pushSegment(segment);
    }
  }

  while (i < tokens.length) {
    const token = tokens[i];

    if (token.type === 'command') {
      lastCmd = token.value;
      i++;
    } else if (lastCmd === '') {
      // No command yet — skip numbers
      i++;
      continue;
    }

    const isRelative = lastCmd === lastCmd.toLowerCase();
    const cmd = lastCmd.toUpperCase();

    switch (cmd) {
      case 'M': {
        // First M creates moveto; subsequent pairs are implicit lineto
        let first = true;
        let parsed = false;
        while (nextTokenIsNumber()) {
          const nums = readNumbers(2, lastCmd);
          if (!nums) break;
          const [x, y] = nums;
          parsed = true;
          const absX = isRelative && !first ? curX + x : isRelative ? curX + x : x;
          const absY = isRelative && !first ? curY + y : isRelative ? curY + y : y;

          if (first) {
            // New subpath
            finishSubPath(false);
            curX = isRelative ? curX + x : x;
            curY = isRelative ? curY + y : y;
            startX = curX;
            startY = curY;
            pushSegment({ type: 'move', to: { x: curX, y: curY } });
            first = false;
          } else {
            // Implicit lineto
            curX = isRelative ? curX + x : x;
            curY = isRelative ? curY + y : y;
            pushSegment({ type: 'line', to: { x: curX, y: curY } });
          }
          lastCp2X = curX;
          lastCp2Y = curY;
        }
        if (!parsed) warnMalformed(lastCmd);
        break;
      }

      case 'L': {
        let parsed = false;
        while (nextTokenIsNumber()) {
          const nums = readNumbers(2, lastCmd);
          if (!nums) break;
          const [x, y] = nums;
          parsed = true;
          curX = isRelative ? curX + x : x;
          curY = isRelative ? curY + y : y;
          pushSegment({ type: 'line', to: { x: curX, y: curY } });
          lastCp2X = curX;
          lastCp2Y = curY;
        }
        if (!parsed) warnMalformed(lastCmd);
        break;
      }

      case 'H': {
        let parsed = false;
        while (nextTokenIsNumber()) {
          const nums = readNumbers(1, lastCmd);
          if (!nums) break;
          const [x] = nums;
          parsed = true;
          curX = isRelative ? curX + x : x;
          pushSegment({ type: 'line', to: { x: curX, y: curY } });
          lastCp2X = curX;
          lastCp2Y = curY;
        }
        if (!parsed) warnMalformed(lastCmd);
        break;
      }

      case 'V': {
        let parsed = false;
        while (nextTokenIsNumber()) {
          const nums = readNumbers(1, lastCmd);
          if (!nums) break;
          const [y] = nums;
          parsed = true;
          curY = isRelative ? curY + y : y;
          pushSegment({ type: 'line', to: { x: curX, y: curY } });
          lastCp2X = curX;
          lastCp2Y = curY;
        }
        if (!parsed) warnMalformed(lastCmd);
        break;
      }

      case 'C': {
        let parsed = false;
        while (nextTokenIsNumber()) {
          const nums = readNumbers(6, lastCmd);
          if (!nums) break;
          let [x1, y1, x2, y2, x, y] = nums;
          parsed = true;
          if (isRelative) {
            x1 += curX; y1 += curY;
            x2 += curX; y2 += curY;
            x += curX;  y += curY;
          }
          pushSegment({
            type: 'cubic',
            cp1: { x: x1, y: y1 },
            cp2: { x: x2, y: y2 },
            to: { x, y },
          });
          lastCp2X = x2;
          lastCp2Y = y2;
          curX = x;
          curY = y;
        }
        if (!parsed) warnMalformed(lastCmd);
        break;
      }

      case 'S': {
        // Smooth cubic: cp1 is reflection of previous cp2 across current point
        let parsed = false;
        while (nextTokenIsNumber()) {
          const cp1X = 2 * curX - lastCp2X;
          const cp1Y = 2 * curY - lastCp2Y;
          const nums = readNumbers(4, lastCmd);
          if (!nums) break;
          let [x2, y2, x, y] = nums;
          parsed = true;
          if (isRelative) {
            x2 += curX; y2 += curY;
            x += curX;  y += curY;
          }
          pushSegment({
            type: 'cubic',
            cp1: { x: cp1X, y: cp1Y },
            cp2: { x: x2, y: y2 },
            to: { x, y },
          });
          lastCp2X = x2;
          lastCp2Y = y2;
          curX = x;
          curY = y;
        }
        if (!parsed) warnMalformed(lastCmd);
        break;
      }

      case 'Q': {
        let parsed = false;
        while (nextTokenIsNumber()) {
          const nums = readNumbers(4, lastCmd);
          if (!nums) break;
          let [cpX, cpY, x, y] = nums;
          parsed = true;
          if (isRelative) {
            cpX += curX; cpY += curY;
            x += curX;   y += curY;
          }
          pushSegment({
            type: 'quadratic',
            cp: { x: cpX, y: cpY },
            to: { x, y },
          });
          lastCp2X = cpX;
          lastCp2Y = cpY;
          curX = x;
          curY = y;
        }
        if (!parsed) warnMalformed(lastCmd);
        break;
      }

      case 'T': {
        // Smooth quadratic: cp is reflection of previous cp
        let parsed = false;
        while (nextTokenIsNumber()) {
          const cpX = 2 * curX - lastCp2X;
          const cpY = 2 * curY - lastCp2Y;
          const nums = readNumbers(2, lastCmd);
          if (!nums) break;
          let [x, y] = nums;
          parsed = true;
          if (isRelative) {
            x += curX; y += curY;
          }
          pushSegment({
            type: 'quadratic',
            cp: { x: cpX, y: cpY },
            to: { x, y },
          });
          lastCp2X = cpX;
          lastCp2Y = cpY;
          curX = x;
          curY = y;
        }
        if (!parsed) warnMalformed(lastCmd);
        break;
      }

      case 'A': {
        // Arc: approximate with cubic beziers
        let parsed = false;
        while (nextTokenIsNumber()) {
          const nums = readNumbers(7, lastCmd);
          if (!nums) break;
          const [rx, ry, rotation, largeArc, sweep, rawX, rawY] = nums;
          let x = rawX, y = rawY;
          parsed = true;
          if (isRelative) {
            x += curX; y += curY;
          }

          const arcSegments = arcToCubics(
            curX, curY, x, y,
            rx, ry, rotation, !!largeArc, !!sweep
          );
          pushSegments(arcSegments);
          lastCp2X = x;
          lastCp2Y = y;
          curX = x;
          curY = y;
        }
        if (!parsed) warnMalformed(lastCmd);
        break;
      }

      case 'Z': {
        curX = startX;
        curY = startY;
        lastCp2X = curX;
        lastCp2Y = curY;
        finishSubPath(true);
        break;
      }

      default:
        // Unknown command — skip
        i++;
        break;
    }
  }

  // Flush any remaining unclosed subpath
  finishSubPath(false);

  return subPaths;
}

// ─── ARC TO CUBIC APPROXIMATION ──────────────────────────────────

/**
 * Convert an SVG arc to one or more cubic bezier segments.
 * Based on the standard arc-to-bezier algorithm from W3C SVG spec.
 */
function arcToCubics(
  x1: number, y1: number,
  x2: number, y2: number,
  rx: number, ry: number,
  angleDeg: number,
  largeArc: boolean,
  sweep: boolean
): PathSegment[] {
  // Degenerate: zero radius or same point
  if (rx === 0 || ry === 0 || (x1 === x2 && y1 === y2)) {
    return [{ type: 'line', to: { x: x2, y: y2 } }];
  }

  rx = Math.abs(rx);
  ry = Math.abs(ry);

  const phi = (angleDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  // Step 1: Compute (x1', y1') — center parameterization
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  // Step 2: Compute (cx', cy')
  let rxSq = rx * rx, rySq = ry * ry;
  const x1pSq = x1p * x1p, y1pSq = y1p * y1p;

  // Ensure radii are large enough
  const lambda = x1pSq / rxSq + y1pSq / rySq;
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s; ry *= s;
    rxSq = rx * rx; rySq = ry * ry;
  }

  let sq = (rxSq * rySq - rxSq * y1pSq - rySq * x1pSq) /
           (rxSq * y1pSq + rySq * x1pSq);
  if (sq < 0) sq = 0;
  const sign = (largeArc === sweep) ? -1 : 1;
  const coeff = sign * Math.sqrt(sq);

  const cxp = coeff * (rx * y1p / ry);
  const cyp = coeff * -(ry * x1p / rx);

  // Step 3: Compute (cx, cy) from (cx', cy')
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  // Step 4: Compute angles
  const theta1 = vectorAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = vectorAngle(
    (x1p - cxp) / rx, (y1p - cyp) / ry,
    (-x1p - cxp) / rx, (-y1p - cyp) / ry
  );

  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

  // Step 5: Split into segments — adaptive based on arc size
  // Max 90° per segment, but use more for small radii (precision matters)
  const avgRadius = (rx + ry) / 2;
  const maxAnglePerSegment = avgRadius < 5
    ? Math.PI / 4   // 45° for small arcs (< 5mm radius)
    : avgRadius < 20
      ? Math.PI / 3  // 60° for medium arcs
      : Math.PI / 2; // 90° for large arcs (standard)

  const segments = Math.max(1, Math.ceil(Math.abs(dTheta) / maxAnglePerSegment));
  const segAngle = dTheta / segments;

  const results: PathSegment[] = [];
  let angle = theta1;

  for (let i = 0; i < segments; i++) {
    const a1 = angle;
    const a2 = angle + segAngle;
    angle = a2;

    // Convert arc segment to cubic bezier
    const t = (4 / 3) * Math.tan(segAngle / 4);

    const cos1 = Math.cos(a1), sin1 = Math.sin(a1);
    const cos2 = Math.cos(a2), sin2 = Math.sin(a2);

    const ep1x = rx * cos1, ep1y = ry * sin1;
    const ep2x = rx * cos2, ep2y = ry * sin2;

    const cp1x = ep1x - t * rx * sin1;
    const cp1y = ep1y + t * ry * cos1;
    const cp2x = ep2x + t * rx * sin2;
    const cp2y = ep2y - t * ry * cos2;

    // Rotate and translate
    results.push({
      type: 'cubic',
      cp1: {
        x: cosPhi * cp1x - sinPhi * cp1y + cx,
        y: sinPhi * cp1x + cosPhi * cp1y + cy,
      },
      cp2: {
        x: cosPhi * cp2x - sinPhi * cp2y + cx,
        y: sinPhi * cp2x + cosPhi * cp2y + cy,
      },
      to: {
        x: cosPhi * ep2x - sinPhi * ep2y + cx,
        y: sinPhi * ep2x + cosPhi * ep2y + cy,
      },
    });
  }

  return results;
}

function vectorAngle(ux: number, uy: number, vx: number, vy: number): number {
  const sign = (ux * vy - uy * vx) < 0 ? -1 : 1;
  const dot = ux * vx + uy * vy;
  const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
  let cos = dot / len;
  cos = Math.max(-1, Math.min(1, cos)); // Clamp for floating point
  return sign * Math.acos(cos);
}
