// importStlFiles — drag-and-drop STL → ReliefObject (Phase H.4, ADR-098).
// CNC-only: relief carving has no laser meaning, so drops in laser mode get
// a clear toast instead of a silent no-op. Imports land at a default size
// (100 mm wide × 5 mm deep, background carved away) on a dedicated relief
// layer color; width/depth/background are edited afterwards in the Relief
// properties panel (SelectedReliefProperties).

import { meshToHeightmap } from '../../core/relief';
import {
  DEFAULT_RELIEF_LAYER_COLOR,
  IDENTITY_TRANSFORM,
  machineKindOf,
  RELIEF_EMBED_TRIANGLE_LIMIT,
  type Project,
  type ReliefObject,
  type SceneObject,
} from '../../core/scene';
import { parseStl, type ParseStlResult } from '../../io/stl';
import { parseStlOffThread } from '../import/import-worker-client';
import type { ToastVariant } from '../state/toast-store';
import { importSourceSizeAdvisory } from './import-size-advisory';

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
    const sizeAdvisory = importSourceSizeAdvisory(file, 'stl');
    if (sizeAdvisory !== null) ctx.pushToast(sizeAdvisory, 'warning');
    try {
      // parseStl itself is fast (~172 MB/s measured), but a 100 MB mesh still
      // allocates heavily; running it in the import worker keeps that off the
      // UI thread. Falls back to the main thread when Worker is unavailable.
      const parsed = (await parseStlOffThread(file)) ?? parseStl(await file.arrayBuffer());
      const relief = reliefFromParsedStl(parsed, file.name);
      if (typeof relief === 'string') {
        ctx.pushToast(`${file.name}: ${relief}`, 'error');
        continue;
      }
      const denseAdvisory = denseMeshAdvisory(file.name, relief.meshPositions.length / 9);
      if (denseAdvisory !== null) ctx.pushToast(denseAdvisory, 'warning');
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

// Rule 7 / ADR-228: the RELIEF_EMBED_TRIANGLE_LIMIT refusal ("decimate the mesh
// and re-export") was a policy cap, not an integrity fact — a dense mesh embeds
// and carves correctly, it is merely slower and heavier in the .lf2. It now
// advises at the point the refusal stood, and the import proceeds.
function denseMeshAdvisory(name: string, triangles: number): string | null {
  if (triangles <= RELIEF_EMBED_TRIANGLE_LIMIT) return null;
  return (
    `${name} carries ${triangles.toLocaleString()} triangles — the project file will be large ` +
    'and editing this relief may be slow. Decimating the mesh in your CAD tool will speed it up.'
  );
}

// Returns the ReliefObject, or a human-readable rejection reason.
function reliefFromParsedStl(parsed: ParseStlResult, source: string): ReliefObject | string {
  if (parsed.kind === 'error') return parsed.reason;
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
