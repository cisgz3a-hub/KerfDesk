// The public form of a network camera address (ADR-692): the only form that
// may be saved or shared. The full address is used for the live connection
// and, on the desktop, kept only in the operating system's secure storage.

const LOGIN_FIELD_PARTS = /user|usr|login|account|pass|pwd|psw|auth|token|secret|key/i;
const LOGIN_FIELD_NAMES = new Set(['pw', 'uid', 'sid', 'name']);
const FIELD = /(^|[/&;_,])([A-Za-z][A-Za-z0-9.-]*)=/g;

/** The address with its userinfo, query and fragment removed. */
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

/** The address with no login in any part of it: the form that may be saved. */
export function publicCameraAddress(raw: string): string {
  const parsed = withoutPathLogin(cameraAddressWithoutUserinfo(raw));
  if (!parsed.includes('@')) return parsed;
  // Read again from the last `@`; leaving out too much is the safe side.
  const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(raw.trim())?.[0] ?? '';
  const rest = raw.trim().slice(scheme.length).split(/[?#]/, 1)[0] ?? '';
  return withoutPathLogin(
    cameraAddressWithoutUserinfo(`${scheme}${rest.slice(rest.lastIndexOf('@') + 1)}`),
  );
}

function withoutPathLogin(address: string): string {
  const authority = /^[a-z][a-z0-9+.-]*:\/\/[^/]*/i.exec(address)?.[0];
  if (authority === undefined) return address;
  const path = address.slice(authority.length);
  const cut = loginFieldStart(path);
  return cut === undefined ? address : `${authority}${path.slice(0, cut)}`;
}

/** True when `raw` carries anything its public form leaves out. */
export function cameraAddressHasLogin(raw: string): boolean {
  let whole: string;
  try {
    whole = new URL(raw.trim()).toString();
  } catch {
    whole = raw.trim();
  }
  return publicCameraAddress(raw) !== whole;
}

/** Where the first login field starts in `path`, or undefined when it has none. */
function loginFieldStart(path: string): number | undefined {
  const plain = firstLoginField(path);
  if (plain !== undefined) return plain;
  // Encoded text is checked decoded too; any doubt drops the whole path.
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return path.includes('%') ? Math.min(1, path.length) : undefined;
  }
  return decoded !== path && firstLoginField(decoded) !== undefined
    ? Math.min(1, path.length)
    : undefined;
}

function firstLoginField(path: string): number | undefined {
  for (const match of path.matchAll(FIELD)) {
    const name = match[2] ?? '';
    if (LOGIN_FIELD_PARTS.test(name) || LOGIN_FIELD_NAMES.has(name.toLowerCase())) {
      return (match.index ?? 0) + (match[1] ?? '').length;
    }
  }
  return undefined;
}
