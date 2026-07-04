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

  if (!isAllowedRtspHost(url.hostname)) {
    return {
      kind: 'invalid',
      reason: 'Camera bridge accepts only loopback or private-network RTSP hosts.',
    };
  }

  return { kind: 'ok', url };
}

function isAllowedRtspHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '::1') return true;
  return isAllowedIpv4Host(host);
}

function isAllowedIpv4Host(host: string): boolean {
  const parts = host.split('.').map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [a, b] = parts;
  if (a === undefined || b === undefined) return false;
  return isPrivateA(a) || isPrivateB(a, b) || isPrivateC(a, b);
}

function isPrivateA(a: number): boolean {
  return a === 10 || a === 127;
}

function isPrivateB(a: number, b: number): boolean {
  return a === 172 && b >= 16 && b <= 31;
}

function isPrivateC(a: number, b: number): boolean {
  return a === 192 && b === 168;
}
