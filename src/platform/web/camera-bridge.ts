import type {
  CameraBridgeAdapter,
  CameraBridgeHealth,
  CameraBridgeProbeRequest,
  CameraBridgeProbeResult,
  MachineCameraDiscovery,
} from '../types';

const DEFAULT_BRIDGE_ORIGIN = 'http://127.0.0.1:51731';

const BRIDGE_NOT_RUNNING_REASON =
  'The local camera bridge is not running. In browser/dev mode, run pnpm camera:bridge in a separate terminal, or use LaserForge Desktop where the bridge starts automatically.';

export function createHttpCameraBridge(bridgeOrigin = DEFAULT_BRIDGE_ORIGIN): CameraBridgeAdapter {
  const origin = bridgeOrigin.replace(/\/+$/, '');
  return {
    isSupported: () => true,
    probeRtspCamera: (req) => probeRtspCamera(origin, req),
    discoverMachineCamera: () => discoverMachineCamera(origin),
    proxiedFrameUrl: (cameraUrl) => `${origin}/frame.jpg?url=${encodeURIComponent(cameraUrl)}`,
    health: () => fetchHealth(origin),
  };
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
    if (
      typeof value['url'] !== 'string' ||
      typeof value['ffmpegAvailable'] !== 'boolean' ||
      !isOptionalString(value['codec']) ||
      !isOptionalString(value['previewUrl'])
    ) {
      return invalidBridgeResponse();
    }
    return {
      kind: 'ok',
      url: value['url'],
      ...(value['codec'] !== undefined ? { codec: value['codec'] } : {}),
      ffmpegAvailable: value['ffmpegAvailable'],
      ...(value['previewUrl'] !== undefined ? { previewUrl: value['previewUrl'] } : {}),
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
