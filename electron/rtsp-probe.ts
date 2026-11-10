// The bridge's RTSP probe (/probe): one DESCRIBE proves an RTSP camera is
// at the address and names its codec before a preview session starts.

import type { Socket } from 'node:net';
import { sendRtspDescribe } from './rtsp-describe.js';
import {
  rtspAuthorization,
  rtspLogin,
  rtspRequestUri,
  rtspStatusCode,
} from './rtsp-describe-auth.js';

export const RTSP_NEEDS_LOGIN_REASON =
  'The RTSP camera needs a user name and password. Add them to the address, like rtsp://user:password@192.168.1.20/stream.';
export const RTSP_LOGIN_REFUSED_REASON =
  'The RTSP camera refused the user name or password in the address.';
export const RTSP_LOGIN_UNSUPPORTED_REASON =
  'The RTSP camera asks for its login in a form KerfDesk does not send.';

/** What to tell the operator about a login the camera asked for and did not get. */
export function rtspLoginReason(problem: 'needed' | 'refused' | 'unsupported'): string {
  if (problem === 'needed') return RTSP_NEEDS_LOGIN_REASON;
  return problem === 'refused' ? RTSP_LOGIN_REFUSED_REASON : RTSP_LOGIN_UNSUPPORTED_REASON;
}

// The login goes in an Authorization header after the camera's 401, never in
// the request line (see rtsp-describe-auth.ts). The stream's relay answers
// the same way, so a login this probe cannot send is reported here.
export async function probeRtsp(
  url: URL,
  createSocket?: () => Socket,
): Promise<{ readonly codec?: string }> {
  const port = Number(url.port || '554');
  const uri = rtspRequestUri(url);
  const login = rtspLogin(url);
  let answered = false;
  const authorize =
    login === null
      ? undefined
      : (challenge: string): string | null => {
          const header = rtspAuthorization(challenge, login, 'DESCRIBE', uri);
          answered = header !== null;
          return header;
        };
  const response = await sendRtspDescribe(url.hostname, port, uri, createSocket, authorize);
  if (rtspStatusCode(response) === 401) {
    if (login === null) throw new Error(RTSP_NEEDS_LOGIN_REASON);
    // The relay that logs in for FFmpeg answers exactly as this probe does.
    throw new Error(answered ? RTSP_LOGIN_REFUSED_REASON : RTSP_LOGIN_UNSUPPORTED_REASON);
  }
  if (!rtspProbeIsOk(response)) throw new Error('RTSP camera did not accept DESCRIBE.');
  const codec = parseCodec(response);
  return codec === undefined ? {} : { codec };
}

export function rtspProbeIsOk(response: string): boolean {
  return /^RTSP\/\d+(?:\.\d+)?\s+200\b/i.test(response);
}

function parseCodec(response: string): string | undefined {
  const match = /^a=rtpmap:\d+\s+([^/\r\n]+)/im.exec(response);
  return match?.[1]?.trim();
}
