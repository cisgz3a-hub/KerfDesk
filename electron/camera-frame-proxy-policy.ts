// URL policy for the bridge's /frame.jpg proxy (ADR-116). Machine cameras
// live on the operator's private network and send no CORS headers, so the
// browser cannot read their pixels directly; the bridge fetches the frame
// server-side and re-serves it from loopback with CORS. The policy keeps the
// proxy from being abused as a generic internet fetcher (S03-001): only
// private-network hosts, only camera-shaped protocols, never the bridge
// itself (recursion).

import { isAllowedPrivateNetworkHost } from './private-network-host-policy.js';

export type CameraFrameUrlPolicyResult =
  | { readonly kind: 'ok'; readonly url: URL; readonly transport: 'http' | 'rtsp' }
  | { readonly kind: 'invalid'; readonly reason: string };

export function cameraFrameUrlPolicy(
  value: string,
  bridgePort: number,
): CameraFrameUrlPolicyResult {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { kind: 'invalid', reason: 'Camera frame URL is invalid.' };
  }

  const transport = transportOf(url);
  if (transport === null) {
    return {
      kind: 'invalid',
      reason: 'Camera frame proxy accepts only http://, https://, or rtsp:// URLs.',
    };
  }

  if (!isAllowedPrivateNetworkHost(url.hostname)) {
    return {
      kind: 'invalid',
      reason: 'Camera frame proxy accepts only loopback or private-network hosts.',
    };
  }

  if (targetsBridgeItself(url, bridgePort)) {
    return { kind: 'invalid', reason: 'Camera frame proxy cannot proxy itself.' };
  }

  return { kind: 'ok', url, transport };
}

function transportOf(url: URL): 'http' | 'rtsp' | null {
  if (url.protocol === 'rtsp:') return 'rtsp';
  if (url.protocol === 'http:' || url.protocol === 'https:') return 'http';
  return null;
}

// A proxied URL pointing back at the bridge would recurse until the socket
// pool drains; refuse loopback targets on the bridge's own port outright.
function targetsBridgeItself(url: URL, bridgePort: number): boolean {
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const isLoopback = host === 'localhost' || host === '::1' || host.startsWith('127.');
  return isLoopback && url.port !== '' && Number(url.port) === bridgePort;
}
