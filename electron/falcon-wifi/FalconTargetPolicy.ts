export type FalconWifiIpcTargetResult =
  | { readonly ok: true; readonly target: string }
  | { readonly ok: false; readonly error: string };

const INVALID_TARGET_ERROR = 'Falcon WiFi target must be a private LAN IPv4 address';

function parseIpv4(input: string): readonly [number, number, number, number] | null {
  const parts = input.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map(part => {
    if (!/^\d{1,3}$/.test(part)) return NaN;
    const value = Number(part);
    return Number.isInteger(value) && value >= 0 && value <= 255 ? value : NaN;
  });
  if (octets.some(Number.isNaN)) return null;
  return octets as [number, number, number, number];
}

function isPrivateLanIpv4([a, b]: readonly [number, number, number, number]): boolean {
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function normalizeFalconWifiIpcTarget(input: unknown): FalconWifiIpcTargetResult {
  if (typeof input !== 'string') return { ok: false, error: INVALID_TARGET_ERROR };
  const target = input.trim();
  if (target.length === 0 || target.length > 64) {
    return { ok: false, error: INVALID_TARGET_ERROR };
  }

  const octets = parseIpv4(target);
  if (!octets || !isPrivateLanIpv4(octets)) {
    return { ok: false, error: INVALID_TARGET_ERROR };
  }

  return { ok: true, target };
}
