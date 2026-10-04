import { encodeQr, type QrSymbol } from '../../core/barcode/qr-encode';
import type { RemoteAccessStatus } from './remote-access-store';

export const PHONE_CONTROL_URL = 'https://kerfdesk-phone-control.cisgz3a.workers.dev/control';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODE = /^[A-Za-z0-9-]{12,24}$/;
const QUIET_ZONE = 4;

/** Keep native query metadata out of links shared with another device. */
export function phoneControlUrl(value: string): string | null {
  try {
    const url = new URL(value);
    const canonical = new URL(PHONE_CONTROL_URL);
    return url.origin === canonical.origin &&
      url.pathname === canonical.pathname &&
      url.username === '' &&
      url.password === ''
      ? PHONE_CONTROL_URL
      : null;
  } catch {
    return null;
  }
}

/** A convenience payload only: the relay retains expiry, single-use and approval authority. */
export function oneTimePairingLink(status: RemoteAccessStatus | null): string | null {
  if (status === null) return null;
  if (
    !status.available ||
    !status.enabled ||
    !status.connected ||
    status.pairingPending ||
    !validDevice(status.deviceId) ||
    !liveOffer(status.pairing) ||
    phoneControlUrl(status.controlUrl) === null
  )
    return null;
  const fragment = new URLSearchParams({ device: status.deviceId, code: status.pairing.code });
  return `${PHONE_CONTROL_URL}#${fragment.toString()}`;
}
function validDevice(value: string | null): value is string {
  return value !== null && UUID.test(value);
}
function liveOffer(
  value: RemoteAccessStatus['pairing'],
): value is NonNullable<RemoteAccessStatus['pairing']> {
  return (
    value !== null &&
    CODE.test(value.code) &&
    Number.isSafeInteger(value.expiresAt) &&
    value.expiresAt > 0 &&
    Number.isSafeInteger(value.expiresInMs) &&
    value.expiresInMs > 0 &&
    value.expiresInMs <= 300_000
  );
}

export type PairingQr = { readonly size: number; readonly path: string };
/** Local black-on-white geometry; no URL, image service, storage or artwork is requested. */
export function pairingQr(link: string): PairingQr | null {
  if (link.length > 256) return null;
  const encoded = encodeQr(link, { errorCorrection: 'M' });
  if (!encoded.ok) return null;
  return { size: encoded.symbol.size + QUIET_ZONE * 2, path: modulePath(encoded.symbol) };
}
function modulePath(symbol: QrSymbol): string {
  const paths: string[] = [];
  for (let y = 0; y < symbol.size; y += 1) {
    for (let x = 0; x < symbol.size; ) {
      if (symbol.modules[y * symbol.size + x] !== 1) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < symbol.size && symbol.modules[y * symbol.size + x] === 1) x += 1;
      const width = x - start;
      paths.push(`M${start + QUIET_ZONE} ${y + QUIET_ZONE}h${width}v1h-${width}z`);
    }
  }
  return paths.join('');
}

export function pairingExpiryLabel(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
