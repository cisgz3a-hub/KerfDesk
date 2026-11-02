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

// The login goes in an Authorization header after the camera's 401, never in
// the request line (see rtsp-describe-auth.ts). A challenge this probe cannot
// answer still proves an RTSP camera is there; FFmpeg logs in for the stream.
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
    if (!answered) return {};
    throw new Error(RTSP_LOGIN_REFUSED_REASON);
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
