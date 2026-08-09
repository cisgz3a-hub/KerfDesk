import { describe, expect, it } from 'vitest';
import type { TriangleMesh } from './triangle-mesh';
import { meshToHeightmap, type MeshHeightmapRuntime } from './mesh-to-heightmap';

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

function stretchMeshY(mesh: TriangleMesh, factor: number): TriangleMesh {
  const positions = Float32Array.from(mesh.positions);
  for (let i = 1; i < positions.length; i += 3) positions[i] = (positions[i] ?? 0) * factor;
  return { positions };
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

  it('rasterizes nonuniform target scaling in square physical-mm cells', () => {
    const scaled = meshToHeightmap(pyramidMesh(), {
      targetWidthMm: 20,
      reliefDepthMm: 5,
      mmPerCell: 0.5,
      targetScaleX: 0.5,
      targetScaleY: 2,
    });
    const samePhysicalSurface = meshToHeightmap(stretchMeshY(pyramidMesh(), 4), {
      targetWidthMm: 10,
      reliefDepthMm: 5,
      mmPerCell: 0.5,
    });
    if (scaled.kind !== 'ok' || samePhysicalSurface.kind !== 'ok') throw new Error('expected ok');

    expect(scaled.widthMm).toBe(10);
    expect(scaled.heightMm).toBe(40);
    expect(scaled.heightmap).toEqual(samePhysicalSurface.heightmap);
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

  it('rejects non-finite target dimensions instead of returning an ok empty heightmap', () => {
    const result = meshToHeightmap(pyramidMesh(), {
      targetWidthMm: Number.POSITIVE_INFINITY,
      reliefDepthMm: 5,
      mmPerCell: 1,
    });

    expect(result).toEqual({
      kind: 'error',
      reason: 'Target width and relief depth must be finite positive numbers.',
    });
  });

  it('rejects non-positive target scale', () => {
    expect(
      meshToHeightmap(pyramidMesh(), {
        targetWidthMm: 20,
        reliefDepthMm: 5,
        targetScaleX: 0,
      }),
    ).toEqual({
      kind: 'error',
      reason: 'Target XY scale must be finite and positive.',
    });
  });

  it('attempts the exact cell count above the advisory threshold and reports RangeError', () => {
    let attemptedLength: number | undefined;
    const runtime: MeshHeightmapRuntime = {
      allocateFloat32: (length) => {
        attemptedLength = length;
        throw new RangeError('controlled allocation failure');
      },
    };
    const result = meshToHeightmap(
      pyramidMesh(),
      { targetWidthMm: 2001, reliefDepthMm: 5, mmPerCell: 1 },
      runtime,
    );

    expect(attemptedLength).toBe(2001 * 2001);
    expect(attemptedLength).toBeGreaterThan(4_000_000);
    expect(result).toEqual({
      kind: 'error',
      reason: 'Relief mesh heightmap does not fit in this runtime.',
    });
  });

  it('turns a native typed-array allocation RangeError into a structured result', () => {
    expect(
      meshToHeightmap(pyramidMesh(), {
        targetWidthMm: Number.MAX_VALUE,
        reliefDepthMm: 5,
        mmPerCell: Number.MIN_VALUE,
      }),
    ).toEqual({
      kind: 'error',
      reason: 'Relief mesh heightmap does not fit in this runtime.',
    });
  });

  // The 2 x 2 fixture requests four cells, so -4 also covers a zero-length return.
  it.each([-4, -1, 1])(
    'rejects a max-Z allocation whose length differs from the exact request by %i',
    (delta) => {
      expect(
        meshToHeightmap(
          pyramidMesh(),
          { targetWidthMm: 2, reliefDepthMm: 5, mmPerCell: 1 },
          { allocateFloat32: (length) => new Float32Array(Math.max(0, length + delta)) },
        ),
      ).toEqual({
        kind: 'error',
        reason: 'Relief mesh heightmap does not fit in this runtime.',
      });
    },
  );

  it.each([-4, -1, 1])(
    'rejects a depth allocation whose length differs from the exact request by %i',
    (delta) => {
      let calls = 0;
      expect(
        meshToHeightmap(
          pyramidMesh(),
          { targetWidthMm: 2, reliefDepthMm: 5, mmPerCell: 1 },
          {
            allocateFloat32: (length) => {
              calls += 1;
              return new Float32Array(calls === 1 ? length : Math.max(0, length + delta));
            },
          },
        ),
      ).toEqual({
        kind: 'error',
        reason: 'Relief mesh heightmap does not fit in this runtime.',
      });
      expect(calls).toBe(2);
    },
  );

  it('rethrows a non-allocation materialization failure', () => {
    const programmerError = new Error('controlled allocator error');

    expect(() =>
      meshToHeightmap(
        pyramidMesh(),
        { targetWidthMm: 20, reliefDepthMm: 5, mmPerCell: 1 },
        {
          allocateFloat32: () => {
            throw programmerError;
          },
        },
      ),
    ).toThrow(programmerError);
  });

  it('rethrows a non-allocation failure from the second exact allocation', () => {
    const programmerError = new Error('controlled depth allocator error');
    let calls = 0;

    expect(() =>
      meshToHeightmap(
        pyramidMesh(),
        { targetWidthMm: 2, reliefDepthMm: 5, mmPerCell: 1 },
        {
          allocateFloat32: (length) => {
            calls += 1;
            if (calls === 2) throw programmerError;
            return new Float32Array(length);
          },
        },
      ),
    ).toThrow(programmerError);
    expect(calls).toBe(2);
  });
});
