import { describe, expect, it } from 'vitest';
import type { TriangleMesh } from './triangle-mesh';
import { meshToHeightmap } from './mesh-to-heightmap';

// Analytic meshes (ADR-025 perceptual pattern): surfaces with closed-form
// height fields, so every cell can be checked against ground truth.

// A 4-triangle square pyramid: base 20 × 20 at z = 0, apex at center z = 10.
function pyramidMesh(): TriangleMesh {
  const s = 20;
  const apex = [s / 2, s / 2, 10];
  const c = [
    [0, 0, 0],
    [s, 0, 0],
    [s, s, 0],
    [0, s, 0],
  ];
  const tris = [
    [...(c[0] ?? []), ...(c[1] ?? []), ...apex],
    [...(c[1] ?? []), ...(c[2] ?? []), ...apex],
    [...(c[2] ?? []), ...(c[3] ?? []), ...apex],
    [...(c[3] ?? []), ...(c[0] ?? []), ...apex],
  ];
  return { positions: Float32Array.from(tris.flat()) };
}

// Two triangles forming a plane rising from z=0 at x=0 to z=10 at x=20.
function rampMesh(): TriangleMesh {
  const tris = [
    [0, 0, 0, 20, 0, 10, 20, 20, 10],
    [0, 0, 0, 20, 20, 10, 0, 20, 0],
  ];
  return { positions: Float32Array.from(tris.flat()) };
}

describe('meshToHeightmap', () => {
  it('matches the analytic pyramid within a cell-slope bound', () => {
    const result = meshToHeightmap(pyramidMesh(), {
      targetWidthMm: 20,
      reliefDepthMm: 5, // apex (z=10) at stock top, base at −5
      mmPerCell: 0.2,
    });
    if (result.kind !== 'ok') throw new Error(result.reason);
    const { heightmap } = result;
    expect(result.heightMm).toBeCloseTo(20, 6);

    // Analytic: pyramid height at (x, y) = 10 · (1 − max(|x−10|, |y−10|)/10),
    // normalized so apex → 0, base → −5. Max slope 1 in model z per model
    // xy → 0.5 in depth-mm per mm after scaling; tolerance = slope · cell
    // diagonal + interpolation slack.
    const tolerance = 0.5 * heightmap.mmPerCell * Math.SQRT2 + 0.05;
    let maxError = 0;
    for (let cy = 0; cy < heightmap.heightCells; cy += 1) {
      for (let cx = 0; cx < heightmap.widthCells; cx += 1) {
        const x = (cx + 0.5) * heightmap.mmPerCell;
        const y = (cy + 0.5) * heightmap.mmPerCell;
        if (x > 20 || y > 20) continue;
        const modelHeight = Math.max(
          0,
          10 * (1 - Math.max(Math.abs(x - 10), Math.abs(y - 10)) / 10),
        );
        const analytic = (modelHeight - 10) / 2; // scale 10 model-z → 5 mm
        const cell = heightmap.depth[cy * heightmap.widthCells + cx] ?? 0;
        maxError = Math.max(maxError, Math.abs(cell - analytic));
      }
    }
    expect(maxError).toBeLessThanOrEqual(tolerance);
  });

  it('matches an analytic ramp exactly at cell centers (linear surface)', () => {
    const result = meshToHeightmap(rampMesh(), {
      targetWidthMm: 20,
      reliefDepthMm: 10,
      mmPerCell: 0.5,
    });
    if (result.kind !== 'ok') throw new Error(result.reason);
    const { heightmap } = result;
    const tolerance = 0.5 * heightmap.mmPerCell + 0.02;
    for (let cy = 0; cy < heightmap.heightCells; cy += 1) {
      for (let cx = 0; cx < heightmap.widthCells; cx += 1) {
        const x = (cx + 0.5) * heightmap.mmPerCell;
        if (x > 20) continue;
        const analytic = (x / 20) * 10 - 10; // −10 at x=0 → 0 at x=20
        const cell = heightmap.depth[cy * heightmap.widthCells + cx] ?? 0;
        expect(Math.abs(cell - analytic)).toBeLessThanOrEqual(tolerance);
      }
    }
  });

  it('is deterministic and depths stay within [−reliefDepth, 0]', () => {
    const a = meshToHeightmap(pyramidMesh(), { targetWidthMm: 20, reliefDepthMm: 5 });
    const b = meshToHeightmap(pyramidMesh(), { targetWidthMm: 20, reliefDepthMm: 5 });
    if (a.kind !== 'ok' || b.kind !== 'ok') throw new Error('expected ok');
    expect(a.heightmap.depth).toEqual(b.heightmap.depth);
    for (const d of a.heightmap.depth) {
      expect(d).toBeLessThanOrEqual(0);
      expect(d).toBeGreaterThanOrEqual(-5 - 1e-6);
    }
  });

  it("empty cells: 'floor' carves the background away, 'top' leaves it", () => {
    // A tiny triangle in the corner of a wide target leaves most cells empty.
    const tiny: TriangleMesh = {
      positions: Float32Array.from([0, 0, 5, 2, 0, 5, 0, 2, 5]),
    };
    const floor = meshToHeightmap(tiny, { targetWidthMm: 20, reliefDepthMm: 4, mmPerCell: 1 });
    const top = meshToHeightmap(tiny, {
      targetWidthMm: 20,
      reliefDepthMm: 4,
      mmPerCell: 1,
      emptyCells: 'top',
    });
    if (floor.kind !== 'ok' || top.kind !== 'ok') throw new Error('expected ok');
    const lastFloor = floor.heightmap.depth[floor.heightmap.depth.length - 1];
    const lastTop = top.heightmap.depth[top.heightmap.depth.length - 1];
    expect(lastFloor).toBe(-4);
    expect(lastTop).toBe(0);
  });

  it('rejects empty and degenerate meshes', () => {
    expect(
      meshToHeightmap({ positions: new Float32Array(0) }, { targetWidthMm: 20, reliefDepthMm: 5 })
        .kind,
    ).toBe('error');
    const flat: TriangleMesh = { positions: Float32Array.from([0, 0, 0, 0, 0, 1, 0, 0, 2]) };
    expect(meshToHeightmap(flat, { targetWidthMm: 20, reliefDepthMm: 5 }).kind).toBe('error');
  });

  it('rejects non-finite target width or relief depth (D-S04-002)', () => {
    expect(
      meshToHeightmap(pyramidMesh(), {
        targetWidthMm: Number.POSITIVE_INFINITY,
        reliefDepthMm: 5,
      }).kind,
    ).toBe('error');
    expect(
      meshToHeightmap(pyramidMesh(), {
        targetWidthMm: 20,
        reliefDepthMm: Number.POSITIVE_INFINITY,
      }).kind,
    ).toBe('error');
    expect(
      meshToHeightmap(pyramidMesh(), { targetWidthMm: 20, reliefDepthMm: Number.NaN }).kind,
    ).toBe('error');
  });
});
