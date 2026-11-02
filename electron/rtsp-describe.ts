import { Socket } from 'node:net';
import { RtspDescribeResponse } from './rtsp-describe-response.js';
import { rtspStatusCode } from './rtsp-describe-auth.js';

export const RTSP_DESCRIBE_IDLE_TIMEOUT_MS = 2500;
export const RTSP_DESCRIBE_DEADLINE_MS = 5000;

/**
 * Answers a 401 reply with the Authorization header for one repeat of the
 * DESCRIBE, or null to keep the 401 (see rtsp-describe-auth.ts).
 */
export type RtspAuthorize = (challenge: string) => string | null;

export function sendRtspDescribe(
  host: string,
  port: number,
  url: string,
  createSocket: () => Socket = () => new Socket(),
  authorize?: RtspAuthorize,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createSocket();
    let response = new RtspDescribeResponse();
    let cseq = 1;
    let settled = false;
    const deadline = setTimeout(
      () => fail(new Error('RTSP probe exceeded the overall deadline.')),
      RTSP_DESCRIBE_DEADLINE_MS,
    );
    const settle = (result: { response: string } | { error: Error }): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      socket.destroy();
      if ('error' in result) reject(result.error);
      else resolve(result.response);
    };
    const fail = (error: unknown): void => {
      settle({ error: error instanceof Error ? error : new Error('RTSP probe failed.') });
    };
    socket.setTimeout(RTSP_DESCRIBE_IDLE_TIMEOUT_MS, () =>
      fail(new Error('RTSP probe timed out.')),
    );
    socket.on('error', fail);
    socket.on('data', (chunk: Buffer) => {
      if (settled) return;
      try {
        const complete = response.append(chunk);
        if (complete === null) return;
        // The repeat goes on this connection, as FFmpeg sends it: a camera may
        // tie its Digest nonce to the connection that asked for the login.
        const authorization =
          cseq === 1 && rtspStatusCode(complete) === 401 ? (authorize?.(complete) ?? null) : null;
        if (authorization === null) {
          settle({ response: complete });
          return;
        }
        cseq = 2;
        response = new RtspDescribeResponse();
        socket.write(describeRequest(url, cseq, authorization));
      } catch (error) {
        fail(error);
      }
    });
    socket.on('end', () =>
      fail(new Error('RTSP probe ended before a complete DESCRIBE response.')),
    );
    socket.on('close', () =>
      fail(new Error('RTSP probe closed before a complete DESCRIBE response.')),
    );
    try {
      socket.connect(port, host, () => {
        if (settled) return;
        try {
          socket.write(describeRequest(url, cseq, null));
        } catch (error) {
          fail(error);
        }
      });
    } catch (error) {
      fail(error);
    }
  });
}

function describeRequest(url: string, cseq: number, authorization: string | null): string {
  const lines = [`DESCRIBE ${url} RTSP/1.0`, `CSeq: ${cseq}`];
  if (authorization !== null) lines.push(`Authorization: ${authorization}`);
  lines.push('Accept: application/sdp', '', '');
  return lines.join('\r\n');
}
