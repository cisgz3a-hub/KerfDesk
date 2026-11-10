// The login side of the bridge's RTSP probe. Most IP cameras answer an
// unauthenticated DESCRIBE with 401 and a WWW-Authenticate challenge; the
// client then repeats the request with an Authorization header (RFC 2326
// §D.1, RFC 7826 §19.1). The login travels only in that header: the
// Request-URI never carries it, as the camera would otherwise see (and many
// reject) a request line holding the password in plain text.

import { randomBytes } from 'node:crypto';
import {
  cameraLogin,
  loginAnswer,
  loginChallenges,
  type CameraLogin,
  type LoginChallenge,
} from './camera-login-answer.js';

export type RtspLogin = CameraLogin;

/** The camera address without its login, as sent in the request line. */
export function rtspRequestUri(url: URL): string {
  const bare = new URL(url.toString());
  bare.username = '';
  bare.password = '';
  return bare.toString();
}

/** The login written into the camera address, or null when it has none. */
export function rtspLogin(url: URL): RtspLogin | null {
  return cameraLogin(url);
}

/** The status code of an RTSP reply, or null when the status line is malformed. */
export function rtspStatusCode(response: string): number | null {
  const match = /^RTSP\/\d+(?:\.\d+)?\s+(\d{3})\b/i.exec(response);
  return match === null ? null : Number(match[1]);
}

/**
 * The Authorization header answering a 401 reply's challenge, or null when
 * the reply offers no scheme the bridge may answer: Digest whenever the camera
 * offers one it can compute, Basic only when Basic is all it offers, never
 * Basic in place of a Digest (ADR-692 Amendment 1). `cnonce` is fixed only by
 * tests.
 */
export function rtspAuthorization(
  response: string,
  login: RtspLogin,
  method: string,
  uri: string,
  cnonce: string = randomBytes(8).toString('hex'),
): string | null {
  const answer = loginAnswer(rtspChallenges(response), login, () => cnonce);
  return answer === null ? null : answer.header(method, uri);
}

/** The challenges in an RTSP reply's WWW-Authenticate headers. */
export function rtspChallenges(response: string): LoginChallenge[] {
  const head = response.split(/\r?\n\r?\n/, 1)[0] ?? '';
  const values: string[] = [];
  for (const line of head.split(/\r?\n/)) {
    const match = /^WWW-Authenticate:[ \t]*(.*)$/i.exec(line);
    if (match !== null) values.push(match[1] ?? '');
  }
  return loginChallenges(values);
}
