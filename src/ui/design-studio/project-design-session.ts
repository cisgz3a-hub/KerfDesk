import { designEntityToSceneObject } from '../../core/design';
import { DEFAULT_DESIGN_LAYER } from '../../core/design/layers';
import { polylineToCurveSubpath, type Project, type SceneObject } from '../../core/scene';
import {
  createDesignSession,
  restoreDesignSession,
  sessionSketch,
  type DesignSession,
} from './design-session';
import { createDesignHistory } from './design-history';

export function restoreProjectDesignSession(project: Project): DesignSession {
  const saved = project.designStudioDocument;
  if (saved === undefined) return createDesignSession();
  return reconcileProjectDesignSession(
    restoreDesignSession({
      sketch: saved.sketch,
      activeLayerId: saved.activeLayerId,
      surface3d: saved.surface3d,
      applied: {
        objectIds: new Set(saved.appliedObjectIds),
        operationIdByLayerId: new Map(saved.appliedOperationsByLayer),
      },
      dirtySinceApply: false,
    }),
    project,
  );
}

/** Main-workspace geometry edits take precedence over an older authoring source. */
export function reconcileProjectDesignSession(
  session: DesignSession,
  project: Project,
): DesignSession {
  const saved = project.designStudioDocument;
  if (saved === undefined || session.applied === null) return session;
  const objects = new Map(project.scene.objects.map((object) => [object.id, object]));
  const entities = new Map(saved.sketch.entities.map((entity) => [entity.id, entity]));
  const detachedEntities = new Set<string>();
  const linkedObjects = new Set(saved.appliedEntityObjectIds.map(([, id]) => id));
  const detachedObjects = new Set(
    [...session.applied.objectIds].filter((id) => !linkedObjects.has(id)),
  );
  for (const [entityId, objectId] of saved.appliedEntityObjectIds) {
    if (!session.applied.objectIds.has(objectId)) continue;
    const entity = entities.get(entityId);
    const expected =
      entity === undefined
        ? null
        : designEntityToSceneObject(entity, objectId, DEFAULT_DESIGN_LAYER.color);
    const actual = objects.get(objectId);
    if (
      expected === null ||
      actual === undefined ||
      geometrySignature(expected) !== geometrySignature(actual)
    ) {
      detachedEntities.add(entityId);
      detachedObjects.add(objectId);
    }
  }
  if (detachedEntities.size === 0 && detachedObjects.size === 0) return session;
  return {
    ...session,
    history: createDesignHistory({
      ...sessionSketch(session),
      entities: sessionSketch(session).entities.filter(
        (entity) => !detachedEntities.has(entity.id),
      ),
    }),
    selectedIds: new Set([...session.selectedIds].filter((id) => !detachedEntities.has(id))),
    applied: {
      ...session.applied,
      objectIds: new Set([...session.applied.objectIds].filter((id) => !detachedObjects.has(id))),
    },
  };
}

function geometrySignature(object: SceneObject): string {
  if (object.kind !== 'shape' && object.kind !== 'imported-svg') return object.kind;
  const t = object.transform;
  return JSON.stringify([
    object.kind,
    [t.x, t.y, t.scaleX, t.scaleY, t.rotationDeg, t.mirrorX, t.mirrorY],
    object.kind === 'shape' ? object.spec : null,
    object.paths.map((path) => path.curves ?? path.polylines.map(polylineToCurveSubpath)),
    object.paths.map((path) =>
      path.polylines.map((polyline) => [
        polyline.closed,
        polyline.points.map((point) => [point.x, point.y]),
      ]),
    ),
  ]);
}
