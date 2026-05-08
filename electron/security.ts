import { app, type IpcMainInvokeEvent } from 'electron';

const EXPECTED_DEV_ORIGIN = 'http://localhost:3000/';

type SenderFrameLike = { readonly url: string } | null | undefined;

function senderFrameFromEvent(event: IpcMainInvokeEvent): SenderFrameLike {
  return event.senderFrame ? { url: event.senderFrame.url } : null;
}

function senderTrusted(frame: SenderFrameLike): boolean {
  if (!frame || typeof frame.url !== 'string' || frame.url.length === 0) {
    return false;
  }

  if (app.isPackaged) {
    return frame.url.startsWith('file://');
  }

  if (frame.url.startsWith('http://') || frame.url.startsWith('https://')) {
    try {
      return new URL(frame.url).origin === new URL(EXPECTED_DEV_ORIGIN).origin;
    } catch {
      return false;
    }
  }

  return false;
}

export function assertTrustedSender(event: IpcMainInvokeEvent): void {
  const frame = senderFrameFromEvent(event);
  if (!senderTrusted(frame)) {
    const observed = frame?.url ?? '<no-frame>';
    throw new Error(`Blocked IPC from untrusted sender: ${observed}`);
  }
}
