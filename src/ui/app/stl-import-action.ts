// importStlFiles — drag-and-drop STL → ReliefObject (Phase H.4, ADR-098).
// CNC-only: relief carving has no laser meaning, so drops in laser mode get
// a clear toast instead of a silent no-op. Imports land at a default size
// (100 mm wide × 5 mm deep, background carved away) on a dedicated relief
// layer color; width/depth/background are edited afterwards in the Relief
// properties panel (SelectedReliefProperties).

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
import { parseStlOffThread } from '../import/import-worker-client';
import {
  type PreparedStlImportResult,
  type StlImportPreparationOptions,
  prepareParsedStlImport,
} from '../import/stl-import-preparation';
import type { ToastVariant } from '../state/toast-store';
import { importSourceSizeAdvisory, mainThreadImportFallbackAdvisory } from './import-size-advisory';
import { createImportWorkerControls, isImportCancellation } from './import-worker-controls';

export const DEFAULT_RELIEF_WIDTH_MM = 100;
export const DEFAULT_RELIEF_DEPTH_MM = 5;
// Coarse probe cell — only validates the mesh and derives the aspect ratio.
const PROBE_CELL_MM = 1;
const STL_PREPARATION_OPTIONS: StlImportPreparationOptions = {
  targetWidthMm: DEFAULT_RELIEF_WIDTH_MM,
  reliefDepthMm: DEFAULT_RELIEF_DEPTH_MM,
  mmPerCell: PROBE_CELL_MM,
};

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
    const controls = createImportWorkerControls(file.name, ctx.pushToast);
    try {
      // Parsing and the aspect-ratio heightmap probe normally stay in the import
      // worker. Constructor-time Worker unavailability retains the legacy valid
      // path with a responsiveness warning; worker errors/cancellation do not retry.
      const pending = parseStlOffThread(file, STL_PREPARATION_OPTIONS, controls.options);
      const prepared =
        pending === null ? await prepareStlOnMainThread(file, ctx.pushToast) : await pending;
      const relief = reliefFromPreparedStl(prepared, file.name);
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
      ctx.pushToast(
        isImportCancellation(err)
          ? `${file.name}: import cancelled.`
          : `${file.name}: ${err instanceof Error ? err.message : String(err)}`,
        isImportCancellation(err) ? 'warning' : 'error',
      );
    } finally {
      controls.dispose();
    }
  }
}

async function prepareStlOnMainThread(
  file: File,
  pushToast: (message: string, variant?: ToastVariant) => void,
): Promise<PreparedStlImportResult> {
  pushToast(mainThreadImportFallbackAdvisory(file.name), 'warning');
  return prepareParsedStlImport(parseStl(await file.arrayBuffer()), STL_PREPARATION_OPTIONS);
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
function reliefFromPreparedStl(
  prepared: PreparedStlImportResult,
  source: string,
): ReliefObject | string {
  if (prepared.kind === 'error') return prepared.reason;
  return {
    kind: 'relief',
    id: crypto.randomUUID(),
    source,
    meshPositions: prepared.positions,
    targetWidthMm: DEFAULT_RELIEF_WIDTH_MM,
    reliefDepthMm: DEFAULT_RELIEF_DEPTH_MM,
    emptyCells: 'floor',
    color: DEFAULT_RELIEF_LAYER_COLOR,
    bounds: { minX: 0, minY: 0, maxX: prepared.widthMm, maxY: prepared.heightMm },
    transform: IDENTITY_TRANSFORM,
  };
}
