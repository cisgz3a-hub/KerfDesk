import type { SceneObject } from '../../core/scene';
import { usePagedImportStore } from './paged-import-store';

export async function requestPagedArtwork(
  file: File,
  kind: 'pdf' | 'tiff',
  isCurrent: () => boolean,
  commit: (object: SceneObject) => void,
): Promise<SceneObject | null> {
  const source =
    kind === 'pdf'
      ? await (await import('./pdf-artwork-source')).openPdfArtwork(file)
      : await (await import('./tiff-artwork-source')).openTiffArtwork(file);
  try {
    if (!isCurrent()) return null;
    return await new Promise<SceneObject | null>((resolve) => {
      usePagedImportStore.getState().open({ source, isCurrent, commit, resolve });
    });
  } finally {
    await source.dispose();
  }
}
