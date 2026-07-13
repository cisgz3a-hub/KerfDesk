import { describe, expect, it } from 'vitest';
import { describeProbeResult, probeResultFromControllerFailure } from './probe-actions';

describe('probeResultFromControllerFailure', () => {
  it('preserves GRBL probe alarm meaning', () => {
    expect(probeResultFromControllerFailure(new Error('ALARM:5'), 'G38.2 Z-25')).toEqual({
      kind: 'probe-failed',
      alarmCode: 5,
    });
    expect(probeResultFromControllerFailure(new Error('ALARM:4'), 'G38.2 Z-25')).toEqual({
      kind: 'probe-failed',
      alarmCode: 4,
    });
    expect(probeResultFromControllerFailure(new Error('ALARM:1'), 'G38.2 Z-25')).toEqual({
      kind: 'alarm',
      alarmCode: 1,
    });
    expect(
      probeResultFromControllerFailure(new Error('Controller entered Alarm.'), 'G38.2 Z-25'),
    ).toEqual({ kind: 'alarm', alarmCode: null });
  });

  it('preserves rejected-line and timeout context', () => {
    expect(probeResultFromControllerFailure(new Error('error:9'), 'G91')).toEqual({
      kind: 'rejected',
      errorCode: 9,
      raw: 'error:9',
    });
    expect(probeResultFromControllerFailure(new Error('probe line 3 timed out.'), 'G38.2')).toEqual(
      {
        kind: 'timeout',
        pendingLine: 'G38.2',
      },
    );
  });
});

describe('describeProbeResult', () => {
  it('states that success includes physical settlement', () => {
    expect(describeProbeResult({ kind: 'ok' })).toEqual({
      message: 'Probe complete — work zero is set and motion is settled.',
      variant: 'success',
    });
  });

  it('warns that timeout leaves motion state unknown', () => {
    expect(
      describeProbeResult({ kind: 'timeout', pendingLine: 'fresh Idle after probe' }).message,
    ).toMatch(/motion state is unknown/i);
  });
});
