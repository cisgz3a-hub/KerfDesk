import type { PlatformAdapter } from '../../platform/types';
import type { StampEncodedDraft } from '../raster/stamp-worker-protocol';
import type { ToastVariant } from '../state/toast-store';
export async function exportStampDraft(
  platform: PlatformAdapter,
  draft: StampEncodedDraft,
  current: () => boolean,
  toast: (message: string, variant?: ToastVariant) => void,
): Promise<void> {
  if (!current()) return;
  try {
    const target = await platform.pickFileForSave({
      suggestedName: 'stamp-height-intent.png',
      extensions: ['.png'],
    });
    if (target === null || !current()) return;
    const prefix = 'data:image/png;base64,';
    if (!draft.dataUrl.startsWith(prefix)) throw new Error('The prepared PNG is unavailable.');
    const bytes = Uint8Array.from(atob(draft.dataUrl.slice(prefix.length)), (character) =>
      character.charCodeAt(0),
    );
    await target.write(new Blob([bytes], { type: 'image/png' }));
    toast(
      `Saved stamp intent to ${target.displayName}. Physical extent: ${draft.widthMm.toFixed(3)} × ${draft.heightMm.toFixed(3)} mm; set this extent when importing the PNG.`,
      'success',
    );
  } catch (failure) {
    toast(failure instanceof Error ? failure.message : 'Stamp export failed.', 'error');
  }
}
