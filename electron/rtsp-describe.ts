import { Socket } from 'node:net';
import { RtspDescribeResponse } from './rtsp-describe-response.js';

export const RTSP_DESCRIBE_IDLE_TIMEOUT_MS = 2500;
export const RTSP_DESCRIBE_DEADLINE_MS = 5000;

export function sendRtspDescribe(
  host: string,
  port: number,
  url: string,
  createSocket: () => Socket = () => new Socket(),
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = createSocket();
    const response = new RtspDescribeResponse();
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
        if (complete !== null) settle({ response: complete });
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
          socket.write(
            [`DESCRIBE ${url} RTSP/1.0`, 'CSeq: 1', 'Accept: application/sdp', '', ''].join('\r\n'),
          );
        } catch (error) {
          fail(error);
        }
      });
    } catch (error) {
      fail(error);
    }
  });
}
