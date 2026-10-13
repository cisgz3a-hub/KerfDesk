// File > Download operation palette...: KerfDesk's operation colours as a
// GIMP/Inkscape (.gpl), Adobe Swatch Exchange (.ase) or CorelDRAW (.xml)
// palette, picked by the file type chosen in the save dialog.

import { OPERATION_PALETTE } from '../../core/scene/artwork-operation';
import { writePalette, type PaletteFormat } from '../../io/palette/palette-files';
import type { PlatformAdapter } from '../../platform/types';
import type { ToastVariant } from '../state/toast-store';

const TITLE = 'KerfDesk operations';

export function operationPaletteColors(): ReadonlyArray<{ name: string; hex: string }> {
  return OPERATION_PALETTE.map((hex, index) => ({
    name: `KerfDesk ${String(index + 1).padStart(2, '0')} ${hex.toUpperCase()}`,
    hex,
  }));
}

function formatOf(name: string): PaletteFormat | null {
  const extension = name.toLowerCase().split('.').pop();
  return extension === 'gpl' || extension === 'ase' || extension === 'xml' ? extension : null;
}

export async function handleExportPalette(args: {
  readonly platform: PlatformAdapter;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
}): Promise<void> {
  try {
    const target = await args.platform.pickFileForSave({
      suggestedName: 'kerfdesk-operations.gpl',
      extensions: ['.gpl', '.ase', '.xml'],
    });
    if (target === null) return;
    const format = formatOf(target.displayName) ?? 'gpl';
    const data = writePalette(format, TITLE, operationPaletteColors());
    await target.write(
      typeof data === 'string'
        ? new Blob([data], { type: format === 'xml' ? 'application/xml' : 'text/plain' })
        : new Blob([new Uint8Array(data)], { type: 'application/octet-stream' }),
    );
    args.pushToast(
      `Saved the ${OPERATION_PALETTE.length}-colour operation palette to ${target.displayName}. Artwork drawn in these colours imports onto matching operations.`,
      'success',
    );
  } catch (error) {
    args.pushToast(
      `Could not save the palette: ${error instanceof Error ? error.message : String(error)}`,
      'error',
    );
  }
}
