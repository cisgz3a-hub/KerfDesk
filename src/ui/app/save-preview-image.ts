// Save Preview Image (LightBurn Preview "Save" image). Captures the workspace
// exactly as shown, with the preview toolpath and the playback overlay drawn
// on top, as one PNG. Reads pixels only: the project and its output job are
// left untouched.

import { APP_DISPLAY_NAME } from '../../core/app-branding';
import type { PlatformAdapter } from '../../platform/types';
import { canvasTheme } from '../theme/canvas-theme';
import type { ToastVariant } from '../state/toast-store';

export type SavePreviewImageCtx = {
  readonly platform: PlatformAdapter;
  readonly savedName: string | null;
  readonly pushToast: (message: string, variant?: ToastVariant) => void;
  readonly findLayers?: () => ReadonlyArray<HTMLCanvasElement>;
  readonly encode?: (layers: ReadonlyArray<HTMLCanvasElement>) => Promise<Blob>;
};

export async function saveWorkspacePreviewImage(ctx: SavePreviewImageCtx): Promise<void> {
  const layers = (ctx.findLayers ?? workspaceCanvasLayers)();
  if (layers.length === 0) {
    ctx.pushToast('Open the workspace before saving a preview image.', 'warning');
    return;
  }
  let target;
  try {
    target = await ctx.platform.pickFileForSave({
      suggestedName: `${projectStem(ctx.savedName)}-preview.png`,
      extensions: ['.png'],
    });
  } catch (error) {
    ctx.pushToast(`Could not save the preview image: ${message(error)}`, 'error');
    return;
  }
  if (target === null) return;
  try {
    await target.write(await (ctx.encode ?? compositeToPng)(layers));
    ctx.pushToast(`Saved the preview image to ${target.displayName}`, 'success');
  } catch (error) {
    ctx.pushToast(`Could not save the preview image: ${message(error)}`, 'error');
  }
}

function workspaceCanvasLayers(): ReadonlyArray<HTMLCanvasElement> {
  const base = document.querySelector<HTMLCanvasElement>(
    `canvas[aria-label="${APP_DISPLAY_NAME} workspace"]`,
  );
  if (base === null) return [];
  const motion = base.parentElement?.querySelector<HTMLCanvasElement>(
    'canvas[data-testid="canvas-motion-layer"]',
  );
  return motion === null || motion === undefined ? [base] : [base, motion];
}

function compositeToPng(layers: ReadonlyArray<HTMLCanvasElement>): Promise<Blob> {
  const [base] = layers;
  if (base === undefined) return Promise.reject(new Error('There is no workspace to capture.'));
  const canvas = document.createElement('canvas');
  canvas.width = base.width;
  canvas.height = base.height;
  const context = canvas.getContext('2d');
  if (context === null) return Promise.reject(new Error('This browser cannot compose the image.'));
  context.fillStyle = canvasTheme.viewportSurround;
  context.fillRect(0, 0, canvas.width, canvas.height);
  for (const layer of layers) context.drawImage(layer, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob === null ? reject(new Error('The image could not be encoded.')) : resolve(blob),
      'image/png',
    ),
  );
}

function projectStem(savedName: string | null): string {
  const stem = (savedName ?? 'project').replace(/\.[^.]*$/u, '').replace(/[<>:"/\\|?*]/gu, '-');
  return stem.trim() === '' ? 'project' : stem.trim();
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
