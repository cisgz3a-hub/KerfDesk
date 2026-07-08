import { isAllowedPrivateNetworkHost } from './private-network-host-policy.js';

export type RtspCameraUrlPolicyResult =
  | { readonly kind: 'ok'; readonly url: URL }
  | { readonly kind: 'invalid'; readonly reason: string };

export function rtspCameraUrlPolicy(value: string): RtspCameraUrlPolicyResult {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { kind: 'invalid', reason: 'Camera bridge URL is invalid.' };
  }

  if (url.protocol !== 'rtsp:') {
    return { kind: 'invalid', reason: 'Camera bridge accepts only rtsp:// URLs.' };
  }

  if (!isAllowedPrivateNetworkHost(url.hostname)) {
    return {
      kind: 'invalid',
      reason: 'Camera bridge accepts only loopback or private-network RTSP hosts.',
    };
  }

  return { kind: 'ok', url };
}
