import { importLightBurnProject } from '../../io/lightburn';
import { deserializeProject } from '../../io/project';
import {
  parseLightBurnProjectOffThread,
  parseProjectOffThread,
  type DocumentImportRequestOptions,
} from '../import/document-import-worker-client';
import { resolveImportBlob, type BlobSourceFile } from '../import/import-file-blob';
import type { ToastVariant } from '../state/toast-store';
import { mainThreadImportFallbackAdvisory } from './import-size-advisory';

export type OpenProjectFile = BlobSourceFile;

type PushToast = (message: string, variant?: ToastVariant) => void;

export async function parseOpenedProjectFile(
  file: OpenProjectFile,
  options: DocumentImportRequestOptions,
  pushToast: PushToast,
): Promise<
  | { readonly kind: 'native'; readonly result: ReturnType<typeof deserializeProject> }
  | { readonly kind: 'lightburn'; readonly result: ReturnType<typeof importLightBurnProject> }
> {
  const blob = await resolveImportBlob(file);
  if (/\.lbrn2?$/i.test(file.name)) {
    return {
      kind: 'lightburn',
      result: await parseLightBurnProjectFile(file, blob, options, pushToast),
    };
  }
  return { kind: 'native', result: await parseNativeProjectFile(file, blob, options, pushToast) };
}

async function parseLightBurnProjectFile(
  file: OpenProjectFile,
  blob: Blob | null,
  options: DocumentImportRequestOptions,
  pushToast: PushToast,
): Promise<ReturnType<typeof importLightBurnProject>> {
  if (blob === null) return importLightBurnProject(await file.text(), file.name);
  const pending = parseLightBurnProjectOffThread(blob, file.name, options);
  if (pending !== null) return pending;
  pushToast(mainThreadImportFallbackAdvisory(file.name), 'warning');
  return importLightBurnProject(await file.text(), file.name);
}

async function parseNativeProjectFile(
  file: OpenProjectFile,
  blob: Blob | null,
  options: DocumentImportRequestOptions,
  pushToast: PushToast,
): Promise<ReturnType<typeof deserializeProject>> {
  if (blob === null) return deserializeProject(await file.text());
  const pending = parseProjectOffThread(blob, options);
  if (pending !== null) return pending;
  pushToast(mainThreadImportFallbackAdvisory(file.name), 'warning');
  return deserializeProject(await file.text());
}
