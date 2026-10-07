import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { grblDriver } from '../../core/controllers';
import { createStreamer, step } from '../../core/controllers/grbl';
import { useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import {
  captureTestLaserStartFenceAck,
  respondToTestGrblHandshake,
} from './laser-test-start-helpers';

beforeEach(() => useLaserStore.setState(initialLaserState()));

afterEach(() => {
  useLaserStore.setState(initialLaserState());
});

describe('opt-in test Start fence acknowledgement ownership', () => {
  beforeEach(() => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      controllerSessionEpoch: 9,
      controllerOperation: { kind: 'start-arming', phase: 'queue-fence' },
      pendingUntrackedAcks: 1,
      pendingTransportWrites: 1,
    });
  });

  it('answers the standalone owned dwell once while transport is still completing', () => {
    const lines: string[] = [];
    const acknowledge = captureTestLaserStartFenceAck(
      `${grblDriver.commands.settleDwell}\n`,
      (line) => lines.push(line),
    );
    expect(lines).toEqual([]);
    acknowledge();
    acknowledge();
    expect(lines).toEqual(['ok']);
  });

  it.each(['?', 'M5\n', 'G4 P0.01\nG1 X1\n'])('leaves unrelated bytes %j unanswered', (data) => {
    const lines: string[] = [];
    captureTestLaserStartFenceAck(data, (line) => lines.push(line))();
    expect(lines).toEqual([]);
  });

  it('does not answer an operator or cleanup dwell', () => {
    const lines: string[] = [];
    useLaserStore.setState({
      controllerOperation: { kind: 'post-job-settle', phase: 'dwell', idleReports: 0 },
    });
    captureTestLaserStartFenceAck('G4 P0.01\n', (line) => lines.push(line))();
    expect(lines).toEqual([]);
  });

  it('cannot acknowledge a held program dwell after the streamer starts', () => {
    const lines: string[] = [];
    const acknowledge = captureTestLaserStartFenceAck('G4 P0.01\n', (line) => lines.push(line));
    useLaserStore.setState({ streamer: step(createStreamer('G4 P0.01\nG1 X1\n')).state });
    acknowledge();
    expect(lines).toEqual([]);
  });

  it('leaves an older queued command acknowledgement to its explicit owner', () => {
    const lines: string[] = [];
    useLaserStore.setState({ pendingUntrackedAcks: 2 });
    captureTestLaserStartFenceAck('G4 P0.01\n', (line) => lines.push(line))();
    expect(lines).toEqual([]);
  });

  it('does not duplicate an acknowledgement already emitted by the fixture', () => {
    const lines: string[] = [];
    const acknowledge = captureTestLaserStartFenceAck('G4 P0.01\n', (line) => lines.push(line));
    useLaserStore.setState({ pendingUntrackedAcks: 0 });
    acknowledge();
    expect(lines).toEqual([]);
  });

  it('does not send an old reply into a replacement controller session', () => {
    const lines: string[] = [];
    const acknowledge = captureTestLaserStartFenceAck('G4 P0.01\n', (line) => lines.push(line));
    useLaserStore.setState({ controllerSessionEpoch: 10 });
    acknowledge();
    expect(lines).toEqual([]);
  });

  it('does not lend a reply to a replacement Start reservation in the same session', () => {
    const lines: string[] = [];
    const acknowledge = captureTestLaserStartFenceAck('G4 P0.01\n', (line) => lines.push(line));
    useLaserStore.setState({ controllerOperation: { kind: 'start-arming', phase: 'queue-fence' } });
    acknowledge();
    expect(lines).toEqual([]);
  });
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
