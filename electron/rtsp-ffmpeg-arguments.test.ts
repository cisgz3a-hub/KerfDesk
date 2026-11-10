// @vitest-environment node
// FFmpeg's arguments hold no part of the camera address, login or not
// (ADR-692 Amendment 1): other programs on the computer can read them. A
// recorder stands in for FFmpeg; it never connects, so nothing reaches the
// network.
import { EventEmitter } from 'node:events';
import type { ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('node:child_process', () => ({ default: { spawn: spawnMock }, spawn: spawnMock }));
vi.mock('./ffmpeg-path.js', () => ({
  FFMPEG_MISSING_REASON: 'No FFmpeg.',
  installedFfmpeg: () => '/opt/ffmpeg/bin/ffmpeg',
}));

import { captureRtspFrameJpeg, streamWithFfmpeg } from './rtsp-camera-stream';

const SECRET = 'stand-in-secret-0';
const CAMERA = new URL(
  `rtsp://viewer:${SECRET}@192.168.1.64:554/live/${SECRET}-path?user=viewer&password=${SECRET}`,
);

function recorder() {
  const child = Object.assign(new EventEmitter(), {
    stdout: Object.assign(new EventEmitter(), { pause: vi.fn(), resume: vi.fn() }),
    stderr: new EventEmitter(),
    kill: vi.fn(),
  });
  spawnMock.mockReturnValueOnce(child);
  return child;
}

async function spawnedArguments(): Promise<string[]> {
  await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
  return (spawnMock.mock.calls.at(-1)?.[1] ?? []) as string[];
}

afterEach(() => spawnMock.mockReset());

describe('FFmpeg’s command line (ADR-692 Amendment 1)', () => {
  it.each([
    [
      'a still picture',
      () => {
        const child = recorder();
        const result = captureRtspFrameJpeg(CAMERA);
        return { child, done: result };
      },
    ],
    [
      'the live preview',
      () => {
        const child = recorder();
        const response = Object.assign(new EventEmitter(), {
          headersSent: false,
          writeHead: vi.fn(),
          write: vi.fn(() => true),
          end: vi.fn(),
          destroy: vi.fn(),
        });
        streamWithFfmpeg(CAMERA, response as unknown as ServerResponse);
        return { child, done: Promise.resolve() };
      },
    ],
  ] as const)('holds only a loopback relay address for %s', async (_label, start) => {
    const { child, done } = start();
    const args = await spawnedArguments();
    const input = args[args.indexOf('-i') + 1] ?? '';
    expect(input).toMatch(/^rtsp:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}$/);
    for (const arg of args) {
      expect(arg).not.toContain(SECRET);
      expect(arg).not.toContain('viewer');
      expect(arg).not.toContain('192.168.1.64');
    }
    child.emit('exit', 1);
    child.emit('close', 1);
    await done;
  });
});
