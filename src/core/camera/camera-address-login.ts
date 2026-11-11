// The public form of a network camera address (ADR-692 and its Amendment 1):
// the only form that may be saved or shared, and the only one kept in plain
// local storage. It is the scheme, host and port and nothing else; which camera
// a calibration belongs to is decided by the keyed fingerprint. An address that
// cannot be read one way only keeps its scheme alone. The full address is used
// for the live connection and, on the desktop, kept only in the operating
// system's secure storage.

const SCHEME = /^[a-z][a-z0-9+.-]*:(?=\/\/)/i;
// Read one way only: any `@` belongs to the part before the host.
const READ_ONE_WAY = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/?#]*@)?[^/?#@]*(?:[/?#][^@]*)?$/i;
const PLAIN_HOST = /^(?:[a-z0-9-]+(?:\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])$/i;

/**
 * The address with its userinfo, query and fragment removed: what the keyed
 * identity hashes. Never saved in plain.
 */
export function cameraAddressWithoutUserinfo(raw: string): string {
  try {
    const url = new URL(raw.trim());
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return (
      raw
        .trim()
        .replace(/\/\/[^/@]+@/, '//')
        .split(/[?#]/, 1)[0] ?? 'camera'
    );
  }
}

/** Scheme, host and port: the form that may be saved, shared or kept in plain. */
export function publicCameraAddress(raw: string): string {
  const text = raw.trim();
  const scheme = SCHEME.exec(text)?.[0]?.toLowerCase();
  const schemeOnly = scheme === undefined ? 'camera' : `${scheme}//`;
  if (!READ_ONE_WAY.test(text)) return schemeOnly;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return schemeOnly;
  }
  return PLAIN_HOST.test(url.hostname) ? `${url.protocol}//${url.host}/` : schemeOnly;
}

/** True when `raw` holds more than its public form, so only secure storage may keep it. */
export function cameraAddressHasPrivateParts(raw: string): boolean {
  let whole: string;
  try {
    whole = new URL(raw.trim()).toString();
  } catch {
    whole = raw.trim();
  }
  return publicCameraAddress(raw) !== whole;
}
