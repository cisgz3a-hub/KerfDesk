import { polylineToCurveSubpath, type Project, type SceneObject } from '../../core/scene';
import { sha256Hex } from '../../core/relief/sha256';

const owners = new WeakMap<Project, string>();

/** Exact authoring revision plus persisted object IDs distinguish independently
 * created drawings without adding browser recovery metadata to the project file.
 * Blank startup drafts retain the existing epoch-zero recovery path only. */
export function designRecoveryOwner(project: Project): string | undefined {
  const cached = owners.get(project);
  if (cached !== undefined) return cached;
  const document = project.designStudioDocument;
  if (document === undefined && project.scene.objects.length === 0) return undefined;
  const linked = new Set(document?.appliedObjectIds ?? []);
  const identity = JSON.stringify({
    sheet: project.sheetBook?.activeId,
    document,
    objects: project.scene.objects.map((object) =>
      linked.has(object.id) ? outputIdentity(object) : [object.id, object.kind],
    ),
  });
  // Keep ownership bounded: embedding the full source a second time would
  // consume the recovery drawing's existing localStorage allowance.
  const owner = `sha256:${sha256Hex([new TextEncoder().encode(identity)])}`;
  owners.set(project, owner);
  return owner;
}

function outputIdentity(object: SceneObject): unknown {
  if (object.kind !== 'shape' && object.kind !== 'imported-svg') return [object.id, object.kind];
  return [
    object.id,
    object.kind,
    object.transform,
    object.kind === 'shape' ? object.spec : null,
    object.paths.map((path) => [
      path.color,
      path.curves ?? path.polylines.map(polylineToCurveSubpath),
      path.polylines,
    ]),
  ];
}
