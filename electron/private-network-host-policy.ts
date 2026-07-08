// Shared "is this host on the operator's own network?" gate. The camera
// bridge must never be usable as a proxy to arbitrary internet hosts
// (S03-001), so every camera URL policy — RTSP streaming and the frame
// proxy alike — allows only loopback and RFC1918 private-network hosts.

/** True for loopback (localhost, ::1, 127.x) and RFC1918 private IPv4 hosts. */
export function isAllowedPrivateNetworkHost(hostname: string): boolean {
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
