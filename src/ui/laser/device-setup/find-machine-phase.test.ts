import { describe, expect, it } from 'vitest';
import { phaseFromFacts, type FindMachineFacts } from './find-machine-phase';

const idle: FindMachineFacts = {
  supportsSerial: true,
  transport: 'serial',
  controllerLabel: 'GRBL v1.1',
  fileOnlyExplanation: 'Export the job as a file.',
  baudRate: 115200,
  connection: { kind: 'disconnected' },
  qualification: { kind: 'disconnected', epoch: 0 },
  heardController: false,
  detectedLabel: null,
  portUsb: null,
  connectedBaudRate: null,
  scan: { kind: 'idle' },
};

const connected: FindMachineFacts = {
  ...idle,
  connection: { kind: 'connected' },
  portUsb: '1a86:7523',
  connectedBaudRate: 115200,
};

describe('connection strip states (ADR-420, ADR-637)', () => {
  it('says it is not connected, and that connecting is optional', () => {
    const idlePhase = phaseFromFacts(idle);
    expect(idlePhase).toMatchObject({ kind: 'idle', title: 'Not connected' });
    expect(idlePhase.detail).toContain('You can choose your machine without connecting.');
  });

  it('keeps a browser without Web Serial and a file-only controller on the offline path', () => {
    expect(phaseFromFacts({ ...idle, supportsSerial: false }).kind).toBe('unsupported');
    expect(phaseFromFacts({ ...idle, transport: 'file-only' })).toMatchObject({
      kind: 'file-only',
      detail: 'Export the job as a file.',
    });
  });

  it('follows the connection through reading to found', () => {
    expect(phaseFromFacts({ ...idle, connection: { kind: 'connecting' } }).kind).toBe('connecting');
    const reading = phaseFromFacts({
      ...connected,
      qualification: { kind: 'qualifying', epoch: 1, phase: 'settings-read' },
      heardController: true,
    });
    expect(reading).toMatchObject({ kind: 'reading', title: 'Reading your controller…' });
    expect(reading.detail).toContain('on USB 1a86:7523 at 115200 baud');
    expect(
      phaseFromFacts({ ...connected, heardController: true, detectedLabel: 'grblhal' }),
    ).toMatchObject({ kind: 'found', title: 'Found your grblHAL controller' });
  });

  it('offers other speeds when the port opened but nothing answered', () => {
    const silent = phaseFromFacts({
      ...connected,
      qualification: { kind: 'failed', epoch: 1, message: 'No response' },
    });
    expect(silent).toMatchObject({ kind: 'silent', title: 'Your machine didn’t answer' });
    expect(
      phaseFromFacts({
        ...connected,
        scan: { kind: 'running', baudRate: 250000, index: 2, of: 7 },
      }),
    ).toMatchObject({ kind: 'scanning', detail: expect.stringContaining('250000 baud (2 of 7)') });
    expect(
      phaseFromFacts({ ...idle, scan: { kind: 'none', tried: [230400, 250000] } }),
    ).toMatchObject({ kind: 'failed', title: 'No answer at any common speed' });
  });

  it('names a busy port', () => {
    const failed = phaseFromFacts({
      ...idle,
      connection: { kind: 'failed', error: 'Failed to open serial port.' },
    });
    expect(failed.kind).toBe('failed');
    expect(failed.detail).toContain('The port is busy or unavailable');
  });
});
