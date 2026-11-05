import { describe, expect, it } from 'vitest';
import { portOpenWithoutAnswer } from './port-open-no-answer';

const failed = { kind: 'failed', epoch: 1, message: 'No answer' } as const;
const connected = { kind: 'connected' } as const;

describe('portOpenWithoutAnswer (UX audit U2-P3-3)', () => {
  it('is true when the open port never answered and the read gave up', () => {
    expect(
      portOpenWithoutAnswer({
        connection: connected,
        controllerQualification: failed,
        statusReport: null,
        detectedControllerKind: null,
      }),
    ).toBe(true);
  });

  it('is false once the controller has said anything', () => {
    expect(
      portOpenWithoutAnswer({
        connection: connected,
        controllerQualification: failed,
        statusReport: null,
        detectedControllerKind: 'grbl-v1.1',
      }),
    ).toBe(false);
  });

  it('is false while the first read is still running', () => {
    expect(
      portOpenWithoutAnswer({
        connection: connected,
        controllerQualification: { kind: 'qualifying', epoch: 1, phase: 'controller-response' },
        statusReport: null,
        detectedControllerKind: null,
      }),
    ).toBe(false);
  });
});
