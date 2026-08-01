import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('node:child_process', () => ({ default: { spawn: spawnMock }, spawn: spawnMock }));

import { streamWithFfmpeg } from './rtsp-camera-stream';

const PREVIEW_ACTIVITY_TIMEOUT_MS = 10_000;

type FakeFfmpeg = EventEmitter & {
  readonly stdout: EventEmitter & {
    readonly pause: ReturnType<typeof vi.fn>;
    readonly resume: ReturnType<typeof vi.fn>;
  };
  readonly stderr: EventEmitter;
  readonly kill: ReturnType<typeof vi.fn>;
};

type FakeResponse = EventEmitter & {
  headersSent: boolean;
  readonly writeHead: ReturnType<typeof vi.fn>;
  readonly write: ReturnType<typeof vi.fn>;
  readonly end: ReturnType<typeof vi.fn>;
  readonly destroy: ReturnType<typeof vi.fn>;
};

function fakeFfmpeg(): FakeFfmpeg {
  const child = new EventEmitter() as FakeFfmpeg;
  Object.assign(child, {
    stdout: Object.assign(new EventEmitter(), { pause: vi.fn(), resume: vi.fn() }),
    stderr: new EventEmitter(),
    kill: vi.fn(),
  });
  return child;
}

function fakeResponse(): FakeResponse {
  const response = new EventEmitter() as FakeResponse;
  Object.assign(response, {
    headersSent: false,
    writeHead: vi.fn(() => {
      response.headersSent = true;
      return response;
    }),
    write: vi.fn(() => true),
    end: vi.fn(),
    destroy: vi.fn(),
  });
  return response;
}

beforeEach(() => {
  vi.useFakeTimers();
  spawnMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('streamWithFfmpeg lifecycle', () => {
  it('aborts an unexpected continuous-stream EOF instead of ending cleanly', () => {
    const ffmpeg = fakeFfmpeg();
    const response = fakeResponse();
    spawnMock.mockReturnValue(ffmpeg);
    const lifecycle = { onLive: vi.fn(), onFailure: vi.fn(), onClosed: vi.fn() };
    streamWithFfmpeg(
      new URL('rtsp://192.168.1.20/live'),
      response as unknown as ServerResponse,
      lifecycle,
    );
    ffmpeg.stdout.emit('data', Buffer.from('frame'));

    expect(lifecycle.onLive).toHaveBeenCalledOnce();

    ffmpeg.stdout.emit('end');

    expect(response.destroy).toHaveBeenCalledWith(expect.any(Error));
    expect(lifecycle.onFailure).toHaveBeenCalledWith('FFmpeg camera preview ended unexpectedly.');
    expect(lifecycle.onClosed).not.toHaveBeenCalled();
    expect(response.end).not.toHaveBeenCalled();

    response.emit('drain');
    vi.advanceTimersByTime(PREVIEW_ACTIVITY_TIMEOUT_MS);
    expect(ffmpeg.stdout.resume).not.toHaveBeenCalled();
    expect(response.destroy).toHaveBeenCalledTimes(1);
    ffmpeg.emit('exit', 0, null);
  });

  it('reports an active client close without relabeling a prior stream failure', () => {
    const ffmpeg = fakeFfmpeg();
    const response = fakeResponse();
    const lifecycle = { onLive: vi.fn(), onFailure: vi.fn(), onClosed: vi.fn() };
    spawnMock.mockReturnValue(ffmpeg);
    streamWithFfmpeg(
      new URL('rtsp://192.168.1.20/live'),
      response as unknown as ServerResponse,
      lifecycle,
    );

    response.emit('close');

    expect(lifecycle.onClosed).toHaveBeenCalledOnce();
    expect(lifecycle.onFailure).not.toHaveBeenCalled();
    expect(ffmpeg.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it.each([
    { label: 'code 0', code: 0, signal: null },
    { label: 'SIGTERM', code: null, signal: 'SIGTERM' },
  ])('aborts an unexpected FFmpeg $label exit', ({ code, signal }) => {
    const ffmpeg = fakeFfmpeg();
    const response = fakeResponse();
    spawnMock.mockReturnValue(ffmpeg);
    streamWithFfmpeg(new URL('rtsp://192.168.1.20/live'), response as unknown as ServerResponse);
    ffmpeg.stdout.emit('data', Buffer.from('frame'));

    ffmpeg.emit('exit', code, signal);

    expect(response.destroy).toHaveBeenCalledWith(expect.any(Error));
    expect(response.end).not.toHaveBeenCalled();
  });

  it('aborts when a running preview stops producing output', () => {
    const ffmpeg = fakeFfmpeg();
    const response = fakeResponse();
    spawnMock.mockReturnValue(ffmpeg);
    streamWithFfmpeg(new URL('rtsp://192.168.1.20/live'), response as unknown as ServerResponse);
    ffmpeg.stdout.emit('data', Buffer.from('frame-a'));
    vi.advanceTimersByTime(PREVIEW_ACTIVITY_TIMEOUT_MS - 1);
    expect(response.destroy).not.toHaveBeenCalled();

    ffmpeg.stdout.emit('data', Buffer.from('frame-b'));
    vi.advanceTimersByTime(PREVIEW_ACTIVITY_TIMEOUT_MS - 1);
    expect(response.destroy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(response.destroy).toHaveBeenCalledWith(expect.any(Error));
    ffmpeg.emit('exit', 1, null);
  });

  it('suspends the activity timeout while response backpressure pauses output', () => {
    const ffmpeg = fakeFfmpeg();
    const response = fakeResponse();
    response.write.mockReturnValue(false);
    spawnMock.mockReturnValue(ffmpeg);
    streamWithFfmpeg(new URL('rtsp://192.168.1.20/live'), response as unknown as ServerResponse);

    ffmpeg.stdout.emit('data', Buffer.from('frame'));
    vi.advanceTimersByTime(PREVIEW_ACTIVITY_TIMEOUT_MS);
    expect(response.destroy).not.toHaveBeenCalled();
    expect(ffmpeg.stdout.pause).toHaveBeenCalledTimes(1);

    response.emit('drain');
    expect(ffmpeg.stdout.resume).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(PREVIEW_ACTIVITY_TIMEOUT_MS);
    expect(response.destroy).toHaveBeenCalledWith(expect.any(Error));
    ffmpeg.emit('exit', 1, null);
  });
});
