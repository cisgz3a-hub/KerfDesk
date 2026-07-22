import {
  addLayer,
  addObject,
  captureLayerOperationSettings,
  createArtworkOperation,
  layerFromSubLayer,
  type Layer,
  type LayerOperationSettings,
  type RasterImage,
  removeObject,
  replaceObject,
  type Scene,
  sceneObjectUsesOperation,
} from '../../core/scene';
import {
  type MutationResult,
  pruneOrphanLayers,
  pushUndo,
  type StateSlice,
  type TraceExistingImageOptions,
} from './scene-mutations';
import { releaseTraceSourcePalette } from './trace-source-palette';

/**
 * Atomically replace a trace result with an Image-pipeline raster.
 *
 * The derived bitmap shares the source photo's effective Image operations so
 * speed, power, dither, density, passes, and scan direction do not silently
 * change. A kept source is render-only; a deleted source's operation survives
 * because the result is added before orphan pruning.
 */
export function applyRasterizedTraceToExisting(
  s: StateSlice,
  sourceId: string,
  raster: RasterImage,
  options: TraceExistingImageOptions = {},
): MutationResult & { readonly additionalSelectedIds: ReadonlySet<string> } {
  const source = s.project.scene.objects.find(
    (object): object is RasterImage => object.id === sourceId && object.kind === 'raster-image',
  );
  const reusableOperationIds =
    source === undefined ? [] : reusableImageOperationIds(s.project.scene, source);
  const fallbackLayer = source === undefined ? undefined : firstBoundLayer(s.project.scene, source);
  let scene = s.project.scene;

  if (options.replaceTraceId !== undefined && options.replaceTraceId !== raster.id) {
    scene = removeObject(scene, options.replaceTraceId);
  }
  if (source !== undefined) {
    scene =
      options.deleteSourceAfterTrace === true
        ? removeObject(scene, source.id)
        : replaceObject(scene, source.id, { ...source, role: 'trace-source' });
  }

  const prepared = prepareRasterizedTrace(raster, sourceId, source);
  const replaceInPlace =
    options.replaceTraceId === raster.id && scene.objects.some((object) => object.id === raster.id);
  let committed: RasterImage;
  if (reusableOperationIds.length > 0) {
    committed = { ...prepared, operationIds: reusableOperationIds };
    scene = placeRasterizedTrace(scene, committed, replaceInPlace);
  } else {
    const allocated = allocateFreshRasterOperation(scene, prepared, {
      source,
      fallbackLayer,
      deleteSource: options.deleteSourceAfterTrace === true,
      replaceInPlace,
    });
    scene = allocated.scene;
    committed = allocated.committed;
  }
  scene = pruneOrphanLayers(scene);

  return {
    project: { ...s.project, scene },
    selectedObjectId: committed.id,
    additionalSelectedIds: new Set<string>(),
    undoStack: pushUndo(s.project, s.undoStack),
    redoStack: [],
    dirty: true,
  };
}

type FreshRasterOperationContext = {
  readonly source: RasterImage | undefined;
  readonly fallbackLayer: Layer | undefined;
  readonly deleteSource: boolean;
  readonly replaceInPlace: boolean;
};

// The no-reusable-Image-operation branch: allocate a fresh Image operation for
// the rasterized trace. Extracted so applyRasterizedTraceToExisting stays under
// the complexity cap once palette-freeing is added.
function allocateFreshRasterOperation(
  scene: Scene,
  prepared: RasterImage,
  ctx: FreshRasterOperationContext,
): { readonly scene: Scene; readonly committed: RasterImage } {
  // Free the source's palette slot before allocating (mirror of
  // applyTraceToExisting) so the trace takes OPERATION_PALETTE[0], not the
  // runner-up. A deleted source's operation is already orphaned — prune it so
  // its slot frees too.
  let working = scene;
  if (ctx.source !== undefined) {
    working = ctx.deleteSource
      ? pruneOrphanLayers(working)
      : releaseTraceSourcePalette(working, ctx.source);
  }
  const created = createArtworkOperation(working, prepared, { mode: 'image' });
  const committed: RasterImage = {
    ...(created.object as RasterImage),
    operationOverride: {
      ...(prepared.operationOverride ?? { negativeImage: false }),
      // The fresh operation and this object override must both be Image mode or
      // a source `mode: line` override would silently suppress the raster output.
      mode: 'image',
    },
  };
  const nextScene = addLayer(
    placeRasterizedTrace(working, committed, ctx.replaceInPlace),
    operationForRasterizedTrace(created.operation, prepared, ctx.source, ctx.fallbackLayer),
  );
  return { scene: nextScene, committed };
}

function prepareRasterizedTrace(
  raster: RasterImage,
  sourceId: string,
  source: RasterImage | undefined,
): RasterImage {
  const {
    role: _role,
    operationIds: _operationIds,
    operationOverride: _operationOverride,
    powerScale: _powerScale,
    ...base
  } = raster;
  const settingsSource = source ?? raster;
  const operationOverride = {
    ...(settingsSource.operationOverride ?? {}),
    // Trace preview is black ink on white. A negative source layer is valid
    // for a photo but would invert this binary result into a burned backdrop.
    negativeImage: false,
  };
  const powerScale = settingsSource.powerScale;
  return {
    ...base,
    traceSourceId: sourceId,
    color: settingsSource.color,
    dither: settingsSource.dither,
    linesPerMm: settingsSource.linesPerMm,
    operationOverride,
    ...(powerScale === undefined ? {} : { powerScale }),
  };
}

function reusableImageOperationIds(scene: Scene, source: RasterImage): ReadonlyArray<string> {
  return scene.layers
    .filter((layer) =>
      activeOperationVariants(layer).some(
        (operation) =>
          sceneObjectUsesOperation(source, operation) &&
          (source.operationOverride?.mode ?? operation.mode) === 'image',
      ),
    )
    .map((layer) => layer.id);
}

function placeRasterizedTrace(scene: Scene, raster: RasterImage, replaceInPlace: boolean): Scene {
  return replaceInPlace ? replaceObject(scene, raster.id, raster) : addObject(scene, raster);
}

function activeOperationVariants(layer: Layer): ReadonlyArray<Layer> {
  if (!layer.output) return [];
  return [
    layer,
    ...layer.subLayers
      .filter((subLayer) => subLayer.enabled)
      .map((subLayer) => layerFromSubLayer(layer, subLayer)),
  ];
}

function operationVariants(layer: Layer): ReadonlyArray<Layer> {
  return [layer, ...layer.subLayers.map((subLayer) => layerFromSubLayer(layer, subLayer))];
}

function firstBoundLayer(scene: Scene, source: RasterImage): Layer | undefined {
  return scene.layers.find((layer) =>
    operationVariants(layer).some((operation) => sceneObjectUsesOperation(source, operation)),
  );
}

function operationForRasterizedTrace(
  created: Layer,
  raster: RasterImage,
  source: RasterImage | undefined,
  fallbackLayer: Layer | undefined,
): Layer {
  const inherited = inheritedOperationSettings(source, fallbackLayer);
  if (inherited !== null) return { ...created, ...inherited, mode: 'image' };
  return {
    ...created,
    mode: 'image',
    ditherAlgorithm: raster.operationOverride?.ditherAlgorithm ?? raster.dither,
    linesPerMm: raster.operationOverride?.linesPerMm ?? raster.linesPerMm,
  };
}

function inheritedOperationSettings(
  source: RasterImage | undefined,
  layer: Layer | undefined,
): LayerOperationSettings | null {
  if (source === undefined || layer === undefined) return null;
  return captureLayerOperationSettings({ ...layer, ...(source.operationOverride ?? {}) });
}
