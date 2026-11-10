// EPS, PostScript and Illustrator 3–8 import (ADR-700): the file's drawing is
// converted to SVG text, then imported exactly as an SVG file would be.

import type { SceneObject } from '../../core/scene';
import type { SvgArtworkFragment } from '../state/svg-fragment-mutation';
import type { ImportOutcome } from '../state/store';
import type { ToastOptions, ToastVariant } from '../state/toast-store';
import { readImagePrefix } from '../trace/image-header-reader';
import { importSvgFiles } from './svg-import-action';

type ImportPostscriptContext = {
  readonly importObject: (object: SceneObject, batchIndex?: number) => ImportOutcome;
  readonly importFragment?: (fragment: SvgArtworkFragment, batchIndex?: number) => ImportOutcome;
  readonly pushToast: (message: string, variant?: ToastVariant, options?: ToastOptions) => void;
  readonly nextSuccessIndex?: () => number;
};

const SNIFF_BYTES = 1024;
const DOS_EPS_MAGIC = [0xc5, 0xd0, 0xd3, 0xc6] as const;

/**
 * An `.ai` file saved by Illustrator 8 or older is PostScript, not PDF.
 * PDF-compatible AI files keep going to the PDF importer.
 */
export async function isPostscriptIllustratorFile(file: Blob): Promise<boolean> {
  // readImagePrefix reads any blob's first bytes, with a FileReader fallback.
  const head = await readImagePrefix(file, SNIFF_BYTES);
  if (DOS_EPS_MAGIC.every((b, i) => head[i] === b)) return true;
  const text = new TextDecoder('latin1').decode(head);
  return text.startsWith('%!') && !text.includes('%PDF-');
}

export async function importPostscriptFile(
  file: File,
  ctx: ImportPostscriptContext,
): Promise<void> {
  // The reader loads on first use, keeping it out of the boot bundle.
  const { convertPostscript } = await import('../../io/postscript');
  const result = convertPostscript(await readImagePrefix(file, file.size));
  if (result.kind === 'error') {
    ctx.pushToast(`${file.name}: ${result.reason}`, 'error');
    return;
  }
  for (const note of result.notes) ctx.pushToast(`${file.name}: ${note}`, 'warning');
  // Keep the original name: it is the artwork's source label and toast name.
  const svgText = result.svg;
  const svg = {
    name: file.name,
    size: svgText.length,
    text: async () => svgText,
    blob: async () => new Blob([svgText], { type: 'image/svg+xml' }),
  };
  await importSvgFiles([svg], ctx.importObject, ctx.pushToast, {
    ...(ctx.nextSuccessIndex === undefined ? {} : { nextSuccessIndex: ctx.nextSuccessIndex }),
    ...(ctx.importFragment === undefined ? {} : { importFragment: ctx.importFragment }),
  });
}
