// The login side of the bridge's RTSP probe. Most IP cameras answer an
// unauthenticated DESCRIBE with 401 and a WWW-Authenticate challenge; the
// client then repeats the request with an Authorization header (RFC 2326
// §D.1, RFC 7826 §19.1). The login travels only in that header: the
// Request-URI never carries it, as the camera would otherwise see (and many
// reject) a request line holding the password in plain text.

import { createHash, randomBytes } from 'node:crypto';

export type RtspLogin = { readonly username: string; readonly password: string };

/** The camera address without its login, as sent in the request line. */
export function rtspRequestUri(url: URL): string {
  const bare = new URL(url.toString());
  bare.username = '';
  bare.password = '';
  return bare.toString();
}

/** The login written into the camera address, or null when it has none. */
export function rtspLogin(url: URL): RtspLogin | null {
  if (url.username === '' && url.password === '') return null;
  return {
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

/** The status code of an RTSP reply, or null when the status line is malformed. */
export function rtspStatusCode(response: string): number | null {
  const match = /^RTSP\/\d+(?:\.\d+)?\s+(\d{3})\b/i.exec(response);
  return match === null ? null : Number(match[1]);
}

/**
 * The Authorization header answering a 401 reply's challenge, or null when
 * the reply offers no scheme this probe can answer (only Digest with MD5,
 * with or without qop=auth, and Basic). `cnonce` is fixed only by tests.
 */
export function rtspAuthorization(
  response: string,
  login: RtspLogin,
  method: string,
  uri: string,
  cnonce: string = randomBytes(8).toString('hex'),
): string | null {
  const challenges = wwwAuthenticate(response);
  const digest = challenges.find((c) => c.scheme === 'digest');
  if (digest !== undefined) {
    const header = digestAuthorization(digest.params, login, method, uri, cnonce);
    if (header !== null) return header;
  }
  if (challenges.some((c) => c.scheme === 'basic')) {
    const token = Buffer.from(`${login.username}:${login.password}`).toString('base64');
    return `Basic ${token}`;
  }
  return null;
}

type Challenge = { readonly scheme: string; readonly params: ReadonlyMap<string, string> };

// One challenge per WWW-Authenticate header; cameras send Digest and Basic as
// separate headers.
function wwwAuthenticate(response: string): Challenge[] {
  const head = response.split(/\r?\n\r?\n/, 1)[0] ?? '';
  const challenges: Challenge[] = [];
  for (const line of head.split(/\r?\n/)) {
    const match = /^WWW-Authenticate:[ \t]*([A-Za-z]+)[ \t]*(.*)$/i.exec(line);
    if (match === null) continue;
    challenges.push({
      scheme: (match[1] ?? '').toLowerCase(),
      params: challengeParams(match[2] ?? ''),
    });
  }
  return challenges;
}

function challengeParams(text: string): Map<string, string> {
  const params = new Map<string, string>();
  const pattern = /([A-Za-z]+)[ \t]*=[ \t]*(?:"((?:[^"\\]|\\.)*)"|([^,\s]*))/g;
  for (const match of text.matchAll(pattern)) {
    const value = match[2] === undefined ? (match[3] ?? '') : match[2].replace(/\\(.)/g, '$1');
    params.set((match[1] ?? '').toLowerCase(), value);
  }
  return params;
}

function digestAuthorization(
  params: ReadonlyMap<string, string>,
  login: RtspLogin,
  method: string,
  uri: string,
  cnonce: string,
): string | null {
  const realm = params.get('realm');
  const nonce = params.get('nonce');
  const algorithm = params.get('algorithm') ?? 'MD5';
  if (realm === undefined || nonce === undefined || algorithm.toUpperCase() !== 'MD5') return null;
  const qopOffered = params.get('qop');
  const qop = qopOffered?.split(',').some((q) => q.trim().toLowerCase() === 'auth') ? 'auth' : null;
  if (qopOffered !== undefined && qop === null) return null;
  const ha1 = md5(`${login.username}:${realm}:${login.password}`);
  const ha2 = md5(`${method}:${uri}`);
  const nc = '00000001';
  const response =
    qop === null
      ? md5(`${ha1}:${nonce}:${ha2}`)
      : md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
  const fields = [
    `username="${quoted(login.username)}"`,
    `realm="${quoted(realm)}"`,
    `nonce="${quoted(nonce)}"`,
    `uri="${quoted(uri)}"`,
    `response="${response}"`,
  ];
  const opaque = params.get('opaque');
  if (opaque !== undefined) fields.push(`opaque="${quoted(opaque)}"`);
  if (qop !== null) fields.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  return `Digest ${fields.join(', ')}`;
}

function md5(text: string): string {
  return createHash('md5').update(text, 'utf8').digest('hex');
}

function quoted(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}
