import { describe, expect, it, vi } from 'vitest';
import type { RgbaImage } from '../../../core/camera/rgba-image';
import type { Vec2 } from '../../../core/scene';
import { NO_PICTURE_MESSAGE, runHeadCapture, type HeadCaptureIo } from './head-capture-run';

const frame: RgbaImage = { data: new Uint8ClampedArray(4), width: 1, height: 1 };
const STOPS: ReadonlyArray<Vec2> = [
  { x: 10, y: 10 },
  { x: 40, y: 10 },
  { x: 40, y: 30 },
];

function fakeIo(
  overrides: Partial<HeadCaptureIo> = {},
): HeadCaptureIo & { readonly log: string[] } {
  const log: string[] = [];
  return {
    log,
    moveTo: async (head) => {
      log.push(`move ${head.x},${head.y}`);
    },
    // The head comes to rest a hair from where it was sent.
    settleAt: async (head) => ({ kind: 'settled', headMm: { x: head.x + 0.02, y: head.y } }),
    takePicture: async () => {
      log.push('picture');
      return frame;
    },
    stopRequested: () => false,
    onProgress: vi.fn(),
    ...overrides,
  };
}

describe('runHeadCapture', () => {
  it('moves, waits and takes a picture at every stop, recording where the head measured', async () => {
    const io = fakeIo();
    const outcome = await runHeadCapture(STOPS, io);
    expect(outcome.kind).toBe('done');
    expect(outcome.pictures.map((p) => p.headMm)).toEqual([
      { x: 10.02, y: 10 },
      { x: 40.02, y: 10 },
      { x: 40.02, y: 30 },
    ]);
    expect(io.log).toEqual([
      'move 10,10',
      'picture',
      'move 40,10',
      'picture',
      'move 40,30',
      'picture',
    ]);
    expect(io.onProgress).toHaveBeenLastCalledWith(3, 3);
  });

  it('stops when asked and keeps the pictures already taken', async () => {
    let pictures = 0;
    const io = fakeIo({
      takePicture: async () => {
        pictures += 1;
        return frame;
      },
      stopRequested: () => pictures >= 1,
    });
    const outcome = await runHeadCapture(STOPS, io);
    expect(outcome).toMatchObject({ kind: 'stopped' });
    expect(outcome.pictures).toHaveLength(1);
  });

  it('takes no picture at a stop the head was stopped on the way to', async () => {
    let stopping = false;
    const io = fakeIo({
      settleAt: async (head) => {
        stopping = true;
        return { kind: 'settled', headMm: head };
      },
      stopRequested: () => stopping,
    });
    const outcome = await runHeadCapture(STOPS, io);
    expect(outcome).toEqual({ kind: 'stopped', pictures: [] });
    expect(io.log).toEqual(['move 10,10']);
  });

  it('ends with the reason when the head cannot be moved', async () => {
    const io = fakeIo({
      moveTo: async (head) => {
        if (head.x === 40) throw new Error('The machine is in Alarm.');
      },
    });
    const outcome = await runHeadCapture(STOPS, io);
    expect(outcome).toMatchObject({ kind: 'failed', message: 'The machine is in Alarm.' });
    expect(outcome.pictures).toHaveLength(1);
  });

  it('ends with the reason when the head does not arrive', async () => {
    const io = fakeIo({
      settleAt: async () => ({ kind: 'failed', message: 'The machine disconnected.' }),
    });
    await expect(runHeadCapture(STOPS, io)).resolves.toEqual({
      kind: 'failed',
      message: 'The machine disconnected.',
      pictures: [],
    });
  });

  it('ends when the camera sends no picture', async () => {
    const io = fakeIo({ takePicture: async () => null });
    await expect(runHeadCapture(STOPS, io)).resolves.toEqual({
      kind: 'failed',
      message: NO_PICTURE_MESSAGE,
      pictures: [],
    });
  });
});
