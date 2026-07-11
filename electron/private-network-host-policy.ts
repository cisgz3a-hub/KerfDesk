// Shared "is this host on the operator's own network?" gate. The camera
// bridge must never be usable as a proxy to arbitrary internet hosts
// (S03-001), so every camera URL policy — RTSP streaming and the frame
// proxy alike — allows only loopback and RFC1918 private-network hosts.

/**
 * True for loopback (localhost, ::1, 127.x), RFC1918 private IPv4, and private
 * IPv6 hosts (fc00::/7 unique-local, fe80::/10 link-local). Global/public and
 * malformed literals are refused — the camera bridge must never proxy to an
 * arbitrary internet host (S03-001).
 */
export function isAllowedPrivateNetworkHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '::1') return true;
  if (host.includes(':')) return isAllowedIpv6Host(host);
  return isAllowedIpv4Host(host);
}

// Classify an IPv6 literal by its first hextet: accept fc00::/7 (unique-local,
// 0xfc00–0xfdff) and fe80::/10 (link-local, 0xfe80–0xfebf), reject everything
// else. The literal is structurally validated first, so private-prefixed garbage
// like `fdff:` or `fc00:::::` is rejected rather than admitted on its first
// hextet alone. `::`-opening addresses have an empty first hextet → not private.
function isAllowedIpv6Host(host: string): boolean {
  const address = host.split('%')[0] ?? ''; // drop any scoped-zone id (fe80::1%eth0)
  if (!isWellFormedIpv6(address)) return false;
  const firstHextet = address.split(':')[0] ?? '';
  if (!/^[0-9a-f]{1,4}$/.test(firstHextet)) return false;
  const value = Number.parseInt(firstHextet, 16);
  const isUniqueLocal = value >= 0xfc00 && value <= 0xfdff;
  const isLinkLocal = value >= 0xfe80 && value <= 0xfebf;
  return isUniqueLocal || isLinkLocal;
}

// Structural IPv6 check (lowercased, zone-id already stripped): at most one `::`
// elision, no `:::` run, every group 1–4 hex digits, and the right group count
// (exactly 8, or ≤7 when `::` elides a zero run). A v4-mapped literal (a group
// with `.`) fails the per-group hex test, so it is refused, not parsed.
function isWellFormedIpv6(address: string): boolean {
  if (!address.includes(':') || address.includes(':::')) return false;
  if ((address.match(/::/g) ?? []).length > 1) return false;
  const groups = address.split(':');
  for (const group of groups) {
    if (group !== '' && !/^[0-9a-f]{1,4}$/.test(group)) return false;
  }
  const realGroups = groups.filter((group) => group !== '').length;
  return address.includes('::') ? realGroups <= 7 : realGroups === 8;
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
