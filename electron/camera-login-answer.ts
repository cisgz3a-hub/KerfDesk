// Answering a camera's login challenge, for RTSP (RFC 2326 §D.1, RFC 7826
// §19.1) and HTTP (RFC 7235, RFC 7616) alike (ADR-692 Amendment 1). The
// bridge sends a login only after the camera asks for one, and only in the
// strongest form the camera offers: any Digest the camera offers is answered
// with Digest, and a login goes as Basic only when Basic is all it offers.

import { createHash, randomBytes } from 'node:crypto';

export type CameraLogin = { readonly username: string; readonly password: string };

export type LoginChallenge = {
  readonly scheme: string;
  readonly params: ReadonlyMap<string, string>;
};

/** Answers requests on one connection or to one camera; Digest counts its uses. */
export type LoginAnswer = {
  readonly scheme: 'digest' | 'basic';
  readonly header: (method: string, uri: string) => string;
};

const DIGEST_HASHES: Readonly<Record<string, string>> = {
  md5: 'md5',
  'md5-sess': 'md5',
  'sha-256': 'sha256',
  'sha-256-sess': 'sha256',
};

/** The login written into a camera address, or null when it has none. */
export function cameraLogin(url: URL): CameraLogin | null {
  if (url.username === '' && url.password === '') return null;
  try {
    return {
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
    };
  } catch {
    return { username: url.username, password: url.password };
  }
}

/** Every challenge in some WWW-Authenticate values, each of which may hold several. */
export function loginChallenges(values: ReadonlyArray<string>): LoginChallenge[] {
  const challenges: { scheme: string; params: Map<string, string> }[] = [];
  for (const item of values.flatMap(commaItems)) {
    const start = CHALLENGE_START.exec(item);
    const param = PARAM.exec(item);
    const current = challenges.at(-1);
    if (param !== null && current !== undefined && start?.[2] === undefined) {
      addParam(current.params, param);
    } else if (start !== null) {
      const params = new Map<string, string>();
      addParam(params, PARAM.exec(start[2] ?? ''));
      challenges.push({ scheme: (start[1] ?? '').toLowerCase(), params });
    }
  }
  return challenges;
}

const CHALLENGE_START = /^([A-Za-z][\w!#$%&'*+.^`|~-]*)(?:\s+(.*))?$/s;
const PARAM = /^([\w!#$%&'*+.^`|~-]+)\s*=\s*(.*)$/s;

function addParam(params: Map<string, string>, match: RegExpExecArray | null): void {
  if (match !== null) params.set((match[1] ?? '').toLowerCase(), unquote(match[2] ?? ''));
}

/**
 * How to answer `challenges` with `login`, or null when the camera offers no
 * scheme the bridge may answer. A Digest the bridge cannot compute is never
 * replaced by Basic. `cnonce` is fixed only by tests.
 */
export function loginAnswer(
  challenges: ReadonlyArray<LoginChallenge>,
  login: CameraLogin,
  cnonce: () => string = () => randomBytes(8).toString('hex'),
): LoginAnswer | null {
  const digests = challenges.filter((c) => c.scheme === 'digest');
  for (const digest of digests) {
    const answer = digestAnswer(digest.params, login, cnonce);
    if (answer !== null) return answer;
  }
  if (digests.length > 0) return null;
  if (!challenges.some((c) => c.scheme === 'basic')) return null;
  const token = Buffer.from(`${login.username}:${login.password}`).toString('base64');
  return { scheme: 'basic', header: () => `Basic ${token}` };
}

/** True when a challenge says only the nonce went out of date, not the login. */
export function staleNonce(challenges: ReadonlyArray<LoginChallenge>): boolean {
  return challenges.some(
    (c) => c.scheme === 'digest' && c.params.get('stale')?.toLowerCase() === 'true',
  );
}

function digestAnswer(
  params: ReadonlyMap<string, string>,
  login: CameraLogin,
  cnonce: () => string,
): LoginAnswer | null {
  const realm = params.get('realm');
  const nonce = params.get('nonce');
  const algorithm = (params.get('algorithm') ?? 'MD5').toLowerCase();
  const hash = DIGEST_HASHES[algorithm];
  if (realm === undefined || nonce === undefined || hash === undefined) return null;
  const qopOffered = params.get('qop');
  const offered = (qopOffered ?? '').split(',').map((q) => q.trim().toLowerCase());
  const qop = offered.includes('auth') ? 'auth' : offered.includes('auth-int') ? 'auth-int' : null;
  if (qopOffered !== undefined && qop === null) return null;
  const h = (text: string): string => createHash(hash).update(text, 'utf8').digest('hex');
  const opaque = params.get('opaque');
  let count = 0;
  return {
    scheme: 'digest',
    header: (method, uri) => {
      count += 1;
      const nc = count.toString(16).padStart(8, '0');
      const client = cnonce();
      const base = h(`${login.username}:${realm}:${login.password}`);
      const ha1 = algorithm.endsWith('-sess') ? h(`${base}:${nonce}:${client}`) : base;
      // Requests the bridge answers carry no body, so auth-int hashes an empty one.
      const ha2 = qop === 'auth-int' ? h(`${method}:${uri}:${h('')}`) : h(`${method}:${uri}`);
      const response =
        qop === null
          ? h(`${ha1}:${nonce}:${ha2}`)
          : h(`${ha1}:${nonce}:${nc}:${client}:${qop}:${ha2}`);
      const fields = [
        `username="${quoted(login.username)}"`,
        `realm="${quoted(realm)}"`,
        `nonce="${quoted(nonce)}"`,
        `uri="${quoted(uri)}"`,
        `response="${response}"`,
      ];
      if (params.has('algorithm')) fields.push(`algorithm=${params.get('algorithm') ?? 'MD5'}`);
      if (opaque !== undefined) fields.push(`opaque="${quoted(opaque)}"`);
      if (qop !== null) fields.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${client}"`);
      return `Digest ${fields.join(', ')}`;
    },
  };
}

// Comma-separated items, keeping commas inside quoted strings.
function commaItems(value: string): string[] {
  const items: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < value.length; i += 1) {
    const char = value[i] ?? '';
    if (char === '\\' && inQuotes) {
      current += char + (value[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (char === '"') inQuotes = !inQuotes;
    if (char === ',' && !inQuotes) {
      if (current.trim() !== '') items.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim() !== '') items.push(current.trim());
  return items;
}

function unquote(value: string): string {
  const text = value.trim();
  return text.startsWith('"') && text.endsWith('"') && text.length >= 2
    ? text.slice(1, -1).replace(/\\(.)/g, '$1')
    : text;
}

function quoted(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}
