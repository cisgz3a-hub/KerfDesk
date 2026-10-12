import type { DeviceProfile } from '../../core/devices';
import { importLightBurnProject } from '../../io/lightburn';
import { deserializeProject } from '../../io/project';
import type { RecentFileRef } from '../../platform/types';
import {
  parseLightBurnProjectOffThread,
  parseProjectOffThread,
  type DocumentImportRequestOptions,
} from '../import/document-import-worker-client';
import { resolveImportBlob, type BlobSourceFile } from '../import/import-file-blob';
import type { ToastVariant } from '../state/toast-store';
import { mainThreadImportFallbackAdvisory } from './import-size-advisory';
import { projectSealReady, trustIfSealedHere } from '../licensing/project-seal';
import { unadmittedProFeatures } from '../state/pending-pro-project';

/** A chosen project file; `recentRef` lets Recent Projects reopen it. */
export type OpenProjectFile = BlobSourceFile & { readonly recentRef?: RecentFileRef };

type PushToast = (message: string, variant?: ToastVariant) => void;

/** `currentDevice` reads the machine open now: a LightBurn project carries
 * none of its own, so it opens on that one (ADR-388). A `.lf2` brings its own. */
export async function parseOpenedProjectFile(
  file: OpenProjectFile,
  options: DocumentImportRequestOptions,
  pushToast: PushToast,
  currentDevice?: () => DeviceProfile,
): Promise<
  | { readonly kind: 'native'; readonly result: ReturnType<typeof deserializeProject> }
  | { readonly kind: 'lightburn'; readonly result: ReturnType<typeof importLightBurnProject> }
> {
  const blob = await resolveImportBlob(file);
  if (/\.lbrn2?$/i.test(file.name)) {
    return {
      kind: 'lightburn',
      result: await parseLightBurnProjectFile(file, blob, options, pushToast, currentDevice?.()),
    };
  }
  return { kind: 'native', result: await parseNativeProjectFile(file, blob, options, pushToast) };
}

async function parseLightBurnProjectFile(
  file: OpenProjectFile,
  blob: Blob | null,
  options: DocumentImportRequestOptions,
  pushToast: PushToast,
  device: DeviceProfile | undefined,
): Promise<ReturnType<typeof importLightBurnProject>> {
  if (blob === null) return importLightBurnProject(await file.text(), file.name, undefined, device);
  const pending = parseLightBurnProjectOffThread(blob, file.name, options, device);
  if (pending !== null) return pending;
  pushToast(mainThreadImportFallbackAdvisory(file.name), 'warning');
  return importLightBurnProject(await file.text(), file.name, undefined, device);
}

async function parseNativeProjectFile(
  file: OpenProjectFile,
  blob: Blob | null,
  options: DocumentImportRequestOptions,
  pushToast: PushToast,
): Promise<ReturnType<typeof deserializeProject>> {
  if (blob === null) {
    const text = await file.text();
    return admitSealedProject(deserializeProject(text), async () => text);
  }
  const pending = parseProjectOffThread(blob, options);
  if (pending !== null) return admitSealedProject(await pending, () => file.text());
  pushToast(mainThreadImportFallbackAdvisory(file.name), 'warning');
  const text = await file.text();
  return admitSealedProject(deserializeProject(text), async () => text);
}

/**
 * A desktop session without Pro opens Pro work only from text this computer
 * sealed (ADR-592). The text is read again only for a project that needs it.
 */
async function admitSealedProject(
  result: ReturnType<typeof deserializeProject>,
  text: () => Promise<string>,
): Promise<ReturnType<typeof deserializeProject>> {
  if (result.kind !== 'ok' || unadmittedProFeatures(result.project).length === 0) return result;
  await projectSealReady();
  trustIfSealedHere(result.project, await text());
  return result;
}
