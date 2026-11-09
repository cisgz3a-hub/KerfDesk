// serializeProject — turns a Project into a deterministic .lf2 string.
//
// The default uses 2-space JSON indentation; Save, autosave and the raw
// recovery copy write it compact (ADR-204 Amendment 2), at about a third of
// the size for dense vector artwork. Both formats retain a trailing newline
// and LF endings. V8's
// JSON.stringify preserves property insertion order, and all our domain
// constructors use consistent literal-shape orderings, so output is
// byte-deterministic given a byte-deterministic Project.

import {
  polylineToCurveSubpath,
  type ColoredPath,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { withPublicCameraIdentities } from '../../core/camera/model/public-camera-identity';
import { isBooleanCompoundObject } from '../../core/scene/boolean-compound';
import type { ImportedSvg } from '../../core/scene/scene-object';
import { compactLineGeometry } from '../../core/scene/compact-line-geometry';
import { isTextLengthLimitError } from './project-text-limit';
import { stringifyProjectJson, stringifyProjectJsonChunks } from './stringify-project-json';

export function serializeProject(
  project: Project,
  options: { readonly compact?: boolean } = {},
): string {
  const serializable = withCurveGeometry(project);
  const json = project.scene.objects.some(hasTypedRelief)
    ? stringifyProjectJson(serializable, options)
    : JSON.stringify(serializable, null, options.compact === true ? undefined : 2);
  return `${json}\n`;
}

/**
 * The compact text of `serializeProject`, as ordered chunks that are never
 * joined, so a project whose text passes the engine's longest string still
 * reaches a file as a Blob (the raw recovery copy, J10-P3-3). Each scene
 * object is written natively while its own text fits.
 */
export function serializeProjectChunks(project: Project): readonly string[] {
  const serializable = withCurveGeometry(project);
  const objects = serializable.scene.objects;
  const chunks = stringifyProjectJsonChunks(serializable, {
    compact: true,
    writeSubtree: (value, append) => {
      if (value !== objects) return false;
      append('[');
      for (let index = 0; index < objects.length; index += 1) {
        if (index > 0) append(',');
        for (const chunk of objectJsonChunks(objects[index])) append(chunk);
      }
      append(']');
      return true;
    },
  });
  return [...chunks, '\n'];
}

function objectJsonChunks(object: SceneObject | undefined): readonly string[] {
  // An array hole, as JSON.stringify writes it.
  if (object === undefined) return ['null'];
  if (!hasTypedRelief(object)) {
    try {
      return [JSON.stringify(object)];
    } catch (error) {
      if (!isTextLengthLimitError(error)) throw error;
    }
  }
  return stringifyProjectJsonChunks(object, { compact: true });
}

function hasTypedRelief(object: SceneObject): boolean {
  return (
    object.kind === 'relief' &&
    object.reliefSource.kind === 'legacy-mesh' &&
    (object.reliefSource.meshPositions instanceof Float32Array ||
      object.reliefSource.meshPositions instanceof Float64Array)
  );
}

function withCurveGeometry(project: Project): Project {
  return {
    ...project,
    // A saved camera is named only by its public address (ADR-692).
    device: withPublicCameraIdentities(project.device),
    scene: {
      ...project.scene,
      objects: project.scene.objects.map(withSerializableObject),
    },
  };
}

function withSerializableObject(object: SceneObject): SceneObject {
  if (object.kind === 'raster-image' && object.imageClip !== undefined)
    return { ...object, imageClip: serializablePaths(object.imageClip) };
  if (isBooleanCompoundObject(object)) return withSerializableCompound(object);
  if (!('paths' in object)) return object;
  if (object.kind === 'traced-image') {
    return { ...object, paths: object.paths.map(compactLineGeometry) };
  }
  return { ...object, paths: serializablePaths(object.paths) };
}

export function withSerializableCompound(
  object: ImportedSvg & { readonly booleanCompound: NonNullable<ImportedSvg['booleanCompound']> },
): ImportedSvg {
  return {
    ...object,
    paths: serializablePaths(object.paths),
    booleanCompound: {
      ...object.booleanCompound,
      operands: object.booleanCompound.operands.map((operand) => ({
        ...operand,
        object: { ...operand.object, paths: serializablePaths(operand.object.paths) },
      })),
    },
  };
}

function serializablePaths(paths: readonly ColoredPath[]): readonly ColoredPath[] {
  return paths.map((path) => ({
    ...path,
    curves: path.curves ?? path.polylines.map(polylineToCurveSubpath),
  }));
}
