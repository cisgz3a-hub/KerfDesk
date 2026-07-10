// Apex fidelity invariant: NO traced vertex may stand far from drawn ink.
//
// The corner rebuild extends two leg fits to their intersection; on blunt
// serif terminals (Arch House "H"/"E"/"U") the needle-tip reach allowance
// let that intersection stab several px into blank background — the
// maintainer's "letters are very sharp on corners" spikes (2026-07-10
// canvas screenshot). A legitimate vertex — boundary point, spline sample,
// or a genuine needle-tip apex — always sits on or within ~a pixel of ink.
//
// This is a real-source invariant (not env-gated): it traces the actual
// logo and fails on any fabricated geometry the synthetic fixtures miss.

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TRACE_PRESETS, traceImageToColoredPaths } from '../../core/trace';
import { preprocessForTrace, type RawImageData } from '../../core/trace/trace-image';
import { chamferDistance } from './chamfer';
import { decodePngFile } from './png-decode';
import { createMask, type Mask } from './rasterize';

const SOURCE_PATH = join(
  process.cwd(),
  'src',
  '__fixtures__',
  'perceptual',
  'assets',
  'arch-house-langebaan-source.png',
);
const INK_LUMA_MAX = 128;
// A boundary vertex sits within ~0.5px of ink; spline resampling and the
// mid-crack lattice add fractions. Two legitimate mechanisms raise the
// ceiling: (1) the sharpener's ink-support gate accepts an apex when ink
// appears within a 1.6px leg-walk found via a 1.5px neighbourhood — a
// SUPPORTED apex (genuine needle tip whose sub-pixel end binarization
// dropped) can stand ~3.1px out; (2) Smooth's fit stages (DP ε=0.9,
// straight-run TLS) drift ~0.3px further on noisy boundaries. Fabricated
// spikes measured 5-10px before the gate existed; 3.5 rejects that class
// while accepting honest geometry.
const MAX_VERTEX_TO_INK_PX = 3.5;
const PRESETS_UNDER_TEST = ['Line Art', 'Smooth', 'Sharp'] as const;

describe('arch-house apex fidelity (no fabricated spikes)', () => {
  it(
    'keeps every traced vertex within a couple of pixels of drawn ink',
    { timeout: 240_000 },
    async () => {
      const source = decodePngFile(SOURCE_PATH);
      for (const presetName of PRESETS_UNDER_TEST) {
        const preset = TRACE_PRESETS[presetName];
        if (preset === undefined) continue;
        const truth = monoToMask(preprocessForTrace(source, preset));
        const dt = chamferDistance(truth);
        const paths = await traceImageToColoredPaths(source, preset);

        let worst = 0;
        let worstAt = { x: 0, y: 0 };
        let vertices = 0;
        for (const path of paths) {
          for (const polyline of path.polylines) {
            for (const point of polyline.points) {
              vertices += 1;
              const d = distanceToInk(point.x, point.y, dt, truth);
              if (d > worst) {
                worst = d;
                worstAt = { x: point.x, y: point.y };
              }
            }
          }
        }

        console.log(
          `[apex] ${presetName}: ${vertices} vertices, worst dist-to-ink ` +
            `${worst.toFixed(2)}px at (${worstAt.x.toFixed(1)},${worstAt.y.toFixed(1)})`,
        );
        expect(
          worst,
          `${presetName}: vertex ${worst.toFixed(2)}px from ink at ` +
            `(${worstAt.x.toFixed(1)},${worstAt.y.toFixed(1)}) — fabricated geometry`,
        ).toBeLessThanOrEqual(MAX_VERTEX_TO_INK_PX);
      }
    },
  );
});

function monoToMask(image: RawImageData): Mask {
  const mask = createMask(image.width, image.height);
  for (let pixel = 0; pixel < mask.data.length; pixel += 1) {
    mask.data[pixel] = (image.data[pixel * 4] ?? 255) < INK_LUMA_MAX ? 1 : 0;
  }
  return mask;
}

function distanceToInk(x: number, y: number, dt: Float32Array, mask: Mask): number {
  const px = Math.min(mask.width - 1, Math.max(0, Math.round(x)));
  const py = Math.min(mask.height - 1, Math.max(0, Math.round(y)));
  return dt[py * mask.width + px] ?? 0;
}
