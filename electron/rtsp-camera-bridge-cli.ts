import { CAMERA_BRIDGE_PORT, startLocalRtspCameraBridge } from './rtsp-camera-bridge.js';

let bridgeHandle: Awaited<ReturnType<typeof startLocalRtspCameraBridge>> | null = null;
let stopping = false;

async function main(): Promise<void> {
  bridgeHandle = await startLocalRtspCameraBridge();
  console.log(`[camera] RTSP camera bridge is listening on http://127.0.0.1:${CAMERA_BRIDGE_PORT}`);
  console.log('[camera] Keep this terminal open while using the browser/dev app.');
  console.log('[camera] Press Ctrl+C to stop.');
}

async function stop(signal: NodeJS.Signals): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`[camera] Stopping RTSP camera bridge (${signal})...`);
  await bridgeHandle?.close();
  process.exit(0);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void stop(signal);
  });
}

void main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : 'Unknown startup error.';
  console.error(`[camera] RTSP camera bridge failed: ${message}`);
  process.exit(1);
});
