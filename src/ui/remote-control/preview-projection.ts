import type { AppState } from '../state/store';
import { canvasTheme } from '../theme/canvas-theme';
import { paintObjectDisplay } from '../workspace/object-display';
import type { RemoteControlOptions } from './types';
import { RemoteFault } from './fault';
import {
  PreviewUnavailable,
  previewView,
  previewViewport,
  resolvePreviewGeometry,
} from './preview-geometry';
import type { PreviewGeometry } from './preview-geometry';

const PNG_PREFIX = 'data:image/png;base64,';
export const PREVIEW_BASE64_LIMIT = 65_536;
const DISABLED = {
  status: 'disabled',
  message:
    'Enable artwork previews and text in KerfDesk Settings → Phone & MCP on the PC to share this artwork.',
} as const;

/** No camera, document DOM, native path, image URL or font request is read here. */
export async function workspacePreviewProjection(
  state: AppState,
  options: RemoteControlOptions,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  assertActive(signal);
  if (options.canShareArtwork?.() !== true) return DISABLED;
  // Give cancellation and a desktop opt-out an opportunity before rendering.
  await Promise.resolve();
  assertActive(signal);
  if (options.canShareArtwork?.() !== true) return DISABLED;
  try {
    const geometry = resolvePreviewGeometry(state.project, 768);
    return renderPreview(geometry, options, signal);
  } catch (error) {
    assertActive(signal);
    if (options.canShareArtwork?.() !== true) return DISABLED;
    return {
      status: 'unavailable',
      message:
        error instanceof PreviewUnavailable
          ? error.message
          : 'The artwork preview could not be rendered. Check the workspace on the PC.',
    };
  }
}

function renderPreview(
  geometry: PreviewGeometry,
  options: RemoteControlOptions,
  signal?: AbortSignal,
): Record<string, unknown> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (ctx === null)
    throw new PreviewUnavailable('Artwork preview rendering is unavailable on this computer.');
  for (const sizePx of [768, 512, 384, 256]) {
    assertActive(signal);
    canvas.width = sizePx;
    canvas.height = sizePx;
    ctx.fillStyle = canvasTheme.bedFill;
    ctx.fillRect(0, 0, sizePx, sizePx);
    const view = previewView(geometry.extent, sizePx);
    for (const { object, display } of geometry.objects)
      paintObjectDisplay(ctx, object, display, view);
    const encoded = canvas.toDataURL('image/png');
    assertActive(signal);
    if (options.canShareArtwork?.() !== true) return DISABLED;
    const data = encoded.startsWith(PNG_PREFIX) ? encoded.slice(PNG_PREFIX.length) : '';
    if (data.length > PREVIEW_BASE64_LIMIT) continue;
    if (!/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0)
      throw new PreviewUnavailable('Artwork preview encoding is unavailable on this computer.');
    return {
      status: 'ready',
      preview: { mimeType: 'image/png', data, widthPx: sizePx, heightPx: sizePx },
      viewport: previewViewport(view, sizePx),
      ...(geometry.bounds === undefined ? {} : { bounds: geometry.bounds }),
      message: 'Design artwork preview. This is not a toolpath or a machine-position guarantee.',
    };
  }
  throw new PreviewUnavailable('This preview is too large to share. View the artwork on the PC.');
}
function assertActive(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw new RemoteFault('cancelled');
}
