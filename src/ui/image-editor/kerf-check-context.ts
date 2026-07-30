import type { RgbaBuffer } from '../../core/image-edit';
import type { Layer, Project, RasterImage } from '../../core/scene';
import type { EditorSession } from './editor-session';

/** Exact editor and scene ownership captured by one kerf-check result. */
export type KerfCheckContext = {
  readonly object: RasterImage;
  readonly layer: Layer;
  readonly sourceDoc: RgbaBuffer;
  readonly revision: number;
  readonly activeLayerId: string;
  readonly width: number;
  readonly height: number;
  readonly thresholdMm: number;
};

/** Resolve the Image-mode dot-width context owned by the current editor session. */
export function kerfCheckContext(
  session: EditorSession,
  project: Project,
): KerfCheckContext | null {
  const found = project.scene.objects.find((candidate) => candidate.id === session.objectId);
  const object = found?.kind === 'raster-image' ? found : undefined;
  const layer =
    object === undefined
      ? undefined
      : project.scene.layers.find((candidate) => candidate.color === object.color);
  if (object === undefined || layer === undefined) return null;
  const effective = { ...layer, ...object.operationOverride };
  if (
    effective.mode !== 'image' ||
    !Number.isFinite(effective.linesPerMm) ||
    effective.linesPerMm <= 0
  ) {
    return null;
  }
  const thresholdMm = Math.min(
    Math.max(0, effective.dotWidthCorrectionMm),
    1 / effective.linesPerMm,
  );
  if (thresholdMm <= 0) return null;
  return {
    object,
    layer,
    sourceDoc: session.doc,
    revision: session.revision,
    activeLayerId: session.activeLayerId,
    width: session.doc.width,
    height: session.doc.height,
    thresholdMm,
  };
}

/** True only while the captured editor and dot-width inputs still own the action. */
export function isKerfCheckContextCurrent(
  expected: KerfCheckContext,
  session: EditorSession,
  project: Project,
): boolean {
  const current = kerfCheckContext(session, project);
  return (
    current !== null &&
    current.object === expected.object &&
    current.layer === expected.layer &&
    current.sourceDoc === expected.sourceDoc &&
    current.revision === expected.revision &&
    current.activeLayerId === expected.activeLayerId &&
    current.width === expected.width &&
    current.height === expected.height &&
    current.thresholdMm === expected.thresholdMm
  );
}
