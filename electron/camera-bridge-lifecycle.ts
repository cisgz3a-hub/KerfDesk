import { CAMERA_BRIDGE_PORT } from './rtsp-camera-bridge.js';

export type CameraBridgeHandle = { readonly close: () => Promise<void> };

/** Where the bridge stands, as the window's camera panel is told it. */
export type CameraBridgeStatus =
  | { readonly kind: 'running' }
  | { readonly kind: 'stopped' }
  | { readonly kind: 'failed'; readonly reason: string };

/**
 * Runs the RTSP camera bridge only while a workspace is admitted (ADR-623):
 * a renderer that opens behind the licence window stops it, and admission
 * starts it again. Starts and stops run one at a time, so the bridge's fixed
 * port is free before it listens again. A start that fails keeps its reason,
 * so the camera panel names it instead of saying the bridge needs KerfDesk
 * Desktop, and the panel's next connect tries again (rolling audit v2
 * 04-P2-1).
 */
export function cameraBridgeLifecycle(
  start: () => Promise<CameraBridgeHandle>,
  report: (message: string, error: unknown) => void = (message, error) =>
    console.warn(message, error),
  failureReason: (error: unknown) => string = (error) =>
    cameraBridgeStartFailure(error, CAMERA_BRIDGE_PORT),
) {
  let handle: CameraBridgeHandle | null = null;
  let wanted = false;
  let failure: string | null = null;
  let chain: Promise<void> = Promise.resolve();
  const run = (running: boolean): Promise<void> => {
    chain = chain.then(async () => {
      if (running && handle === null) {
        handle = await start().catch((error: unknown) => {
          report('RTSP camera bridge could not start:', error);
          failure = failureReason(error);
          return null;
        });
        if (handle !== null) failure = null;
      } else if (!running && handle !== null) {
        const open = handle;
        handle = null;
        await open.close().catch((error: unknown) => {
          report('RTSP camera bridge could not stop:', error);
        });
      }
      if (!running) failure = null;
    });
    return chain;
  };
  const setRunning = (running: boolean): Promise<void> => {
    wanted = running;
    return run(running);
  };
  return {
    setRunning,
    close: () => setRunning(false),
    /** Start again a bridge that is wanted but could not start, e.g. once its port is free. */
    retry: (): Promise<void> => (wanted ? run(true) : chain),
    status: (): CameraBridgeStatus => {
      if (handle !== null) return { kind: 'running' };
      return failure === null ? { kind: 'stopped' } : { kind: 'failed', reason: failure };
    },
  };
}

/** What the camera panel says when the bridge could not listen on `port`. */
export function cameraBridgeStartFailure(error: unknown, port: number): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  if (code === 'EADDRINUSE') {
    return `Another program on this computer is already using port ${port}, which KerfDesk needs for network cameras, so KerfDesk will not send camera addresses or logins there. It can be KerfDesk open for another Windows user, or another camera tool. Close it, then connect the camera again.`;
  }
  if (code === 'EACCES') {
    return `This computer does not let KerfDesk use port ${port}, which it needs for network cameras. Windows can set a range of ports aside for its own use, and security software can block one. Restart the computer and connect the camera again; if it keeps happening, save a support report.`;
  }
  const detail = code === '' ? '' : ` (${code})`;
  return `KerfDesk's network-camera bridge could not start${detail}, so network cameras cannot connect. Restart KerfDesk; if it keeps happening, save a support report.`;
}
