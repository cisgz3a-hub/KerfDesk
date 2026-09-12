// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_CAMERA_FRAME_BYTES } from './camera-frame-body';
import { fetchFrameBytes, fetchFrameBytesQueued } from './camera-frame-proxy';

const CAMERA_URL = 'http://192.168.10.1/frame';
const JPEG = Uint8Array.from([0xff, 0xd8, 0x01, 0x02]);

function streamedFrame(chunks: readonly Uint8Array[], headers: HeadersInit = {}) {
  let next = 0;
  const cancel = vi.fn();
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    const chunk = chunks[next++];
    if (chunk === undefined) controller.close();
    else controller.enqueue(chunk);
  });
  const body = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
  return { response: new Response(body, { headers }), body, pull, cancel };
}

afterEach(() => vi.unstubAllGlobals());

describe('camera HTTP frame streaming bound', () => {
  it('preserves fragmented frame bytes and the redirect/timeout controls', async () => {
    const frame = streamedFrame([JPEG.subarray(0, 1), JPEG.subarray(1)]);
    const fetch = vi.fn().mockResolvedValue(frame.response);
    vi.stubGlobal('fetch', fetch);

    const result = await fetchFrameBytes(CAMERA_URL, 1000);
    expect(result).toEqual({ kind: 'ok', bytes: Buffer.from(JPEG), contentType: 'image/jpeg' });
    expect(fetch).toHaveBeenCalledWith(CAMERA_URL, {
      redirect: 'error',
      signal: expect.any(AbortSignal),
    });
    expect(frame.cancel).not.toHaveBeenCalled();
    expect(frame.body.locked).toBe(false);
  });

  it('accepts a frame exactly at the 8 MiB boundary', async () => {
    const frame = streamedFrame([JPEG, new Uint8Array(MAX_CAMERA_FRAME_BYTES - JPEG.length)], {
      'content-length': String(MAX_CAMERA_FRAME_BYTES),
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(frame.response));
    const result = await fetchFrameBytes(CAMERA_URL, 1000);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.bytes.length).toBe(MAX_CAMERA_FRAME_BYTES);
    expect(frame.cancel).not.toHaveBeenCalled();
  });

  it.each([undefined, '1', 'not-a-length'])(
    'cancels an overflow with Content-Length %s',
    async (length) => {
      const headers = length === undefined ? {} : { 'content-length': length };
      const frame = streamedFrame(
        [new Uint8Array(MAX_CAMERA_FRAME_BYTES), Uint8Array.of(1), JPEG],
        headers,
      );
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(frame.response));
      await expect(fetchFrameBytes(CAMERA_URL, 1000)).resolves.toEqual({
        kind: 'failed',
        reason: 'Camera frame is too large.',
      });
      expect(frame.pull).toHaveBeenCalledTimes(2);
      expect(frame.cancel).toHaveBeenCalledOnce();
      expect(frame.body.locked).toBe(false);
    },
  );

  it('rejects an oversized first chunk without draining the next one', async () => {
    const frame = streamedFrame([new Uint8Array(MAX_CAMERA_FRAME_BYTES + 1), JPEG]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(frame.response));
    await expect(fetchFrameBytes(CAMERA_URL, 1000)).resolves.toMatchObject({ kind: 'failed' });
    expect(frame.pull).toHaveBeenCalledTimes(1);
    expect(frame.cancel).toHaveBeenCalledOnce();
  });

  it.each([String(MAX_CAMERA_FRAME_BYTES + 1), '999999999999999999999999'])(
    'rejects declared overflow %s before reading',
    async (length) => {
      const frame = streamedFrame([JPEG], { 'content-length': length });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(frame.response));
      await expect(fetchFrameBytes(CAMERA_URL, 1000)).resolves.toEqual({
        kind: 'failed',
        reason: 'Camera frame is too large.',
      });
      expect(frame.pull).not.toHaveBeenCalled();
      expect(frame.cancel).toHaveBeenCalledOnce();
    },
  );

  it('releases the per-host queue after refusing an oversized response', async () => {
    const overflow = streamedFrame([new Uint8Array(MAX_CAMERA_FRAME_BYTES + 1), JPEG]);
    const valid = streamedFrame([JPEG]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(overflow.response).mockResolvedValueOnce(valid.response),
    );
    const [failed, next] = await Promise.all([
      fetchFrameBytesQueued(CAMERA_URL, 1000),
      fetchFrameBytesQueued(CAMERA_URL + '?next', 1000),
    ]);
    expect(failed.kind).toBe('failed');
    expect(next.kind).toBe('ok');
    expect(overflow.cancel).toHaveBeenCalledOnce();
  });

  it('cancels HTTP error bodies without downloading their contents', async () => {
    const frame = streamedFrame([new Uint8Array(MAX_CAMERA_FRAME_BYTES + 1)]);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(frame.body, { status: 503 })));
    await expect(fetchFrameBytes(CAMERA_URL, 1000)).resolves.toEqual({
      kind: 'failed',
      reason: 'Camera returned HTTP 503.',
    });
    expect(frame.pull).not.toHaveBeenCalled();
    expect(frame.cancel).toHaveBeenCalledOnce();
  });
});
