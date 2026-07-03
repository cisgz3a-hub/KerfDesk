// Max-plus heightmap dilation (Phase H.5, ADR-098): the SAFE tool-center
// height field. A tool tip at (x, y) may descend to
//   dilated(x, y) = max over kernel offsets of (h(x+dx, y+dy) − dz)
// without cutting below the target surface anywhere under its footprint
// (dz is the cutting surface's clearance above the tip at that offset —
// core/sim/tool-kernels). Adding a finishing allowance lifts the whole
// roughing target so H.8's ball-nose pass has material to finish.
//
// Out-of-bounds neighbors are ignored (treated as bottomless), so the field
// never inflates at the heightmap edge.

import type { ToolKernel } from '../sim';
import type { Heightmap } from './heightmap';

export function dilateHeightmapByTool(
  map: Heightmap,
  kernel: ToolKernel,
  allowanceMm: number,
): Float32Array {
  const { widthCells, heightCells, depth } = map;
  const out = new Float32Array(widthCells * heightCells);
  for (let cy = 0; cy < heightCells; cy += 1) {
    for (let cx = 0; cx < widthCells; cx += 1) {
      let best = Number.NEGATIVE_INFINITY;
      for (const o of kernel.offsets) {
        const nx = cx + o.dx;
        const ny = cy + o.dy;
        if (nx < 0 || ny < 0 || nx >= widthCells || ny >= heightCells) continue;
        const candidate = (depth[ny * widthCells + nx] ?? 0) - o.dz;
        if (candidate > best) best = candidate;
      }
      const safe = best === Number.NEGATIVE_INFINITY ? (depth[cy * widthCells + cx] ?? 0) : best;
      // The roughing target never rises above the stock top.
      out[cy * widthCells + cx] = Math.min(0, safe + allowanceMm);
    }
  }
  return out;
}
