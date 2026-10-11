import { captureSourceFrame } from '../camera/frame-source';
import type { RgbaImage } from '../../core/camera/rgba-image';
import { useCameraStore } from '../state/camera-store';
import { RemoteFault } from './fault';
import type { MachineAuthority } from './machine-types';
import type { RemoteControlOptions } from './types';
import { fitsRemoteResponse } from './response-budget';

const MAX_SIDE_PX = 1024;
const JPEG_PREFIX = 'data:image/jpeg;base64,';
const DISABLED = {
  status: 'disabled',
  message:
    'Enable artwork previews in KerfDesk Settings → Phone & MCP on the PC to share the camera.',
};
const unavailable = (message: string) => ({ status: 'unavailable', message });

/**
 * ADR-585: one bounded JPEG still for a control-approved client that also has the
 * artwork-sharing opt-in. Camera addresses and credentials never leave the PC.
 */
export async function cameraSnapshot(
  options: RemoteControlOptions,
  authority: MachineAuthority | null | undefined,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  if (authority == null || authority.signal.aborted) throw new RemoteFault('control_required');
  authority.assertCurrent();
  if (options.canShareArtwork?.() !== true) return DISABLED;
  const source = useCameraStore.getState().sourceState;
  if (source.kind !== 'live')
    return unavailable('No camera is live on the PC. Start the camera there first.');
  const frame = await captureSourceFrame(source.source);
  if (signal?.aborted === true || authority.signal.aborted) throw new RemoteFault('cancelled');
  // Sharing can be turned off while the frame is captured.
  if (options.canShareArtwork?.() !== true) return DISABLED;
  if (frame === null) return unavailable('The camera did not return a picture.');
  return encodeStill(frame);
}

/** Downscales to at most 1024 px and lowers JPEG quality until the still fits one response. */
function encodeStill(frame: RgbaImage): Record<string, unknown> {
  const scale = Math.min(1, MAX_SIDE_PX / Math.max(frame.width, frame.height));
  const width = Math.max(1, Math.round(frame.width * scale));
  const height = Math.max(1, Math.round(frame.height * scale));
  const full = document.createElement('canvas');
  full.width = frame.width;
  full.height = frame.height;
  full
    .getContext('2d')
    ?.putImageData(
      new ImageData(new Uint8ClampedArray(frame.data), frame.width, frame.height),
      0,
      0,
    );
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context === null) return unavailable('The camera picture could not be encoded.');
  context.drawImage(full, 0, 0, width, height);
  for (const quality of [0.8, 0.65, 0.5, 0.35]) {
    const encoded = canvas.toDataURL('image/jpeg', quality);
    const data = encoded.startsWith(JPEG_PREFIX) ? encoded.slice(JPEG_PREFIX.length) : '';
    const result = {
      status: 'ready',
      image: { mimeType: 'image/jpeg', data, widthPx: width, heightPx: height },
    };
    if (data.length > 0 && fitsRemoteResponse(result)) return result;
  }
  return unavailable('The camera picture is too large to share.');
}
