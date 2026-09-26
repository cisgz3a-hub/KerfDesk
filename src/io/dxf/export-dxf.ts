// Scene artwork → DXF (ADR-431). Artwork interchange only: geometry and
// colour, no machine settings, toolpaths or operation side effects.

import {
  polylineToCurveSubpath,
  type ColoredPath,
  type CurveSubpath,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { err, ok, type Result } from '../../core/result';
import type { TracedLayer, TracedVectorOptions } from '../../core/trace';
import { transformCurveSubpathExact } from '../../core/vector-export/affine-curves';
import { svgObjectMatrix } from '../svg/export-svg-paths';
import { writeDxfDocument, type DxfWriteOptions } from './dxf-writer';

export type DxfArtworkExport = {
  readonly dxf: string;
  readonly objectCount: number;
  readonly polylineCount: number;
  /** Bitmaps and reliefs have no DXF representation and are left out. */
  readonly omittedObjectCount: number;
};

type VectorObject = Extract<SceneObject, { readonly paths: readonly ColoredPath[] }>;

export function exportSceneDxf(
  project: Project,
  selectedIds?: readonly string[],
  options: DxfWriteOptions = {},
): Result<DxfArtworkExport, string> {
  const selected = selectedIds === undefined ? null : new Set(selectedIds);
  const objects = project.scene.objects.filter(
    (object) => selected === null || selected.has(object.id),
  );
  if (objects.length === 0) return err('There is no artwork to export.');
  const vectors = objects.filter(isVectorObject);
  if (vectors.length === 0) {
    return err('DXF holds vector artwork only. Select vector, text or traced artwork.');
  }
  const byColor = new Map<string, CurveSubpath[]>();
  for (const object of vectors) {
    const matrix = svgObjectMatrix(object.transform);
    for (const path of object.paths) {
      const color = path.color.toLowerCase();
      const bucket = byColor.get(color) ?? [];
      for (const curve of path.curves ?? path.polylines.map(polylineToCurveSubpath)) {
        bucket.push(transformCurveSubpathExact(curve, matrix));
      }
      byColor.set(color, bucket);
    }
  }
  try {
    const document = writeDxfDocument(
      [...byColor.entries()].map(([color, curves]) => ({ color, curves })),
      options,
    );
    return ok({
      dxf: document.text,
      objectCount: vectors.length,
      polylineCount: document.polylineCount,
      omittedObjectCount: objects.length - vectors.length,
    });
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}

/**
 * Whether the scene (or the selection) holds anything DXF can carry. Callers
 * check this before opening a save picker, so an image-only selection never
 * asks for a file name it cannot fill.
 */
export function hasDxfVectorArtwork(project: Project, selectedIds?: readonly string[]): boolean {
  const selected = selectedIds === undefined ? null : new Set(selectedIds);
  return project.scene.objects.some(
    (object) => (selected === null || selected.has(object.id)) && isVectorObject(object),
  );
}

function isVectorObject(object: SceneObject): object is VectorObject {
  return object.kind !== 'raster-image' && object.kind !== 'relief' && 'paths' in object;
}

/**
 * Multi-File Trace DXF: the traced page's lower-left corner is the DXF
 * origin, so every file in a batch shares the source image's frame.
 */
export function tracedLayersToDxf(
  layers: ReadonlyArray<TracedLayer>,
  options: TracedVectorOptions & { readonly pageHeight: number },
): string {
  return writeDxfDocument(layers, {
    ...(options.precisionMm === undefined ? {} : { precisionMm: options.precisionMm }),
    origin: { x: 0, y: options.pageHeight },
  }).text;
}
