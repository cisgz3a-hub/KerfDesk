/**
 * T1-45: compile complexity gate. Pre-T1-45 the renderer-thread compile
 * path was synchronous and unbounded — a 4MP photo at grayscale could
 * generate millions of G-code lines and freeze the UI for tens of
 * seconds with no progress, no cancel, no estimate. The full streaming
 * fix (T3-15) is multi-week architecture work; this is the cheap
 * defense that runs as a scene-level preflight rule and surfaces the
 * cost BEFORE the compile launches.
 *
 * Three severity levels:
 *   - INFO  (≥ 1M lines): "Compile may take several seconds."
 *   - WARN  (≥ 3M lines): "Compile may take 30+ seconds; UI will be
 *                          unresponsive." Non-blocking; user sees a
 *                          warning and continues.
 *   - BLOCK (≥ 10M lines OR > 800MB estimated memory): refuses the
 *           compile because the app will likely run out of memory or
 *           appear hung indefinitely. Fix message names the levers
 *           the user has (DPI, dither mode, simplify, split).
 *
 * The estimate is intentionally conservative — better to over-warn
 * than under-warn for the case the audit calls out (worst-case
 * grayscale photo). It's a heuristic upper bound, not a planner
 * simulation.
 */
import type { PreflightContext, PreflightResult } from '../Preflight';
import { PREFLIGHT_CODES } from '../Preflight';
import type { Scene } from '../../scene/Scene';

export interface ComplexityEstimate {
  rasterPixels: number;
  vectorPathCount: number;
  vectorVertexCount: number;
  expectedGcodeLineCount: number;
  estimatedMemoryMB: number;
}

const WARN_LINE_COUNT_INFO = 1_000_000;
const WARN_LINE_COUNT_HIGH = 3_000_000;
const HARD_BLOCK_LINE_COUNT = 10_000_000;
const HARD_BLOCK_MEMORY_MB = 800;

/**
 * Conservative upper-bound estimator. Walks visible objects on output
 * layers and sums:
 *
 *   - raster: pixelCount += grayscale w × h, lineCount += pixelCount
 *     (one G1 per power-change in worst-case grayscale; post-T1-31
 *     modal-M4 typically fewer, but the gate uses the upper bound so
 *     users still see the warning before they hit it).
 *
 *   - vector path / polygon / rect / ellipse: lineCount += vertex
 *     count (one G1 per segment after flattening). Curves are counted
 *     at the existing flattening density (~12 segments per cubic).
 *
 * Memory: pixels (1 byte each) × 5 (working float buffer + dither
 * intermediate + raster output + planner scratch) plus
 * lineCount × 80 bytes (gcode text average).
 */
export function estimateCompileComplexity(scene: Scene): ComplexityEstimate {
  let rasterPixels = 0;
  let vectorPathCount = 0;
  let vectorVertexCount = 0;

  for (const obj of scene.objects) {
    if (!obj.visible) continue;
    const layer = scene.layers.find(l => l.id === obj.layerId);
    if (layer && (!layer.visible || layer.output === false)) continue;

    const g = obj.geometry;
    switch (g.type) {
      case 'image': {
        const w = g.grayscaleWidth ?? g.cropWidth ?? g.originalWidth ?? 0;
        const h = g.grayscaleHeight ?? g.cropHeight ?? g.originalHeight ?? 0;
        rasterPixels += w * h;
        break;
      }
      case 'rect':
      case 'ellipse':
      case 'line':
        vectorPathCount += 1;
        // rect = 4 corners + close, ellipse = 32-step flatten,
        // line = 2 endpoints. Conservative upper bound 32.
        vectorVertexCount += g.type === 'ellipse' ? 32 : 5;
        break;
      case 'polygon':
        vectorPathCount += 1;
        vectorVertexCount += g.points.length + 1;
        break;
      case 'path': {
        vectorPathCount += g.subPaths.length;
        for (const sp of g.subPaths) {
          for (const seg of sp.segments) {
            // Cubics / quadratics flatten to ~12 / ~10 segments each
            // (matches BooleanOps flattenCubicBezier / flattenQuadratic).
            if (seg.type === 'cubic') vectorVertexCount += 12;
            else if (seg.type === 'quadratic') vectorVertexCount += 10;
            else vectorVertexCount += 1;
          }
        }
        break;
      }
      case 'text': {
        // Text gets converted to outlines before compile; we don't have
        // the outline subPaths reliably at scene-preflight time. Use a
        // rough proxy: one path per character × ~30 vertices per char
        // (typical sans-serif outline density).
        vectorPathCount += g.text.length;
        vectorVertexCount += g.text.length * 30;
        break;
      }
      default: {
        const _exhaustive: never = g;
        void _exhaustive;
      }
    }
  }

  // Conservative line-count estimate. Raster grayscale worst-case:
  // one G1 per pixel on the active scanline. Post-T1-31 modal-M4 makes
  // adjacent same-power pixels merge, but the gate is about pre-compile
  // protection — over-warn is the safer side.
  const expectedRasterLines = rasterPixels;
  // Vector: one G1 per vertex plus a small overhead for the per-path
  // rapid + laser modal.
  const expectedVectorLines = vectorVertexCount + vectorPathCount * 4;
  const expectedGcodeLineCount = expectedRasterLines + expectedVectorLines;

  // Memory: pixels × 5 (working float + dither + raster output + planner
  // scratch) + lineCount × 80 bytes (gcode text avg).
  const estimatedMemoryBytes = rasterPixels * 5 + expectedGcodeLineCount * 80;
  const estimatedMemoryMB = estimatedMemoryBytes / (1024 * 1024);

  return {
    rasterPixels,
    vectorPathCount,
    vectorVertexCount,
    expectedGcodeLineCount,
    estimatedMemoryMB,
  };
}

function fmtLines(n: number): string {
  return n.toLocaleString('en-US');
}

export function runCompileComplexityChecks(
  ctx: PreflightContext,
  out: PreflightResult[],
): void {
  const e = estimateCompileComplexity(ctx.scene);
  if (e.expectedGcodeLineCount === 0 && e.rasterPixels === 0) return;

  if (
    e.expectedGcodeLineCount > HARD_BLOCK_LINE_COUNT ||
    e.estimatedMemoryMB > HARD_BLOCK_MEMORY_MB
  ) {
    out.push({
      severity: 'error',
      code: PREFLIGHT_CODES.COMPILE_COMPLEXITY_BLOCK,
      message:
        `Job is too large to compile: estimated ${fmtLines(e.expectedGcodeLineCount)} ` +
        `G-code lines, ~${e.estimatedMemoryMB.toFixed(0)} MB memory. ` +
        `The app will likely freeze or run out of memory. ` +
        `Reduce raster DPI, switch grayscale photos to 1-bit dithered mode, ` +
        `simplify SVG paths, or split into multiple jobs.`,
    });
    return;
  }
  if (e.expectedGcodeLineCount > WARN_LINE_COUNT_HIGH) {
    out.push({
      severity: 'warning',
      code: PREFLIGHT_CODES.COMPILE_COMPLEXITY_WARN,
      message:
        `Large job — compile will take time: estimated ${fmtLines(e.expectedGcodeLineCount)} ` +
        `G-code lines, ~${e.estimatedMemoryMB.toFixed(0)} MB memory. ` +
        `Compile may take 30+ seconds and the UI will be unresponsive during it.`,
    });
    return;
  }
  if (e.expectedGcodeLineCount > WARN_LINE_COUNT_INFO) {
    out.push({
      severity: 'info',
      code: PREFLIGHT_CODES.COMPILE_COMPLEXITY_INFO,
      message:
        `Estimated ${fmtLines(e.expectedGcodeLineCount)} G-code lines. ` +
        `Compile may take several seconds.`,
    });
  }
}
