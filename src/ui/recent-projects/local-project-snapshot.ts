import type { Project } from '../../core/scene';
import { prepareProjectForPersistence, serializeProject } from '../../io/project';
import { portableProjectAssets } from '../app/portable-project-assets';
import type { PagedRasterAssetReader } from '../import/paged-raster-hydration';

export const MAX_LOCAL_SNAPSHOTS = 12;
export const MAX_LOCAL_SNAPSHOT_BYTES = 128 * 1024 * 1024;
export const MAX_LOCAL_SNAPSHOT_TOTAL_BYTES = 256 * 1024 * 1024;

export type LocalProjectSnapshotHeader = {
  readonly id: string;
  readonly name: string;
  readonly createdAt: number;
  readonly bytes: number;
  readonly notesExcerpt: string;
};
export type LocalProjectSnapshot = LocalProjectSnapshotHeader & {
  readonly version: 1;
  readonly projectJson: string;
};

/** A named copy owns all pixels and editable font data, like Save, rather than local asset IDs. */
export async function captureLocalProjectSnapshot(
  project: Project,
  name: string,
  reader?: PagedRasterAssetReader,
): Promise<LocalProjectSnapshot> {
  const label = name.trim().slice(0, 120);
  if (label === '') throw new Error('Give this snapshot a name.');
  const prepared = prepareProjectForPersistence(project);
  if (prepared.kind !== 'ok') throw new Error(prepared.reason);
  const portable = await portableProjectAssets(prepared.project, reader);
  const projectJson = serializeProject(portable);
  const bytes = new TextEncoder().encode(projectJson).byteLength;
  if (bytes > MAX_LOCAL_SNAPSHOT_BYTES)
    throw new Error(
      'This copy exceeds the 128 MiB local snapshot limit. Save a project file instead.',
    );
  return {
    version: 1,
    id: crypto.randomUUID(),
    name: label,
    createdAt: Date.now(),
    bytes,
    notesExcerpt: portable.notes.slice(0, 600),
    projectJson,
  };
}

export function snapshotHeader(snapshot: LocalProjectSnapshot): LocalProjectSnapshotHeader {
  const { id, name, createdAt, bytes, notesExcerpt } = snapshot;
  return { id, name, createdAt, bytes, notesExcerpt };
}

export function validateSnapshotCapacity(
  headers: ReadonlyArray<LocalProjectSnapshotHeader>,
  snapshot: LocalProjectSnapshot,
): void {
  if (headers.some((entry) => entry.id === snapshot.id))
    throw new Error('A snapshot with this identity already exists.');
  if (headers.length >= MAX_LOCAL_SNAPSHOTS)
    throw new Error('The 12 local snapshot slots are full. Remove a copy before adding another.');
  const total = headers.reduce((sum, header) => sum + header.bytes, snapshot.bytes);
  if (snapshot.bytes > MAX_LOCAL_SNAPSHOT_BYTES || total > MAX_LOCAL_SNAPSHOT_TOTAL_BYTES)
    throw new Error(
      'Local snapshots exceed the 256 MiB storage budget. Remove a copy or save a file.',
    );
}
