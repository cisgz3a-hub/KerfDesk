import { describe, expect, it, vi } from 'vitest';
import {
  COMMON_BAUD_RATES,
  baudScanAnswer,
  baudScanCandidates,
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
