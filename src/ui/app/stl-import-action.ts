// importStlFiles — drag-and-drop STL → ReliefObject (Phase H.4, ADR-094).
// CNC-only: relief carving has no laser meaning, so drops in laser mode get
// a clear toast instead of a silent no-op. Imports land at a default size
// (100 mm wide × 5 mm deep, background carved away) on a dedicated relief
// layer color; the size/depth become editable when relief settings surface
// with H.5 roughing.

import { meshToHeightmap, triangleCount } from '../../core/relief';
import {
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  machineKindOf,
  RELIEF_EMBED_TRIANGLE_LIMIT,
  type Project,
  type ReliefObject,
  type SceneObject,
} from '../../core/scene';
import { parseStl } from '../../io/stl';
import type { ToastVariant } from '../state/toast-store';

export const DEFAULT_RELIEF_WIDTH_MM = 100;
export const DEFAULT_RELIEF_DEPTH_MM = 5;
// Coarse probe cell — only validates the mesh and derives the aspect ratio.
const PROBE_CELL_MM = 1;

export function isStlFile(file: File): boolean {
  return file.name.toLowerCase().endsWith('.stl');
}

export async function importStlFiles(
  files: ReadonlyArray<File>,
  ctx: {
    readonly project: Project;
    readonly importObject: (obj: SceneObject, batchIdx?: number) => unknown;
    readonly pushToast: (message: string, variant?: ToastVariant) => void;
  },
): Promise<void> {
  if (files.length === 0) return;
  if (machineKindOf(ctx.project.machine) !== 'cnc') {
    ctx.pushToast(
      'STL relief import needs CNC mode — flip the Laser/CNC toggle in the layers panel first.',
      'error',
    );
    return;
  }
  let successIdx = 0;
  for (const file of files) {
    try {
      const relief = reliefFromStlBytes(await file.arrayBuffer(), file.name);
      if (typeof relief === 'string') {
        ctx.pushToast(`${file.name}: ${relief}`, 'error');
        continue;
      }
      ctx.importObject(relief, successIdx);
      successIdx += 1;
      ctx.pushToast(
        `Imported relief "${file.name}" (${relief.meshPositions.length / 9} triangles) at ` +
          `${DEFAULT_RELIEF_WIDTH_MM} mm wide × ${DEFAULT_RELIEF_DEPTH_MM} mm deep.`,
        'success',
      );
    } catch (err) {
      ctx.pushToast(`${file.name}: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }
}

// Returns the ReliefObject, or a human-readable rejection reason.
function reliefFromStlBytes(bytes: ArrayBuffer, source: string): ReliefObject | string {
  const parsed = parseStl(bytes);
  if (parsed.kind === 'error') return parsed.reason;
  const triangles = triangleCount(parsed.mesh);
  if (triangles > RELIEF_EMBED_TRIANGLE_LIMIT) {
    return (
      `${triangles} triangles is beyond the ${RELIEF_EMBED_TRIANGLE_LIMIT} embed limit — ` +
      'decimate the mesh in your CAD tool and re-export.'
    );
  }
  const probe = meshToHeightmap(parsed.mesh, {
    targetWidthMm: DEFAULT_RELIEF_WIDTH_MM,
    reliefDepthMm: DEFAULT_RELIEF_DEPTH_MM,
    mmPerCell: PROBE_CELL_MM,
  });
  if (probe.kind === 'error') return probe.reason;
  return {
    kind: 'relief',
    id: crypto.randomUUID(),
    source,
    meshPositions: Array.from(parsed.mesh.positions),
    targetWidthMm: DEFAULT_RELIEF_WIDTH_MM,
    reliefDepthMm: DEFAULT_RELIEF_DEPTH_MM,
    emptyCells: 'floor',
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: probe.widthMm, maxY: probe.heightMm },
    transform: IDENTITY_TRANSFORM,
  };
}
