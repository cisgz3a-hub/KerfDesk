import type { RgbaBuffer } from '../../core/image-edit';
import type { DeviceProfile } from '../../core/devices';
import type { JobPlacementSettings } from '../../core/job';
import {
  outputOperationLayers,
  sceneObjectUsesOperation,
  validateOutputScope,
  type Layer,
  type OutputScope,
  type Project,
  type RasterImage,
  type SceneObject,
} from '../../core/scene';
import type { EditorSession } from './editor-session';

/** Exact editor, output-scope, and scene ownership captured by one result. */
export type KerfCheckContext = {
  readonly object: RasterImage;
  readonly layers: ReadonlyArray<Layer>;
  readonly device: DeviceProfile;
  readonly maskObject: SceneObject | null;
  readonly sourceDoc: RgbaBuffer;
  readonly revision: number;
  readonly activeLayerId: string;
  readonly width: number;
  readonly height: number;
  readonly outputScopeKey: string;
  readonly outputPlacementKey: string;
};

type KerfCheckCurrentInput = {
  readonly expected: KerfCheckContext;
  readonly session: EditorSession;
  readonly project: Project;
  readonly outputScope: OutputScope;
  readonly jobPlacement: JobPlacementSettings;
};

/**
 * Resolve the edited raster's active Image-mode dot-width output topology.
 * Non-absolute placements suppress this optional advisory because the strict
 * emitter operands depend on the whole prepared job's translated bounds.
 */
export function kerfCheckContext(
  session: EditorSession,
  project: Project,
  outputScope: OutputScope,
  jobPlacement: JobPlacementSettings,
): KerfCheckContext | null {
  if (project.machine?.kind === 'cnc' || jobPlacement.startFrom !== 'absolute') return null;
  const scoped = validateOutputScope(project.scene, outputScope);
  if (!scoped.ok) return null;
  const found = scoped.scene.objects.find((candidate) => candidate.id === session.objectId);
  const object = found?.kind === 'raster-image' ? found : undefined;
  if (object === undefined) return null;
  const layers = project.scene.layers.filter((layer) =>
    outputOperationLayers(layer).some((operation) => operationUsesEditedRaster(operation, object)),
  );
  const hasPositiveCorrection = layers.some((layer) =>
    outputOperationLayers(layer).some((operation) => {
      if (!operationUsesEditedRaster(operation, object)) return false;
      const effective = effectiveOperation(operation, object);
      return Number.isFinite(effective.dotWidthCorrectionMm) && effective.dotWidthCorrectionMm > 0;
    }),
  );
  if (layers.length === 0 || !hasPositiveCorrection) return null;
  const maskObject =
    object.imageMaskId === undefined
      ? null
      : (scoped.scene.objects.find((candidate) => candidate.id === object.imageMaskId) ?? null);
  return {
    object,
    layers,
    device: project.device,
    maskObject,
    sourceDoc: session.doc,
    revision: session.revision,
    activeLayerId: session.activeLayerId,
    width: session.doc.width,
    height: session.doc.height,
    outputScopeKey: outputScopeIdentity(outputScope),
    outputPlacementKey: outputPlacementIdentity(jobPlacement),
  };
}

/** Resolve one compiled raster group back to its materialized operation. */
export function kerfOperationLayer(context: KerfCheckContext, layerId: string): Layer | null {
  return (
    context.layers
      .flatMap((layer) => outputOperationLayers(layer))
      .find((layer) => layer.id === layerId) ?? null
  );
}

/** True only while captured editor and output-topology inputs still own the action. */
export function isKerfCheckContextCurrent(input: KerfCheckCurrentInput): boolean {
  const { expected, session, project, outputScope, jobPlacement } = input;
  const current = kerfCheckContext(session, project, outputScope, jobPlacement);
  return (
    current !== null &&
    current.object === expected.object &&
    sameLayerIdentities(current.layers, expected.layers) &&
    current.device === expected.device &&
    current.maskObject === expected.maskObject &&
    current.sourceDoc === expected.sourceDoc &&
    current.revision === expected.revision &&
    current.activeLayerId === expected.activeLayerId &&
    current.width === expected.width &&
    current.height === expected.height &&
    current.outputScopeKey === expected.outputScopeKey &&
    current.outputPlacementKey === expected.outputPlacementKey
  );
}

function outputScopeIdentity(outputScope: OutputScope): string {
  return JSON.stringify({
    cutSelectedGraphics: outputScope.cutSelectedGraphics,
    useSelectionOrigin: outputScope.useSelectionOrigin,
    selectedObjectIds: outputScope.selectedObjectIds,
  });
}

function outputPlacementIdentity(jobPlacement: JobPlacementSettings): string {
  return JSON.stringify(jobPlacement);
}

function operationUsesEditedRaster(operation: Layer, object: RasterImage): boolean {
  if (!sceneObjectUsesOperation(object, operation)) return false;
  const effective = effectiveOperation(operation, object);
  return (
    effective.mode === 'image' && Number.isFinite(effective.linesPerMm) && effective.linesPerMm > 0
  );
}

function effectiveOperation(operation: Layer, object: RasterImage): Layer {
  return object.operationOverride === undefined
    ? operation
    : { ...operation, ...object.operationOverride };
}

function sameLayerIdentities(left: ReadonlyArray<Layer>, right: ReadonlyArray<Layer>): boolean {
  return left.length === right.length && left.every((layer, index) => layer === right[index]);
}
