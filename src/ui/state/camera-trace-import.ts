import {
  addLayer,
  addObject,
  createArtworkOperation,
  type Project,
  type RasterImage,
  type TracedImage,
} from '../../core/scene';
import { withImageOutputOff } from '../../core/scene/reference-image-output';
import {
  applyTraceToExisting,
  pushUndo,
  type MutationResult,
  type StateSlice,
  type TraceExistingImageOptions,
} from './scene-mutations';
import { applyRasterizedTraceToExisting } from './rasterized-trace-mutation';

/** A private calculation snapshot, never published to the live store. Camera
 * bounds are already bed-registered: fresh-import fitting would move them. */
export function projectWithCameraTraceSource(project: Project, source: RasterImage): Project {
  const created = createArtworkOperation(project.scene, source, { mode: 'image' });
  const operation = {
    ...created.operation,
    linesPerMm: source.linesPerMm,
    ditherAlgorithm: source.dither,
  };
  return { ...project, scene: addLayer(addObject(project.scene, created.object), operation) };
}

/** Reuse the normal output/settings mutations but put the ORIGINAL project in
 * history. Source, result, operations and selection publish in one store set. */
export function applyCameraTraceImport(
  state: StateSlice,
  source: RasterImage,
  output: TracedImage | RasterImage,
  options: TraceExistingImageOptions,
): MutationResult & { readonly additionalSelectedIds: ReadonlySet<string> } {
  const staged = { ...state, project: projectWithCameraTraceSource(state.project, source) };
  const result =
    output.kind === 'traced-image'
      ? applyTraceToExisting(staged, source.id, output, options)
      : applyRasterizedTraceToExisting(staged, source.id, output, options);
  // Existing empty operations belong to the document too; the ordinary
  // replacement helpers may prune them while removing a source operation.
  const existingIds = new Set(state.project.scene.layers.map((layer) => layer.id));
  // A kept capture is a bed picture, a placement reference like the LightBurn
  // camera overlay: it stays, but does not engrave (ADR-673).
  const scene =
    options.deleteSourceAfterTrace === true
      ? result.project.scene
      : withImageOutputOff(result.project.scene, source.id);
  const layers = [
    ...state.project.scene.layers,
    ...scene.layers.filter((layer) => !existingIds.has(layer.id)),
  ];
  // The capture's operation is new, so the result's copies of it are seeded
  // with it, not inherited from it.
  const { inheritedOperationIds: _seededWithCapture, ...mutation } = result as typeof result & {
    readonly inheritedOperationIds?: ReadonlyArray<string>;
  };
  return {
    ...mutation,
    project: { ...result.project, scene: { ...scene, layers } },
    additionalSelectedIds: new Set<string>(),
    undoStack: pushUndo(state.project, state.undoStack),
  };
}
