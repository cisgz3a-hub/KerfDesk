import type { Polyline, Project, SceneObject } from '../../core/scene';
import { RecoveryHash, RecoveryArray } from './design-recovery-hash';

const owners = new WeakMap<Project, string | RecoveryHash>();

/** Exact authoring revision plus persisted object IDs distinguish independently
 * created drawings without adding browser recovery metadata to the project file.
 * Blank startup drafts retain the existing epoch-zero recovery path only. */
export function designRecoveryOwner(project: Project): string | undefined | Promise<string> {
  const cached = owners.get(project);
  if (cached !== undefined) return cached instanceof RecoveryHash ? cached.result : cached;
  const document = project.designStudioDocument;
  if (document === undefined && project.scene.objects.length === 0) return undefined;
  const linked = new Set(document?.appliedObjectIds ?? []);
  const identity = {
    sheet: project.sheetBook?.activeId,
    document,
    objects: mappedArray(project.scene.objects, (object) =>
      linked.has(object.id) ? outputIdentity(object) : [object.id, object.kind],
    ),
  };
  // Keep ownership bounded: embedding the full source a second time would
  // consume the recovery drawing's existing localStorage allowance.
  const owner = new RecoveryHash(identity);
  owners.set(project, owner);
  void owner.result.then(
    (digest) => {
      if (owners.get(project) === owner) owners.set(project, digest);
    },
    () => {
      if (owners.get(project) === owner) owners.delete(project);
    },
  );
  return owner.result;
}

/** A superseded immutable project must not retain a queued geometry walk. */
export function cancelPendingDesignRecoveryOwner(project: Project): void {
  const owner = owners.get(project);
  if (!(owner instanceof RecoveryHash)) return;
  owners.delete(project);
  owner.cancel();
}

/** Cleanup only: preserve the existing final synchronous recovery write. */
export function finishDesignRecoveryOwnerAtTeardown(project: Project): string | undefined {
  const owner = designRecoveryOwner(project);
  if (!(owner instanceof Promise)) return owner;
  const pending = owners.get(project);
  if (!(pending instanceof RecoveryHash)) return pending;
  const digest = pending.finishAtTeardown();
  owners.set(project, digest);
  return digest;
}

function outputIdentity(object: SceneObject): unknown {
  if (object.kind !== 'shape' && object.kind !== 'imported-svg') return [object.id, object.kind];
  return [
    object.id,
    object.kind,
    object.transform,
    object.kind === 'shape' ? object.spec : null,
    mappedArray(object.paths, (path) => [
      path.color,
      path.curves ?? mappedArray(path.polylines, curveIdentity),
      path.polylines,
    ]),
  ];
}

function mappedArray<T>(values: readonly T[], map: (value: T) => unknown): RecoveryArray {
  return new RecoveryArray(
    (function* () {
      for (const value of values) yield map(value);
    })(),
  );
}

function curveIdentity(polyline: Polyline): unknown {
  return {
    start: polyline.points[0] ?? { x: 0, y: 0 },
    segments: new RecoveryArray(
      (function* () {
        for (let index = 1; index < polyline.points.length; index++)
          yield { kind: 'line', to: polyline.points[index] };
      })(),
    ),
    closed: polyline.closed,
  };
}
