import { describe, expect, it } from 'vitest';
import { classifyTerminalResponseOwnership } from './controller-terminal-ownership';

const noOwner = {
  controllerKind: 'grbl-v1.1' as const,
  responseKind: 'ok',
  streamInFlight: 0,
  pendingUntrackedAcks: 0,
  pendingTransportWrites: 0,
  controllerCommandConsumed: false,
  autofocusBusy: false,
};

describe('controller terminal response ownership', () => {
  it('classifies a bare GRBL-family terminal response with no app owner as unexpected', () => {
    expect(classifyTerminalResponseOwnership(noOwner)).toBe('unexpected');
    expect(
      classifyTerminalResponseOwnership({
        ...noOwner,
        controllerKind: 'grblhal',
        responseKind: 'error',
      }),
    ).toBe('unexpected');
    expect(classifyTerminalResponseOwnership({ ...noOwner, controllerKind: 'fluidnc' })).toBe(
      'unexpected',
    );
  });

  it('accepts every explicit KerfDesk response owner', () => {
    expect(classifyTerminalResponseOwnership({ ...noOwner, streamInFlight: 1 })).toBe('owned');
    expect(classifyTerminalResponseOwnership({ ...noOwner, pendingUntrackedAcks: 1 })).toBe(
      'owned',
    );
    expect(classifyTerminalResponseOwnership({ ...noOwner, controllerCommandConsumed: true })).toBe(
      'owned',
    );
    expect(classifyTerminalResponseOwnership({ ...noOwner, autofocusBusy: true })).toBe('owned');
  });

  it('does not accuse another sender while a transport write can still own the response', () => {
    expect(classifyTerminalResponseOwnership({ ...noOwner, pendingTransportWrites: 1 })).toBe(
      'ambiguous',
    );
  });

  it('does not monitor nonterminal or non-GRBL-family responses', () => {
    expect(classifyTerminalResponseOwnership({ ...noOwner, responseKind: 'status' })).toBe(
      'not-monitored',
    );
    expect(classifyTerminalResponseOwnership({ ...noOwner, controllerKind: 'marlin' })).toBe(
      'not-monitored',
    );
    expect(classifyTerminalResponseOwnership({ ...noOwner, controllerKind: 'smoothieware' })).toBe(
      'not-monitored',
    );
  });
});
