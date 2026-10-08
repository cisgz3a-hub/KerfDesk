import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import { useLaserStore, type LaserState } from '../../state/laser-store';
import type { SerialTranscriptEntry } from '../../state/laser-transcript';
import { createDiagnosticBundle, DIAGNOSTIC_BUNDLE_MAX_BYTES } from './diagnostic-bundle';
import { redactDiagnosticText } from './diagnostic-redaction';

function entry(raw: string, patch: Partial<SerialTranscriptEntry> = {}): SerialTranscriptEntry {
  return { id: 1, at: 10, raw, kind: 'message', direction: 'in', source: 'controller', ...patch };
}
function create(
  transcript: ReadonlyArray<SerialTranscriptEntry>,
  includeTranscript = true,
  state: Partial<LaserState> = {},
) {
  return createDiagnosticBundle({
    app: {
      appName: 'KerfDesk',
      appVersion: '1.2',
      gitSha: '1234abcd',
      buildTimeUtc: '2026-10-07T00:00:00Z',
      emitterRevision: '1',
    },
    platformId: 'web',
    device: { ...DEFAULT_DEVICE_PROFILE, name: 'Private customer profile' },
    machineKind: 'laser',
    laser: { ...useLaserStore.getState(), transcript, ...state },
    includeTranscript,
    createdAt: '2026-10-07T00:00:00Z',
  });
}

describe('local diagnostic bundle', () => {
  it('retains useful replies while excluding secrets and executable artwork', () => {
    const result = create([
      entry('error:20'),
      entry('password=hidden'),
      entry('serial number=unit-42'),
      entry('G1 X10 S100', { kind: 'gcode', source: 'console' }),
      entry('ok', { source: 'job' }),
      entry('ready C:\\Users\\Alice\\private.txt'),
      entry('visit https://user:pass@machine.example/?api_key=hidden'),
      entry('report alice@example.com 192.168.1.3'),
    ]);
    const decoded = JSON.parse(result.json);
    expect(decoded.transcript).toHaveLength(3);
    expect(result.transcriptOmitted).toBe(5);
    expect(result.json).toContain('error:20');
    for (const secret of [
      'hidden',
      'unit-42',
      'G1 X10',
      'Alice',
      'alice@example.com',
      '192.168.1.3',
      'Private customer',
    ]) {
      expect(result.json).not.toContain(secret);
    }
    expect(decoded.knownConnection.state).toBe('disconnected');
    expect(decoded.knownController.status).toBeNull();
  });

  it('can omit the transcript entirely and reports that omission', () => {
    const result = create([entry('error:20')], false);
    expect(JSON.parse(result.json).transcript).toEqual([]);
    expect(result.transcriptOmitted).toBe(1);
  });

  it('includes only same-session firmware claims and a target-free TCP identity', () => {
    const report: NonNullable<LaserState['controllerFirmwareReport']> = {
      controllerKind: 'fluidnc',
      query: '$I',
      fields: [
        { name: 'Version', value: '1.1f FluidNC' },
        { name: 'Board', value: '192.168.1.55' },
      ],
      reportedCapabilities: [],
      sessionEpoch: 12,
      observedAt: 10,
    };
    const result = create([], false, {
      connection: { kind: 'connected' },
      controllerSessionEpoch: 12,
      serialPortInfo: { transport: 'tcp' },
      connectedBaudRate: null,
      controllerFirmwareReport: report,
    });
    const bundle = JSON.parse(result.json);
    expect(bundle.knownConnection).toMatchObject({ transport: 'tcp', baudRate: null });
    expect(bundle.knownController.firmwareReport.fields).toContainEqual({
      name: 'Version',
      value: '1.1f FluidNC',
    });
    expect(result.json).not.toContain('192.168.1.55');
    const stale = create([], false, {
      connection: { kind: 'connected' },
      controllerSessionEpoch: 13,
      controllerFirmwareReport: report,
    });
    expect(JSON.parse(stale.json).knownController.firmwareReport).toBeNull();
  });

  it('allowlists numeric snapshots and never includes raw settings or controller user identity', () => {
    const rows = Array.from(
      { length: 300 },
      (_, id) =>
        ({
          id,
          code: `$${id}`,
          numericValue: id === 0 ? Infinity : id,
          rawValue: 'password=private-value',
          name: 'Private serial identity',
        }) as LaserState['grblSettingsRows'][number],
    );
    const result = create([], true, {
      grblSettingsRows: rows,
      controllerBuildInfo: {
        protocolVersion: '1.1h',
        buildRevision: '20190830',
        userInfo: 'private-unit-42',
        optionCodes: ['V'],
        plannerBufferBlocks: 15,
        rxBufferBytes: 128,
      },
    });
    const decoded = JSON.parse(result.json);
    expect(decoded.knownController.settings).toHaveLength(256);
    expect(decoded.knownController.settingsOmitted).toBe(44);
    expect(decoded.knownController.settings[0].numericValue).toBeNull();
    expect(decoded.knownController.build.rxBufferBytes).toBe(128);
    expect(result.json).not.toContain('private-value');
    expect(result.json).not.toContain('private-unit-42');
  });

  it('caps encoded UTF-8 bytes including JSON escaping and decoded text', () => {
    const result = create(
      Array.from({ length: 500 }, (_, id) =>
        entry('🟦'.repeat(300), {
          id,
          decoded: '🟨'.repeat(300),
        }),
      ),
    );
    expect(result.bytes).toBe(new TextEncoder().encode(result.json).byteLength);
    expect(result.bytes).toBeLessThanOrEqual(DIAGNOSTIC_BUNDLE_MAX_BYTES);
    expect(result.transcriptIncluded).toBeLessThan(200);
    expect(result.transcriptOmitted).toBe(500 - result.transcriptIncluded);
    expect(() => JSON.parse(result.json)).not.toThrow();
  });

  it('redacts paths, addresses, URLs and identifiers, and removes credential lines', () => {
    expect(redactDiagnosticText('secret: opaque')).toBeNull();
    expect(redactDiagnosticText('Authorization: Basic opaque')).toBeNull();
    for (const raw of [
      'C:\\Users\\Alice\\file.json',
      '\\\\host\\private\\file',
      '/home/alice/private',
      'https://example.test/a',
      'aa:bb:cc:dd:ee:ff',
      '11111111-2222-3333-4444-555555555555',
    ]) {
      expect(redactDiagnosticText(raw)).not.toContain(raw);
    }
  });
});
