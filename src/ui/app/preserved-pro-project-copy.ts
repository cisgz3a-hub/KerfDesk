import { serializeProject } from '../../io/project';
import type { PlatformAdapter } from '../../platform/types';
import type { PagedRasterAssetReader } from '../import/paged-raster-hydration';
import type { PendingProProject } from '../state/pending-pro-project';
import { pickPreparedSaveTarget } from './pick-prepared-save-target';
import { portableProjectAssets } from './portable-project-assets';

/** Save As only: never adopt a target, mark the workspace saved or clear autosave. */
export async function savePreservedProProjectCopy(
  pending: PendingProProject,
  platform: Pick<PlatformAdapter, 'pickFileForSave'>,
  assetReader?: PagedRasterAssetReader,
): Promise<'saved' | 'cancelled'> {
  const stem = (
    pending.name ?? (pending.source === 'autosave' ? 'autosaved-project' : 'project')
  ).replace(/\.(lf2template|lf2|lbrn2?)$/i, '');
  // The picker empties an existing file as it returns (ADR-656), so assets are
  // read first; a slow read then asks for a fresh Choose file click.
  const portable = await portableProjectAssets(pending.project, assetReader);
  const content = serializeProject(portable);
  const target = await pickPreparedSaveTarget(
    platform,
    { suggestedName: `${stem}-preserved.lf2`, extensions: ['.lf2'] },
    { title: 'Save a copy', message: 'The project copy is ready.' },
  );
  if (target === null) return 'cancelled';
  await target.write(content);
  return 'saved';
}
