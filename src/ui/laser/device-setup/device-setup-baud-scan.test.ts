import { describe, expect, it, vi } from 'vitest';
import {
  COMMON_BAUD_RATES,
  baudScanAnswer,
  baudScanCandidates,
  createBaudScanOwnership,
  scanBaudRates,
  type BaudScanAnswer,
  type BaudScanLink,
} from './device-setup-baud-scan';

function link(
  answers: Record<number, BaudScanAnswer>,
  cancelAfter?: number,
): BaudScanLink & {
  readonly opened: number[];
} {
  const opened: number[] = [];
  let current = 0;
  return {
    opened,
    connectAt: vi.fn(async (baudRate: number) => {
      current = baudRate;
      opened.push(baudRate);
    }),
    disconnect: vi.fn(async () => undefined),
    awaitAnswer: async () => answers[current] ?? 'silent',
    cancelled: () => cancelAfter !== undefined && opened.length >= cancelAfter,
  };
}

describe('Try other speeds (ADR-420)', () => {
  it('skips the speed already tried and keeps the common order', () => {
    expect(baudScanCandidates([115200])).toEqual(COMMON_BAUD_RATES.slice(1));
    expect(baudScanCandidates([57600])).not.toContain(57600);
  });

  it('stops at the first speed that answers', async () => {
    const scan = link({ 250000: 'answered' });
    const tries: number[] = [];
    const result = await scanBaudRates(scan, baudScanCandidates([115200]), (baud) =>
      tries.push(baud),
    );
    expect(result).toEqual({ kind: 'found', baudRate: 250000 });
    expect(scan.opened).toEqual([230400, 250000]);
    expect(tries).toEqual([230400, 250000]);
  });

  it('reports every speed tried when none answers and leaves the port closed', async () => {
    const scan = link({});
    const candidates = baudScanCandidates([115200]);
    const result = await scanBaudRates(scan, candidates, () => undefined);
    expect(result).toEqual({ kind: 'none', tried: candidates });
    expect(scan.disconnect).toHaveBeenCalledTimes(candidates.length + 1);
  });

  it('gives up when the port will not open at all', async () => {
    const scan = link({ 230400: 'failed' });
    const result = await scanBaudRates(scan, baudScanCandidates([115200]), () => undefined);
    expect(result).toEqual({ kind: 'none', tried: [230400] });
    expect(scan.opened).toEqual([230400]);
  });

  it('stops when cancelled', async () => {
    const scan = link({}, 2);
    const result = await scanBaudRates(scan, baudScanCandidates([115200]), () => undefined);
    expect(result).toEqual({ kind: 'cancelled' });
    expect(scan.opened).toHaveLength(2);
  });

  // 2026-09-26 review of #941: a scan cancelled while an attempt was pending
  // went on to close whatever connection was open by then, and a restarted
  // scan revived the old one. A cancelled scan now returns before its next
  // step and closes nothing.
  it('closes nothing when cancelled while the port opens', async () => {
    let cancelled = false;
    const disconnect = vi.fn(async () => undefined);
    const awaitAnswer = vi.fn(async (): Promise<BaudScanAnswer> => 'silent');
    const result = await scanBaudRates(
      {
        connectAt: async () => {
          cancelled = true;
        },
        disconnect,
        awaitAnswer,
        cancelled: () => cancelled,
      },
      [230400, 250000],
      () => undefined,
    );
    expect(result).toEqual({ kind: 'cancelled' });
    expect(awaitAnswer).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('leaves the connection open when cancelled during the last answer', async () => {
    let cancelled = false;
    let opened = 0;
    const candidates = [230400, 250000];
    const disconnect = vi.fn(async () => undefined);
    const result = await scanBaudRates(
      {
        connectAt: async () => {
          opened += 1;
        },
        disconnect,
        awaitAnswer: async () => {
          // Stop, then another connection replaces the scan's, before it answers.
          if (opened === candidates.length) cancelled = true;
          return 'silent';
        },
        cancelled: () => cancelled,
      },
      candidates,
      () => undefined,
    );
    expect(result).toEqual({ kind: 'cancelled' });
    // One close before each attempt, and no clean-up after the cancel.
    expect(disconnect).toHaveBeenCalledTimes(candidates.length);
  });

  it('retires a stopped scan so a restarted one owns the connection alone', async () => {
    const ownership = createBaudScanOwnership();
    const calls: string[] = [];
    let answerFirst: (answer: BaudScanAnswer) => void = () => undefined;
    const first = scanBaudRates(
      {
        connectAt: async (baud) => void calls.push(`first opens ${baud}`),
        disconnect: async () => void calls.push('first closes'),
        awaitAnswer: () => new Promise((resolve) => (answerFirst = resolve)),
        cancelled: ownership.claim(),
      },
      // Its last speed, so a silent answer would be followed by the clean-up close.
      [230400],
      () => undefined,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    ownership.retire(); // Stop
    const second = scanBaudRates(
      {
        connectAt: async (baud) => void calls.push(`second opens ${baud}`),
        disconnect: async () => void calls.push('second closes'),
        awaitAnswer: async () => 'answered',
        cancelled: ownership.claim(),
      },
      [57600],
      () => undefined,
    );
    expect(await second).toEqual({ kind: 'found', baudRate: 57600 });
    answerFirst('silent');
    expect(await first).toEqual({ kind: 'cancelled' });
    expect(calls).toEqual([
      'first closes',
      'first opens 230400',
      'second closes',
      'second opens 57600',
    ]);
  });

  it('retires the running scan when setup closes or a new scan claims', () => {
    const ownership = createBaudScanOwnership();
    const first = ownership.claim();
    expect(first()).toBe(false);
    const second = ownership.claim();
    expect(first()).toBe(true);
    expect(second()).toBe(false);
    ownership.retire(); // unmount
    expect(second()).toBe(true);
  });

  it('reads an answer from the live connection', () => {
    const base = {
      connection: { kind: 'connected' } as const,
      statusReport: null,
      detectedControllerKind: null,
      controllerQualification: { kind: 'qualifying' },
    };
    expect(baudScanAnswer(base)).toBeNull();
    expect(baudScanAnswer({ ...base, statusReport: {} })).toBe('answered');
    expect(baudScanAnswer({ ...base, detectedControllerKind: 'grblhal' })).toBe('answered');
    expect(baudScanAnswer({ ...base, controllerQualification: { kind: 'failed' } })).toBe('silent');
    expect(baudScanAnswer({ ...base, connection: { kind: 'failed', error: 'x' } })).toBe('failed');
    expect(baudScanAnswer({ ...base, connection: { kind: 'connecting' } })).toBeNull();
  });
});
