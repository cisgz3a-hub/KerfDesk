// @vitest-environment node
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('node:child_process', () => ({ default: { spawn: spawnMock }, spawn: spawnMock }));

import { captureRtspFrameJpeg, hasFreeFfmpegSlot, streamWithFfmpeg } from './rtsp-camera-stream';

function fakeFfmpeg() {
  return Object.assign(new EventEmitter(), {
    stdout: Object.assign(new EventEmitter(), { pause: vi.fn(), resume: vi.fn() }),
    stderr: new EventEmitter(),
    kill: vi.fn(),
  });
}

let children: ReturnType<typeof fakeFfmpeg>[] = [];
const CAMERA = new URL('rtsp://user:private-password@192.168.1.20/live?token=private-token');
const PRIVATE_DIAGNOSTIC = `Error opening input file ${CAMERA.href}`;

beforeEach(() => {
  vi.useFakeTimers();
  children = [];
  spawnMock.mockReset().mockImplementation(() => {
    const child = fakeFfmpeg();
    children.push(child);
    return child;
  });
});

afterEach(() => {
  for (const child of children) {
    child.emit('exit', 1);
    child.emit('close', 1);
  }
  vi.useRealTimers();
});

function latestChild() {
  const child = children.at(-1);
  if (child === undefined) throw new Error('expected a spawned decoder');
  return child;
}

describe('RTSP capture process boundary', () => {
  it('waits for stdout to close before returning a complete JPEG', async () => {
    const result = captureRtspFrameJpeg(CAMERA);
    const child = latestChild();
    const settled = vi.fn();
    void result.then(settled);
    child.stdout.emit('data', Buffer.from([0xff, 0xd8, 1]));
    child.emit('exit', 0);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();

    child.stdout.emit('data', Buffer.from([2, 0xff, 0xd9]));
    child.stdout.emit('end');
    child.emit('close', 0);

    await expect(result).resolves.toEqual({
      kind: 'ok',
      jpeg: Buffer.from([0xff, 0xd8, 1, 2, 0xff, 0xd9]),
    });
  });

  it('keeps timed-out children counted until their processes actually close', async () => {
    const captures = Array.from({ length: 4 }, () => captureRtspFrameJpeg(CAMERA));
    expect(hasFreeFfmpegSlot()).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(Promise.all(captures)).resolves.toEqual(
      Array.from({ length: 4 }, () => ({
        kind: 'failed',
        reason: 'FFmpeg did not produce a camera frame in time.',
      })),
    );
    expect(hasFreeFfmpegSlot()).toBe(false);
    await expect(captureRtspFrameJpeg(CAMERA)).resolves.toEqual({
      kind: 'failed',
      reason: 'Too many concurrent camera streams.',
    });
    expect(children).toHaveLength(4);
    latestChild().emit('close', 1);
    expect(hasFreeFfmpegSlot()).toBe(true);
  });

  it('does not forward decoder stderr containing camera credentials on capture failure', async () => {
    const result = captureRtspFrameJpeg(CAMERA);
    const child = latestChild();
    child.stderr.emit('data', Buffer.from(PRIVATE_DIAGNOSTIC));
    child.emit('exit', 1);
    child.emit('close', 1);
    await expect(result).resolves.toEqual({
      kind: 'failed',
      reason: 'FFmpeg could not capture a camera frame.',
    });
  });

  it('reports an empty successful process as a failed capture', async () => {
    const result = captureRtspFrameJpeg(CAMERA);
    latestChild().emit('close', 0);
    await expect(result).resolves.toEqual({
      kind: 'failed',
      reason: 'FFmpeg could not capture a camera frame.',
    });
  });

  it('returns a safe spawn error and releases its slot when the failed process closes', async () => {
    const captures = Array.from({ length: 4 }, () => captureRtspFrameJpeg(CAMERA));
    const child = latestChild();
    child.emit('error', new Error(PRIVATE_DIAGNOSTIC));
    await expect(captures[3]).resolves.toEqual({
      kind: 'failed',
      reason: 'FFmpeg camera frame capture could not start.',
    });
    expect(hasFreeFfmpegSlot()).toBe(false);
    child.emit('close', -1);
    expect(hasFreeFfmpegSlot()).toBe(true);
  });

  it('does not forward decoder stderr to preview state or the public response', () => {
    const response = Object.assign(new EventEmitter(), {
      headersSent: false,
      writeHead: vi.fn(),
      end: vi.fn(),
      destroy: vi.fn(),
    });
    const lifecycle = { onLive: vi.fn(), onFailure: vi.fn(), onClosed: vi.fn() };
    streamWithFfmpeg(CAMERA, response as unknown as ServerResponse, lifecycle);
    const child = latestChild();
    child.stderr.emit('data', Buffer.from(PRIVATE_DIAGNOSTIC));
    child.emit('exit', 1);
    expect(lifecycle.onFailure).toHaveBeenCalledWith('FFmpeg camera preview ended unexpectedly.');
    expect(response.end).toHaveBeenCalledWith(
      JSON.stringify({ kind: 'unavailable', reason: 'FFmpeg camera preview ended unexpectedly.' }),
    );
  });
});
