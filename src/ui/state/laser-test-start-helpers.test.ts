import { afterEach, describe, expect, it } from 'vitest';
import { useLaserStore } from './laser-store';
import { respondToTestGrblHandshake } from './laser-test-start-helpers';

afterEach(() => {
  useLaserStore.setState({ controllerOperation: null });
});

describe('test GRBL handshake response ownership', () => {
  it('answers the modal query owned by the connection handshake', () => {
    const lines: string[] = [];
    useLaserStore.setState({
      controllerOperation: { kind: 'connection-handshake', phase: 'settings' },
    });

    respondToTestGrblHandshake('$G\n', (line) => lines.push(line));

    expect(lines).toEqual(['[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]', 'ok']);
  });

  it('does not answer an operator modal query after the handshake', () => {
    const lines: string[] = [];
    useLaserStore.setState({ controllerOperation: null });

    respondToTestGrblHandshake('$G\n', (line) => lines.push(line));

    expect(lines).toEqual([]);
  });
});
