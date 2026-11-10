import { captureSourceFrame } from '../camera/frame-source';
import { pictureClient, type PictureClient } from '../camera/picture-worker/camera-picture-client';
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
const QUALITIES = [0.8, 0.65, 0.5, 0.35] as const;
// Stills are paced on the PC (ADR-490 Amendment 2, rolling audit v13
// Y4-P2-1): a client polling during a job gets at most one a second, one at a
// time, so it cannot crowd the window Abort is sent from.
const MIN_STILL_GAP_MS = 1000;
let stillInFlight: Promise<Record<string, unknown>> | null = null;
let lastStillAt = Number.NEGATIVE_INFINITY;

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
  const client = pictureClient();
  if (client !== null) return pacedStill(client, source.source, options, authority, signal);
  const frame = await captureSourceFrame(source.source);
  if (cancelled(signal, authority)) throw new RemoteFault('cancelled');
  // Sharing can be turned off while the frame is captured.
  if (options.canShareArtwork?.() !== true) return DISABLED;
  if (frame === null) return unavailable('The camera did not return a picture.');
  return encodeStill(frame);
}

async function pacedStill(
  client: PictureClient,
  source: Parameters<PictureClient['capture']>[0],
  options: RemoteControlOptions,
  authority: MachineAuthority,
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
  if (stillInFlight !== null) return stillInFlight;
  const wait = lastStillAt + MIN_STILL_GAP_MS - Date.now();
  const run = (async () => {
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    return takeStill(client, source, options, authority, signal);
  })();
  stillInFlight = run;
  try {
    return await run;
  } finally {
    stillInFlight = null;
    lastStillAt = Date.now();
  }
}

async function takeStill(
  client: PictureClient,
  source: Parameters<PictureClient['capture']>[0],
  options: RemoteControlOptions,
  authority: MachineAuthority,
  signal: AbortSignal | undefined,
): Promise<Record<string, unknown>> {
  if (cancelled(signal, authority)) throw new RemoteFault('cancelled');
  const frame = await client.capture(source);
  if (cancelled(signal, authority)) {
    frame?.close();
    throw new RemoteFault('cancelled');
  }
  // Sharing can be turned off while the frame is captured.
  if (options.canShareArtwork?.() !== true) {
    frame?.close();
    return DISABLED;
  }
  if (frame === null) return unavailable('The camera did not return a picture.');
  return workedStill(client, frame);
}

function cancelled(signal: AbortSignal | undefined, authority: MachineAuthority): boolean {
  return signal?.aborted === true || authority.signal.aborted;
}

/** The still encoded in the picture worker, at lower quality until it fits one response. */
async function workedStill(
  client: PictureClient,
  frame: ImageBitmap,
): Promise<Record<string, unknown>> {
  try {
    for (const quality of QUALITIES) {
      // The worker closes what it is sent; keep the frame for a lower quality.
      const copy = await createImageBitmap(frame);
      const reply = await client.run({ op: 'jpeg', frame: copy, maxSidePx: MAX_SIDE_PX, quality });
      if (reply.kind !== 'jpeg') return unavailable('The camera picture could not be encoded.');
      const data = await base64Of(reply.blob);
      const result = {
        status: 'ready',
        image: { mimeType: 'image/jpeg', data, widthPx: reply.width, heightPx: reply.height },
      };
      if (data.length > 0 && fitsRemoteResponse(result)) return result;
    }
    return unavailable('The camera picture is too large to share.');
  } finally {
    frame.close();
  }
}

function base64Of(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : '';
      const comma = url.indexOf(';base64,');
      resolve(comma < 0 ? '' : url.slice(comma + ';base64,'.length));
    };
    reader.onerror = () => resolve('');
    reader.readAsDataURL(blob);
  });
}

/** Forget the pacing (tests). */
export function resetStillPacing(): void {
  stillInFlight = null;
  lastStillAt = Number.NEGATIVE_INFINITY;
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
  for (const quality of QUALITIES) {
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
