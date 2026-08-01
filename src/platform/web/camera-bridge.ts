import type {
  CameraBridgeAdapter,
  CameraBridgeHealth,
  CameraBridgeProbeRequest,
  CameraBridgeProbeResult,
  CameraBridgeStreamStatus,
  MachineCameraDiscovery,
} from '../types';

const DEFAULT_BRIDGE_ORIGIN = 'http://127.0.0.1:51731';
const STREAM_STATUS_TIMEOUT_MS = 3_000;

const BRIDGE_NOT_RUNNING_REASON =
  'The network-camera bridge is available only in LaserForge Desktop or local development. For local development, run pnpm camera:bridge in a separate terminal; hosted web builds support USB cameras only.';

export function createHttpCameraBridge(bridgeOrigin = DEFAULT_BRIDGE_ORIGIN): CameraBridgeAdapter {
  const origin = bridgeOrigin.replace(/\/+$/, '');
  return {
    isSupported: () => true,
    probeRtspCamera: (req) => probeRtspCamera(origin, req),
    rtspStreamStatus: (streamSessionId) => fetchStreamStatus(origin, streamSessionId),
    discoverMachineCamera: () => discoverMachineCamera(origin),
    proxiedFrameUrl: (cameraUrl) => `${origin}/frame.jpg?url=${encodeURIComponent(cameraUrl)}`,
    health: () => fetchHealth(origin),
  };
}

async function fetchStreamStatus(
  origin: string,
  streamSessionId: string,
): Promise<CameraBridgeStreamStatus> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), STREAM_STATUS_TIMEOUT_MS);
  try {
    const response = await fetch(
      `${origin}/stream-status?session=${encodeURIComponent(streamSessionId)}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: controller.signal,
      },
    );
    return normalizeStreamStatus(await response.json());
  } catch {
    return { kind: 'unavailable', reason: BRIDGE_NOT_RUNNING_REASON };
  } finally {
    clearTimeout(timeout);
  }
}

async function probeRtspCamera(
  origin: string,
  req: CameraBridgeProbeRequest,
): Promise<CameraBridgeProbeResult> {
  try {
    const response = await fetch(`${origin}/probe?url=${encodeURIComponent(req.url)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    const body = await response.json();
    return normalizeProbeResult(body);
  } catch {
    return {
      kind: 'unavailable',
      reason: `${BRIDGE_NOT_RUNNING_REASON} Built-in RTSP cameras will not appear in the browser camera picker.`,
    };
  }
}

async function discoverMachineCamera(origin: string): Promise<MachineCameraDiscovery> {
  try {
    const response = await fetch(`${origin}/discover`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    return normalizeDiscovery(await response.json());
  } catch {
    return { kind: 'unavailable', reason: BRIDGE_NOT_RUNNING_REASON };
  }
}

function normalizeDiscovery(value: unknown): MachineCameraDiscovery {
  if (!isRecord(value) || value['kind'] !== 'ok') return invalidDiscoveryResponse();
  const found = value['found'];
  if (found === null) return { kind: 'not-found' };
  if (
    isRecord(found) &&
    typeof found['cameraUrl'] === 'string' &&
    typeof found['proxyFrameUrl'] === 'string'
  ) {
    return { kind: 'found', cameraUrl: found['cameraUrl'], proxyFrameUrl: found['proxyFrameUrl'] };
  }
  return invalidDiscoveryResponse();
}

function invalidDiscoveryResponse(): MachineCameraDiscovery {
  return { kind: 'unavailable', reason: 'The local camera bridge returned an invalid response.' };
}

async function fetchHealth(origin: string): Promise<CameraBridgeHealth> {
  try {
    const response = await fetch(`${origin}/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    return normalizeHealth(await response.json());
  } catch {
    return { kind: 'unavailable', reason: BRIDGE_NOT_RUNNING_REASON };
  }
}

function normalizeHealth(value: unknown): CameraBridgeHealth {
  if (!isRecord(value) || value['kind'] !== 'ok' || typeof value['ffmpegAvailable'] !== 'boolean') {
    return { kind: 'unavailable', reason: 'The local camera bridge returned an invalid response.' };
  }
  return {
    kind: 'ok',
    ffmpegAvailable: value['ffmpegAvailable'],
    // Absent on pre-ADR-116 bridges: an old desktop build without the proxy.
    frameProxy: value['frameProxy'] === true,
  };
}

function normalizeProbeResult(value: unknown): CameraBridgeProbeResult {
  if (!isRecord(value)) return invalidBridgeResponse();
  if (value['kind'] === 'ok') {
    if (!isValidProbeSuccess(value)) return invalidBridgeResponse();
    return {
      kind: 'ok',
      url: value['url'],
      ...(value['codec'] !== undefined ? { codec: value['codec'] } : {}),
      ffmpegAvailable: value['ffmpegAvailable'],
      ...(value['previewUrl'] !== undefined ? { previewUrl: value['previewUrl'] } : {}),
      ...(value['streamSessionId'] !== undefined
        ? { streamSessionId: value['streamSessionId'] }
        : {}),
    };
  }
  if (
    (value['kind'] === 'invalid' || value['kind'] === 'unavailable') &&
    typeof value['reason'] === 'string'
  ) {
    return { kind: value['kind'], reason: value['reason'] };
  }
  return invalidBridgeResponse();
}

type ValidProbeSuccess = Record<string, unknown> & {
  readonly url: string;
  readonly ffmpegAvailable: boolean;
  readonly codec?: string;
  readonly previewUrl?: string;
  readonly streamSessionId?: string;
};

function isValidProbeSuccess(value: Record<string, unknown>): value is ValidProbeSuccess {
  return (
    typeof value['url'] === 'string' &&
    typeof value['ffmpegAvailable'] === 'boolean' &&
    isOptionalString(value['codec']) &&
    isOptionalString(value['previewUrl']) &&
    isOptionalString(value['streamSessionId'])
  );
}

function normalizeStreamStatus(value: unknown): CameraBridgeStreamStatus {
  if (!isRecord(value)) return invalidStreamStatus();
  if (value['kind'] === 'starting' || value['kind'] === 'live') {
    return { kind: value['kind'] };
  }
  if (
    (value['kind'] === 'failed' || value['kind'] === 'unavailable') &&
    typeof value['reason'] === 'string'
  ) {
    return { kind: value['kind'], reason: value['reason'] };
  }
  return invalidStreamStatus();
}

function invalidStreamStatus(): CameraBridgeStreamStatus {
  return {
    kind: 'unavailable',
    reason: 'The local camera bridge returned an invalid RTSP stream status.',
  };
}

function invalidBridgeResponse(): CameraBridgeProbeResult {
  return {
    kind: 'unavailable',
    reason: 'The local camera bridge returned an invalid response.',
  };
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
