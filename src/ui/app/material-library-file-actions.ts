import {
  deserializeMaterialLibrary,
  serializeMaterialLibrary,
  type DeserializeMaterialLibraryResult,
  type MaterialLibraryDocument,
} from '../../io/material-library';
import type { PlatformAdapter } from '../../platform/types';
import { jobAwareAlert } from '../state/job-aware-dialogs';
import type { ToastVariant } from '../state/toast-store';
import { importLightBurnClb } from '../../io/lightburn';
import { importSourceSizeAdvisory, mainThreadImportFallbackAdvisory } from './import-size-advisory';
import {
  parseLightBurnClbOffThread,
  parseMaterialLibraryOffThread,
} from '../import/document-import-worker-client';
import { resolveImportBlob } from '../import/import-file-blob';
import { createImportWorkerControls, isImportCancellation } from './import-worker-controls';

type PushToast = (message: string, variant?: ToastVariant) => void;

export type OpenMaterialLibraryCtx = {
  readonly platform: PlatformAdapter;
  readonly setMaterialLibrary: (library: MaterialLibraryDocument) => void;
  readonly pushToast: PushToast;
};

export type SaveMaterialLibraryCtx = {
  readonly platform: PlatformAdapter;
  readonly library: MaterialLibraryDocument;
  readonly markMaterialLibrarySaved: () => void;
  readonly pushToast: PushToast;
};

export async function handleOpenMaterialLibrary(ctx: OpenMaterialLibraryCtx): Promise<void> {
  let files;
  try {
    files = await ctx.platform.pickFilesForOpen({ accept: ['.lfml.json'], multiple: false });
  } catch (err) {
    ctx.pushToast(`Could not open material library: ${errMsg(err)}`, 'error');
    return;
  }

  const file = files[0];
  if (file === undefined) return;
  const sizeAdvisory = importSourceSizeAdvisory(file, 'material-library');
  if (sizeAdvisory !== null) ctx.pushToast(sizeAdvisory, 'warning');

  const controls = createImportWorkerControls(file.name, ctx.pushToast);
  let result: DeserializeMaterialLibraryResult;
  try {
    const blob = await resolveImportBlob(file);
    result = await parseMaterialLibraryFile(file, blob, controls.options, ctx.pushToast);
  } catch (err) {
    ctx.pushToast(
      isImportCancellation(err)
        ? `${file.name}: open cancelled.`
        : `Could not open ${file.name}: ${errMsg(err)}`,
      isImportCancellation(err) ? 'warning' : 'error',
    );
    return;
  } finally {
    controls.dispose();
  }
  if (result.kind === 'ok') {
    ctx.setMaterialLibrary(result.library);
    ctx.pushToast(`Loaded material library: ${result.library.name}`, 'success');
    return;
  }

  if (result.kind === 'schema-too-new') {
    jobAwareAlert(
      `This material library was saved with a newer KerfDesk (schemaVersion ${result.sawVersion}). Update the app to open it.`,
    );
    return;
  }

  ctx.pushToast(`Could not open ${file.name}: ${describeOpenResult(result)}`, 'error');
}

export async function handleImportClbMaterialLibrary(ctx: OpenMaterialLibraryCtx): Promise<void> {
  let files;
  try {
    files = await ctx.platform.pickFilesForOpen({ accept: ['.clb'], multiple: false });
  } catch (err) {
    ctx.pushToast(`Could not import CLB: ${errMsg(err)}`, 'error');
    return;
  }
  const file = files[0];
  if (file === undefined) return;
  const sizeAdvisory = importSourceSizeAdvisory(file, 'lightburn-clb');
  if (sizeAdvisory !== null) ctx.pushToast(sizeAdvisory, 'warning');
  const controls = createImportWorkerControls(file.name, ctx.pushToast);
  let result: ReturnType<typeof importLightBurnClb>;
  try {
    const blob = await resolveImportBlob(file);
    result = await parseClbFile(file, blob, controls.options, ctx.pushToast);
  } catch (err) {
    ctx.pushToast(
      isImportCancellation(err)
        ? `${file.name}: import cancelled.`
        : `Could not read ${file.name}: ${errMsg(err)}`,
      isImportCancellation(err) ? 'warning' : 'error',
    );
    return;
  } finally {
    controls.dispose();
  }
  if (!result.ok) {
    ctx.pushToast(`Could not import ${file.name}: ${result.reason}`, 'error');
    return;
  }
  ctx.setMaterialLibrary(result.library);
  ctx.pushToast(`Imported ${result.report.importedEntries} CLB preset(s).`, 'success');
  const unsupported = result.report.unknownFields.length + result.report.warnings.length;
  if (unsupported > 0) {
    ctx.pushToast(
      `${unsupported} unsupported CLB field or entry warning(s) were reported.`,
      'warning',
    );
  }
}

export async function handleSaveMaterialLibrary(ctx: SaveMaterialLibraryCtx): Promise<void> {
  let target;
  try {
    target = await ctx.platform.pickFileForSave({
      suggestedName: `${ctx.library.name}.lfml.json`,
      extensions: ['.lfml.json'],
    });
  } catch (err) {
    ctx.pushToast(`Could not save material library: ${errMsg(err)}`, 'error');
    return;
  }
  if (target === null) return;

  try {
    await target.write(serializeMaterialLibrary(ctx.library));
    ctx.markMaterialLibrarySaved();
    ctx.pushToast(`Saved material library to ${target.displayName}`, 'success');
  } catch (err) {
    ctx.pushToast(`Could not save material library: ${errMsg(err)}`, 'error');
  }
}

function describeOpenResult(
  result: Exclude<DeserializeMaterialLibraryResult, { readonly kind: 'ok' }>,
): string {
  if (result.kind === 'invalid') return result.reason;
  if (result.kind === 'schema-too-new') return `unsupported version ${result.sawVersion}`;
  if (result.kind === 'schema-too-old') return `legacy version ${result.sawVersion}`;
  return 'unknown error';
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function parseMaterialLibraryFile(
  file: { readonly name: string; readonly text: () => Promise<string> },
  blob: Blob | null,
  options: Parameters<typeof parseMaterialLibraryOffThread>[1],
  pushToast: PushToast,
): Promise<DeserializeMaterialLibraryResult> {
  if (blob === null) return deserializeMaterialLibrary(await file.text());
  const pending = parseMaterialLibraryOffThread(blob, options);
  if (pending !== null) return pending;
  pushToast(mainThreadImportFallbackAdvisory(file.name), 'warning');
  return deserializeMaterialLibrary(await file.text());
}

async function parseClbFile(
  file: { readonly name: string; readonly text: () => Promise<string> },
  blob: Blob | null,
  options: Parameters<typeof parseLightBurnClbOffThread>[2],
  pushToast: PushToast,
): Promise<ReturnType<typeof importLightBurnClb>> {
  if (blob === null) return importLightBurnClb(await file.text(), file.name);
  const pending = parseLightBurnClbOffThread(blob, file.name, options);
  if (pending !== null) return pending;
  pushToast(mainThreadImportFallbackAdvisory(file.name), 'warning');
  return importLightBurnClb(await file.text(), file.name);
}
