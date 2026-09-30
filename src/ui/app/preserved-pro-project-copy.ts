import { serializeProject } from '../../io/project';
import type { PlatformAdapter } from '../../platform/types';
import type { PagedRasterAssetReader } from '../import/paged-raster-hydration';
import type { PendingProProject } from '../state/pending-pro-project';
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
  // Keep the picker in the click's user gesture; asset hydration can take time.
  const target = await platform.pickFileForSave({
    suggestedName: `${stem}-preserved.lf2`,
    extensions: ['.lf2'],
  });
  if (target === null) return 'cancelled';
  const portable = await portableProjectAssets(pending.project, assetReader);
  const content = serializeProject(portable);
  await target.write(content);
  return 'saved';
}
