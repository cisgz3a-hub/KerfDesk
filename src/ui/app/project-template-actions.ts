import type { Project } from '../../core/scene';
import { prepareProjectForPersistence } from '../../io/project';
import { parseProjectTemplate, serializeProjectTemplate } from '../../io/project/project-template';
import type { FileHandle, PlatformAdapter } from '../../platform/types';
import { loadedMachineCapabilityWarningMessage } from '../machine/machine-capability-messages';
import type { ToastVariant } from '../state/toast-store';
import type { ProjectOpenCompletionContext } from './project-open-completion';
import { claimProjectOpenRequest } from './project-open-request-owner';
import { portableProjectAssets } from './portable-project-assets';
import type { PagedRasterAssetReader } from '../import/paged-raster-hydration';
import { createProjectSaveWriteCoordinator } from '../state/project-save-write-coordinator';

type OpenTemplateContext = ProjectOpenCompletionContext & {
  readonly platform: PlatformAdapter;
  readonly claimProjectOpenRequest: () => number;
  readonly getProjectOpenRequestEpoch: () => number;
  readonly getProjectDocumentEpoch: () => number;
  readonly getProject: () => Project;
};

export async function openProjectTemplate(ctx: OpenTemplateContext): Promise<void> {
  const owner = claimProjectOpenRequest(
    ctx.pushToast,
    ctx.claimProjectOpenRequest,
    ctx.getProjectOpenRequestEpoch,
    ctx.getProjectDocumentEpoch,
  );
  const project = ctx.getProject();
  try {
    const files = await ctx.platform.pickFilesForOpen({
      accept: ['.lf2template'],
      multiple: false,
    });
    if (!owner.isCurrent()) return;
    const file = files[0];
    if (file === undefined) return;
    await openTemplateFile(ctx, file, owner.isCurrent, () => ctx.getProject() === project);
  } catch (error) {
    owner.pushToast(`Could not open template: ${message(error)}`, 'error');
  }
}

/** Also usable by Open/drop dispatch, without ever receiving a writable source target. */
export async function openTemplateFile(
  ctx: ProjectOpenCompletionContext,
  file: FileHandle,
  isCurrent: () => boolean,
  isUnchanged: () => boolean = () => true,
): Promise<void> {
  const project = parseProjectTemplate(await file.text());
  if (!isCurrent()) return;
  if (!isUnchanged()) {
    ctx.pushToast(
      'The project changed while the template was opening. Open the template again.',
      'warning',
    );
    return;
  }
  const loaded = ctx.setProject(project);
  ctx.markLoaded(`${file.name.replace(/\.lf2template$/i, '')}.lf2`, { dirty: true });
  ctx.pushToast(
    `Started a new project from ${file.name}. Save will ask for a destination.`,
    'success',
  );
  if (loaded.kind === 'capability-warning')
    ctx.pushToast(loadedMachineCapabilityWarningMessage(loaded.activeKind), 'warning');
}

let saveRequest = 0;
const templateWrites = createProjectSaveWriteCoordinator();
export async function saveProjectTemplate(ctx: {
  readonly platform: PlatformAdapter;
  readonly project: Project;
  readonly savedName: string | null;
  readonly getProjectDocumentEpoch: () => number;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
  readonly assetReader?: PagedRasterAssetReader;
}): Promise<void> {
  const request = ++saveRequest;
  const writer = templateWrites.begin(request);
  const epoch = ctx.getProjectDocumentEpoch();
  const isCurrent = (): boolean =>
    request === saveRequest && ctx.getProjectDocumentEpoch() === epoch;
  try {
    // Capture and validate before the picker can outlive this document.
    const prepared = prepareProjectForPersistence(ctx.project);
    if (prepared.kind !== 'ok') throw new Error(prepared.reason);
    // Open inside the original user gesture; large asset reads happen afterwards.
    const target = await ctx.platform.pickFileForSave({
      suggestedName: `${(ctx.savedName ?? 'untitled.lf2').replace(/\.lf2$/i, '')}.lf2template`,
      extensions: ['.lf2template'],
    });
    if (target === null) return;
    const json = serializeProjectTemplate(
      await portableProjectAssets(prepared.project, ctx.assetReader),
    );
    await writer.write(target, json, (error) => {
      if (isCurrent())
        ctx.pushToast(
          `Could not restore the newest template in ${target.displayName}: ${message(error)}. Save it again.`,
          'error',
        );
    });
    if (isCurrent()) ctx.pushToast(`Saved template to ${target.displayName}.`, 'success');
  } catch (error) {
    if (isCurrent()) ctx.pushToast(`Could not save template: ${message(error)}`, 'error');
  } finally {
    writer.release();
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
