import {
  addLayer,
  addObject,
  captureLayerOperationSettings,
  createArtworkOperation,
  layerFromSubLayer,
  type Layer,
  type LayerOperationSettings,
  type RasterImage,
  remapSceneObjectOperationBindings,
  removeObject,
  replaceObject,
  type Scene,
  sceneObjectUsesOperation,
} from '../../core/scene';
import { cloneLayerSubLayers } from '../../core/scene/layer';
import {
  type MutationResult,
  pruneOrphanLayers,
  pushUndo,
  type StateSlice,
  type TraceExistingImageOptions,
} from './scene-mutations';
import {
  effectiveOperationForObject,
  operationOverrideForObject,
} from '../../core/effective-output';
import { repairRemovedProjectObjectReferences } from './repair-object-dependencies';
import { placeRasterTraceResult, replacedTraceResult } from './retrace-carry';

/**
 * Atomically replace a trace result with an Image-pipeline raster.
 *
 * The derived bitmap burns with the source photo's effective Image operations
 * so speed, power, dither, density, passes, and scan direction do not silently
 * change. A deleted source hands its operations to the result (they survive
 * because the result is added before orphan pruning). A kept source is an
 * ordinary image that engraves on its own operations (ADR-673), so the result
 * gets copies of them instead: either can then be turned off on its own, like
 * a LightBurn image and its trace on separate layers. Re-trace in place keeps
 * the result's own operations. The copies are reported as inherited so the
 * fresh-operation seeding of a trace commit leaves their settings alone.
 */
export function applyRasterizedTraceToExisting(
  s: StateSlice,
  sourceId: string,
  raster: RasterImage,
  options: TraceExistingImageOptions = {},
): MutationResult &
  ReturnType<typeof repairRemovedProjectObjectReferences> & {
    readonly additionalSelectedIds: ReadonlySet<string>;
    readonly inheritedOperationIds: ReadonlyArray<string>;
  } {
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
  if (source !== undefined && options.deleteSourceAfterTrace === true) {
    scene = removeObject(scene, source.id);
  }

  // Re-trace keeps where the operator put the result (ADR-408 Amendment 1).
  const prepared = placeRasterTraceResult(
    prepareRasterizedTrace(raster, sourceId, source),
    replacedTraceResult(s.project.scene, options.replaceTraceId),
    source,
    options.retraceSourceTransform,
  );
  const inPlace =
    options.replaceTraceId === raster.id
      ? scene.objects.find((object) => object.id === raster.id)
      : undefined;
  // A vector result re-traced as a raster swaps kind in place; only a raster
  // result has Image operations of its own to keep.
  const replaced = inPlace?.kind === 'raster-image' ? inPlace : undefined;
  const bound = bindRasterizedTrace(scene, prepared, {
    source,
    fallbackLayer,
    deleteSource: options.deleteSourceAfterTrace === true,
    replaceInPlace: inPlace !== undefined,
    replaced,
    reusableOperationIds,
  });
  const committed = bound.committed;
  scene = pruneOrphanLayers(bound.scene);
  return {
    ...repairRemovedProjectObjectReferences({ ...s.project, scene }),
    selectedObjectId: committed.id,
    additionalSelectedIds: new Set<string>(),
    inheritedOperationIds: bound.inheritedOperationIds ?? [],
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

type RasterBindingContext = FreshRasterOperationContext & {
  readonly replaced: RasterImage | undefined;
  readonly reusableOperationIds: ReadonlyArray<string>;
};

type BoundRasterizedTrace = {
  readonly scene: Scene;
  readonly committed: RasterImage;
  // Operations copied from the kept source, settings included.
  readonly inheritedOperationIds?: ReadonlyArray<string>;
};

function bindRasterizedTrace(
  scene: Scene,
  prepared: RasterImage,
  ctx: RasterBindingContext,
): BoundRasterizedTrace {
  const ownOperations = ctx.replaced === undefined ? null : liveBinding(scene, ctx.replaced);
  if (ctx.replaced !== undefined && ownOperations !== null) {
    const committed = withResultSettings(prepared, ctx.replaced, ownOperations);
    return { scene: placeRasterizedTrace(scene, committed, true), committed };
  }
  if (ctx.reusableOperationIds.length === 0)
    return allocateFreshRasterOperation(scene, prepared, ctx);
  const shared = { ...prepared, operationIds: ctx.reusableOperationIds };
  if (ctx.source !== undefined && !ctx.deleteSource) {
    return copySourceOperations(scene, shared, ctx.replaceInPlace);
  }
  return { scene: placeRasterizedTrace(scene, shared, ctx.replaceInPlace), committed: shared };
}

// The replaced result's operation ids when every one still exists.
function liveBinding(scene: Scene, result: RasterImage): ReadonlyArray<string> | null {
  const ids = result.operationIds;
  if (ids === undefined || ids.length === 0) return null;
  return ids.every((id) => scene.layers.some((layer) => layer.id === id)) ? ids : null;
}

// Re-trace in place changes the bitmap, not the result's operations or the
// settings the operator gave this result.
function withResultSettings(
  prepared: RasterImage,
  replaced: RasterImage,
  operationIds: ReadonlyArray<string>,
): RasterImage {
  const { operationOverride: _override, powerScale: _powerScale, ...content } = prepared;
  return {
    ...content,
    color: replaced.color,
    operationIds,
    ...(replaced.operationOverride === undefined
      ? {}
      : { operationOverride: replaced.operationOverride }),
    ...(replaced.powerScale === undefined ? {} : { powerScale: replaced.powerScale }),
  };
}

// A kept source keeps its operations; the result burns with copies of them,
// sub-operations and per-artwork settings included, after the source's.
function copySourceOperations(
  scene: Scene,
  shared: RasterImage,
  replaceInPlace: boolean,
): BoundRasterizedTrace {
  const sourceOperations = scene.layers.filter((layer) => shared.operationIds?.includes(layer.id));
  let working = scene;
  const copies = new Map<string, string>();
  for (const operation of sourceOperations) {
    const created = createArtworkOperation(working, shared, {
      mode: 'image',
      subLayers: operation.subLayers,
    });
    working = addLayer(working, {
      ...operation,
      id: created.operation.id,
      name: created.operation.name,
      color: created.operation.color,
      subLayers: cloneLayerSubLayers(operation.subLayers),
    });
    copies.set(operation.id, created.operation.id);
  }
  const committed = remapSceneObjectOperationBindings(
    shared,
    sourceOperations,
    copies,
  ) as RasterImage;
  return {
    scene: placeRasterizedTrace(working, committed, replaceInPlace),
    committed,
    inheritedOperationIds: [...copies.values()],
  };
}

// The no-reusable-Image-operation branch: allocate a fresh Image operation for
// the rasterized trace. Extracted so applyRasterizedTraceToExisting stays under
// the complexity cap.
function allocateFreshRasterOperation(
  scene: Scene,
  prepared: RasterImage,
  ctx: FreshRasterOperationContext,
): { readonly scene: Scene; readonly committed: RasterImage } {
  // A deleted source's operation is already orphaned: prune it before
  // allocating (mirror of applyTraceToExisting) so its colour frees. A kept
  // source keeps its operation and colour.
  const working = ctx.source !== undefined && ctx.deleteSource ? pruneOrphanLayers(scene) : scene;
  const created = createArtworkOperation(working, prepared, { mode: 'image' });
  const committed: RasterImage = {
    ...(created.object as RasterImage),
    operationOverride: {
      ...operationOverrideForObject(ctx.fallbackLayer ?? created.operation, prepared),
      negativeImage: false,
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
    operationIds: _operationIds,
    operationOverride: _operationOverride,
    powerScale: _powerScale,
    ...base
  } = raster;
  const settingsSource = source ?? raster;
  const operationOverride = {
    ...(settingsSource.operationOverride ?? {}),
    ...(settingsSource.operationOverride?.byOperation === undefined
      ? {}
      : {
          byOperation: Object.fromEntries(
            Object.entries(settingsSource.operationOverride.byOperation).map(([id, settings]) => [
              id,
              { ...settings, negativeImage: false },
            ]),
          ),
        }),
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
          effectiveOperationForObject(operation, source).mode === 'image',
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
  return captureLayerOperationSettings(effectiveOperationForObject(layer, source));
}
