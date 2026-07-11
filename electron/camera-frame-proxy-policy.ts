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

  if (isLoopbackHost(url)) {
    // Refuse EVERY loopback target, not just the bridge's own port, so the proxy
    // can't be used as a localhost port scanner reading OTHER local services
    // (ELE-02). Real machine cameras live on RFC1918, never loopback, so this
    // costs no legitimate reach. The bridge itself is loopback, so this also
    // subsumes the recursion guard — keep its clearer message for that case.
    const reason = targetsBridgeItself(url, bridgePort)
      ? 'Camera frame proxy cannot proxy itself.'
      : 'Camera frame proxy cannot reach loopback services (private-network hosts only).';
    return { kind: 'invalid', reason };
  }

  return { kind: 'ok', url, transport };
}

function transportOf(url: URL): 'http' | 'rtsp' | null {
  if (url.protocol === 'rtsp:') return 'rtsp';
  if (url.protocol === 'http:' || url.protocol === 'https:') return 'http';
  return null;
}

// Loopback: localhost, ::1, or 127.0.0.0/8. The URL parser keeps IPv6 literals
// bracketed ([::1]), so strip the brackets before comparing.
function isLoopbackHost(url: URL): boolean {
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return host === 'localhost' || host === '::1' || host.startsWith('127.');
}

// A proxied URL pointing back at the bridge's own port would recurse until the
// socket pool drains — the sharpest loopback case, so it gets its own message.
function targetsBridgeItself(url: URL, bridgePort: number): boolean {
  return isLoopbackHost(url) && url.port !== '' && Number(url.port) === bridgePort;
}
