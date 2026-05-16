import { app, type IpcMainInvokeEvent } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';

const EXPECTED_DEV_ORIGIN = 'http://localhost:3000/';

type SenderFrameLike = { readonly url: string } | null | undefined;

function senderFrameFromEvent(event: IpcMainInvokeEvent): SenderFrameLike {
  return event.senderFrame ? { url: event.senderFrame.url } : null;
}

function bundledRendererRootPath(): string {
  return path.resolve(__dirname, '..', 'dist');
}

function isPathWithinOrEqual(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === '' || (
    relative.length > 0
    && !relative.startsWith('..')
    && !path.isAbsolute(relative)
  );
}

export function isTrustedPackagedFileUrl(url: string, rootPath = bundledRendererRootPath()): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return false;
    const requestedPath = path.resolve(fileURLToPath(parsed));
    return isPathWithinOrEqual(rootPath, requestedPath);
  } catch {
    return false;
  }
}

export function isExpectedDevServerUrl(url: string): boolean {
  try {
    return new URL(url).origin === new URL(EXPECTED_DEV_ORIGIN).origin;
  } catch {
    return false;
  }
}

export function isTrustedElectronUrl(url: string): boolean {
  if (typeof url !== 'string' || url.length === 0) return false;
  if (app.isPackaged) {
    return isTrustedPackagedFileUrl(url);
  }
  return isExpectedDevServerUrl(url);
}

function senderTrusted(frame: SenderFrameLike): boolean {
  return !!frame && isTrustedElectronUrl(frame.url);
}

export function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const frame = senderFrameFromEvent(event);
  if (!senderTrusted(frame)) {
    const observed = frame?.url ?? '<no-frame>';
    throw new Error(`Blocked IPC from untrusted sender: ${observed}`);
  }
}
