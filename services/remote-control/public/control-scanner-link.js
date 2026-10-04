const PRODUCTION_ORIGIN = 'https://kerfdesk-phone-control.cisgz3a.workers.dev';
const UUID =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;
const CODE = /^[A-Za-z0-9-]{12,24}$/;

/** Read only a KerfDesk pairing payload. Never navigate to the scanned text. */
export function scannedPairing(value, currentOrigin = location.origin) {
  if (typeof value !== 'string' || value.length > 1024 || hasUrlWhitespace(value)) return null;
  try {
    const url = new URL(value);
    if (!allowedOrigin(url.origin, currentOrigin) || !cleanControlUrl(url, value)) return null;
    return fragmentPayload(url.hash);
  } catch {
    return null;
  }
}

function hasUrlWhitespace(value) {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 32 || code === 127;
  });
}

function fragmentPayload(fragment) {
  const params = new URLSearchParams(fragment.slice(1));
  const device = params.get('device');
  const code = params.get('code');
  if (
    [...params].length !== 2 ||
    params.getAll('device').length !== 1 ||
    params.getAll('code').length !== 1 ||
    !UUID.test(device || '') ||
    !CODE.test(code || '')
  )
    return null;
  return { device, code };
}

function allowedOrigin(origin, currentOrigin) {
  if (origin === PRODUCTION_ORIGIN) return true;
  if (origin !== currentOrigin) return false;
  const current = new URL(currentOrigin);
  return (
    current.protocol === 'https:' ||
    (current.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(current.hostname))
  );
}

function cleanControlUrl(url, value) {
  return (
    url.username === '' &&
    url.password === '' &&
    url.search === '' &&
    url.pathname === '/control' &&
    value.slice(0, value.indexOf('#')) === `${url.origin}/control`
  );
}
