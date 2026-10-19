export type CameraBridgeHandle = { readonly close: () => Promise<void> };

/**
 * Runs the RTSP camera bridge only while a workspace is admitted (ADR-623):
 * a renderer that opens behind the licence window stops it, and admission
 * starts it again. Starts and stops run one at a time, so the bridge's fixed
 * port is free before it listens again.
 */
export function cameraBridgeLifecycle(
  start: () => Promise<CameraBridgeHandle>,
  report: (message: string, error: unknown) => void = (message, error) =>
    console.warn(message, error),
) {
  let handle: CameraBridgeHandle | null = null;
  let chain: Promise<void> = Promise.resolve();
  const setRunning = (running: boolean): Promise<void> => {
    chain = chain.then(async () => {
      if (running && handle === null) {
        handle = await start().catch((error: unknown) => {
          report('RTSP camera bridge could not start:', error);
          return null;
        });
      } else if (!running && handle !== null) {
        const open = handle;
        handle = null;
        await open.close().catch((error: unknown) => {
          report('RTSP camera bridge could not stop:', error);
        });
      }
    });
    return chain;
  };
  return { setRunning, close: () => setRunning(false) };
}
