// EPS, PostScript and Illustrator 3–8 import (ADR-700): the file's drawing is
// converted to SVG text in the import worker (Amendment 3), then imported
// exactly as an SVG file would be.

import type { SceneObject } from '../../core/scene';
import type { SvgArtworkFragment } from '../state/svg-fragment-mutation';
import type { ImportOutcome } from '../state/store';
import type { ToastOptions, ToastVariant } from '../state/toast-store';
import type { PostscriptConversion } from '../../io/postscript';
import { convertPostscriptOffThread } from '../import/import-worker-client';
import { readImagePrefix } from '../trace/image-header-reader';
import { mainThreadImportFallbackAdvisory } from './import-size-advisory';
import { createImportWorkerControls, isImportCancellation } from './import-worker-controls';
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

/** The window's own limit on a worker conversion: the worker's limit plus slack. */
export const POSTSCRIPT_HANG_GUARD_MS = 45_000;

export async function importPostscriptFile(
  file: File,
  ctx: ImportPostscriptContext,
): Promise<void> {
  const result = await convertPostscriptFile(file, ctx.pushToast);
  if (result === null) return;
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

/**
 * Converts in the import worker (ADR-700 Amendment 3), so the window stays
 * responsive and Esc cancels. The window also gives up after
 * POSTSCRIPT_HANG_GUARD_MS and retires the worker, whatever the reader does.
 * Only when no worker can start does the reader run here, under its shorter
 * window-thread limit. Null means the import already said why it stopped.
 */
async function convertPostscriptFile(
  file: File,
  pushToast: ImportPostscriptContext['pushToast'],
): Promise<PostscriptConversion | null> {
  const controls = createImportWorkerControls(file.name, pushToast);
  // One signal for both ends: Esc (the controls' own signal) or the guard.
  const stop = new AbortController();
  let timedOut = false;
  const cancel = (): void => stop.abort();
  controls.options.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    stop.abort();
  }, POSTSCRIPT_HANG_GUARD_MS);
  try {
    const offThread = convertPostscriptOffThread(file, {
      ...controls.options,
      signal: stop.signal,
    });
    if (offThread !== null) return await offThread;
    pushToast(mainThreadImportFallbackAdvisory(file.name), 'warning');
    // The reader loads on first use, keeping it out of the boot bundle.
    const { convertPostscript } = await import('../../io/postscript');
    return convertPostscript(await readImagePrefix(file, file.size));
  } catch (error) {
    const cancelled = !timedOut && isImportCancellation(error);
    pushToast(stoppedMessage(file.name, error, timedOut), cancelled ? 'warning' : 'error');
    return null;
  } finally {
    clearTimeout(timer);
    controls.options.signal?.removeEventListener('abort', cancel);
    controls.dispose();
  }
}

function stoppedMessage(name: string, error: unknown, timedOut: boolean): string {
  if (timedOut)
    return `${name}: the file was still being read after ${POSTSCRIPT_HANG_GUARD_MS / 1000} s, so the import stopped.`;
  if (isImportCancellation(error)) return `${name}: import cancelled.`;
  return `${name}: ${error instanceof Error ? error.message : String(error)}`;
}
