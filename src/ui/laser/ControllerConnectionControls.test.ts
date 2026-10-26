import { describe, expect, it } from 'vitest';
import { connectionControlsBusy } from './ControllerConnectionControls';

describe('connection controls during auto-focus', () => {
  it('keeps Disconnect available during active and motion-uncertain auto-focus', () => {
    expect(
      connectionControlsBusy(null, {
        kind: 'autofocus',
        phase: 'command',
        idleReports: 0,
      }),
    ).toBe(false);
    expect(
      connectionControlsBusy(null, {
        kind: 'autofocus',
        phase: 'motion-uncertain',
        idleReports: 0,
      }),
    ).toBe(false);
  });

  it('continues to lock connection controls during owned motion', () => {
    expect(connectionControlsBusy({ kind: 'jog' }, null)).toBe(true);
  });

  it('frees them for a stopped owner that only a missing reply holds (ADR-640)', () => {
    expect(connectionControlsBusy({ kind: 'jog' }, null, true)).toBe(false);
  });
});
