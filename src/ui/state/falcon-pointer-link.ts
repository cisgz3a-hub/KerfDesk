import type { CameraBridgeAdapter } from '../../platform/types';
import { useCameraStore } from './camera-store';

// The Falcon A1 Pro's head pointer is switched over the machine's own HTTP
// server, through the desktop camera bridge (ADR-635). The bridge comes from
// the platform, which only React can read, so the app registers it here.
let registeredBridge: CameraBridgeAdapter | undefined;
// A Falcon found by discovery; reused until a switch cannot reach it.
let discoveredHost: string | null = null;

const FALCON_CAMERA_PATH = /^http:\/\/(\d{1,3}(?:\.\d{1,3}){3}):8080\/media\/getCapturePhoto$/;

const NOT_FOUND =
  'KerfDesk cannot find the Falcon on the network. Its red pointer is switched over the Falcon’s own network link, like Creality’s software: connect the PC to the Falcon the way Falcon Design Space does, check the Falcon camera appears in the Camera panel, then try again.';

/** The request never left KerfDesk, so the pointer's state is unchanged. */
export class FalconPointerNotSentError extends Error {}

export function registerFalconPointerBridge(bridge: CameraBridgeAdapter | undefined): void {
  registeredBridge = bridge;
}

/** Switch the pointer on or off; throws with the operator-facing reason. */
export async function switchFalconPointer(on: boolean): Promise<void> {
  const bridge = registeredBridge;
  if (bridge?.switchFalconPointer === undefined)
    throw new FalconPointerNotSentError(
      'The Falcon red pointer needs KerfDesk Desktop: the web app cannot reach it.',
    );
  const host = knownFalconHost() ?? (await discoverFalconHost(bridge));
  const result = await bridge.switchFalconPointer(host, on);
  if (result.kind === 'ok') return;
  if (host === discoveredHost) discoveredHost = null;
  throw new Error(result.reason);
}

/** The Falcon whose camera KerfDesk already reaches, without a new probe. */
function knownFalconHost(): string | null {
  const camera = useCameraStore.getState();
  const urls = [
    camera.machineCamera.kind === 'found' ? camera.machineCamera.cameraUrl : undefined,
    camera.sourceState.kind === 'live' && camera.sourceState.source.kind === 'machine-jpeg'
      ? camera.sourceState.source.cameraUrl
      : undefined,
  ];
  for (const url of urls) {
    const host = url === undefined ? undefined : FALCON_CAMERA_PATH.exec(url)?.[1];
    if (host !== undefined) return host;
  }
  return discoveredHost;
}

async function discoverFalconHost(bridge: CameraBridgeAdapter): Promise<string> {
  const found = await bridge.discoverMachineCamera();
  if (found.kind === 'unavailable') throw new FalconPointerNotSentError(found.reason);
  const host = found.kind === 'found' ? FALCON_CAMERA_PATH.exec(found.cameraUrl)?.[1] : undefined;
  if (host === undefined) throw new FalconPointerNotSentError(NOT_FOUND);
  discoveredHost = host;
  return host;
}

/** Test seam: forget a discovered Falcon. */
export function resetFalconPointerLink(): void {
  registeredBridge = undefined;
  discoveredHost = null;
}
