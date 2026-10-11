import type { ColoredPath, Project, SceneObject } from '../../core/scene';

const WORKER_THRESHOLD = 500_000;

// This is a scheduling threshold, not a file or geometry limit. Count stored
// arrays by length rather than visiting their points or serializing the scene.
export function projectSaveNeedsWorker(project: Project): boolean {
  try {
    return largeProject(project);
  } catch {
    // Scheduling cannot replace the canonical runtime validation or its raw
    // recovery offer when a typed live value is malformed.
    return false;
  }
}

function largeProject(project: Project): boolean {
  // Archived sheets need worker validation; page-backed pixels must be embedded
  // before a fresh Choose file click, regardless of the active scene's size.
  if (hasExternalProjectAssets(project)) return true;
  let work = projectTextWork(project);
  if (work >= WORKER_THRESHOLD) return true;
  work += studioDocumentWork(project);
  if (work >= WORKER_THRESHOLD) return true;
  const objects = project.scene?.objects;
  if (!Array.isArray(objects)) return false;
  if (objects.length >= 250) return true;
  for (const object of objects) {
    work += objectWork(object);
    if (work >= WORKER_THRESHOLD) return true;
  }
  return work >= WORKER_THRESHOLD;
}

function projectTextWork(project: Project): number {
  let work = stringWork(project.notes);
  if (work >= WORKER_THRESHOLD) return work;
  for (const font of Array.isArray(project.embeddedFonts) ? project.embeddedFonts : []) {
    work += stringWork(font?.dataBase64);
    if (work >= WORKER_THRESHOLD) return work;
  }
  return work;
}

function studioDocumentWork(project: Project): number {
  const documents = Array.isArray(project.studioDocuments) ? project.studioDocuments : [];
  let work = 0;
  for (const document of documents) {
    work += stringWork(document?.nativeBase64);
    if (work >= WORKER_THRESHOLD) return work;
  }
  return work + sketchDocumentWork(project);
}

function sketchDocumentWork(project: Project): number {
  const source = project.designStudioDocument;
  if (source === undefined) return 0;
  // Guides and unapplied source can be much larger than generated scene output.
  // Do not visit individual points or serialize merely to schedule the save.
  if (source.sketch.entities.length >= 250) return WORKER_THRESHOLD;
  let work =
    ((source.sketch.layers?.length ?? 0) +
      source.appliedObjectIds.length +
      source.appliedOperationsByLayer.length +
      source.appliedEntityObjectIds.length) *
    100;
  if (work >= WORKER_THRESHOLD) return work;
  for (const entity of source.sketch.entities) {
    work += entity.kind === 'path' ? entity.points.length * 100 : 100;
    if (work >= WORKER_THRESHOLD) return work;
  }
  return work;
}

function hasExternalProjectAssets(project: Project): boolean {
  return (
    (project.sheetBook?.inactive.length ?? 0) > 0 ||
    project.productionManifest !== undefined ||
    (project.arrayLayouts?.length ?? 0) > 0 ||
    project.scene.objects.some(
      (object) => object.kind === 'raster-image' && object.imageAsset !== undefined,
    )
  );
}

function stringWork(value: unknown): number {
  return typeof value === 'string' ? value.length : 0;
}

function objectWork(object: SceneObject): number {
  try {
    return knownObjectWork(object);
  } catch {
    return 0;
  }
}

function knownObjectWork(object: SceneObject): number {
  if ('paths' in object) return pathWork(object.paths);
  if (object.kind === 'raster-image') {
    return (
      (object.dataUrl?.length ?? 0) +
      (object.lumaBase64?.length ?? 0) +
      photoSourceWork(object) +
      pathWork(object.imageClip ?? [])
    );
  }
  if (object.kind === 'relief') {
    return object.reliefSource.kind === 'legacy-mesh'
      ? object.reliefSource.meshPositions.length * 30
      : object.reliefSource.samplesBase64.length;
  }
  return 0;
}

function photoSourceWork(object: Extract<SceneObject, { kind: 'raster-image' }>): number {
  let work = 0;
  for (const layer of object.editorDocument?.layers ?? []) {
    work += stringWork(layer.rgbaBase64);
    if (work >= WORKER_THRESHOLD) return work;
  }
  return work;
}

function pathWork(paths: ReadonlyArray<ColoredPath>): number {
  let work = 0;
  for (const path of paths) {
    for (const polyline of path.polylines) {
      work += polyline.points.length * 100;
      if (work >= WORKER_THRESHOLD) return work;
    }
    for (const curve of path.curves ?? []) {
      work += curve.segments.length * 150;
      if (work >= WORKER_THRESHOLD) return work;
    }
  }
  return work;
}
