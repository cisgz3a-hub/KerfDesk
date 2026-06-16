import { describe, expect, it } from 'vitest';
import { createStreamer, parseStatusReport, settingsMapToRows } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { SerialTranscriptEntry } from './laser-transcript';
import {
  MACHINE_DIAGNOSTIC_TRANSCRIPT_LIMIT,
  createMachineDiagnosticBundle,
} from './machine-diagnostic-bundle';

describe('createMachineDiagnosticBundle', () => {
  it('captures profile, controller, stream, and trimmed transcript evidence', () => {
    const transcript = Array.from({ length: MACHINE_DIAGNOSTIC_TRANSCRIPT_LIMIT + 5 }, (_, i) =>
      transcriptEntry(i + 1),
    );
    const streamer = createStreamer('G21\nG1 X1 F600\nM5\n', {
      rxBufferBytes: 80,
      streamingMode: 'ping-pong',
      pollDuringJob: 'off',
    });

    const bundle = createMachineDiagnosticBundle({
      createdAt: '2026-06-16T00:00:00.000Z',
      profile: DEFAULT_DEVICE_PROFILE,
      controllerSettings: { maxPowerS: 1000, laserModeEnabled: true },
      grblSettingsRows: settingsMapToRows(new Map([[30, '1000']])),
      statusReport: parseStatusReport('<Idle|MPos:1.000,2.000,0.000|FS:0,0>'),
      wcoCache: { x: 1, y: 2, z: 0 },
      workOriginActive: true,
      streamer,
      transcript,
      sampleGcode: 'G21\nM4 S0\n',
    });

    expect(bundle.format).toBe('laserforge-machine-diagnostic');
    expect(bundle.profile.controller).toEqual(DEFAULT_DEVICE_PROFILE.controller);
    expect(bundle.profile.gcodeDialect).toEqual(DEFAULT_DEVICE_PROFILE.gcodeDialect);
    expect(bundle.controller.settings).toEqual({ maxPowerS: 1000, laserModeEnabled: true });
    expect(bundle.controller.settingsRows).toEqual([
      expect.objectContaining({ code: '$30', rawValue: '1000' }),
    ]);
    expect(bundle.controller.statusReport?.state).toBe('Idle');
    expect(bundle.controller.wcoCache).toEqual({ x: 1, y: 2, z: 0 });
    expect(bundle.controller.workOriginActive).toBe(true);
    expect(bundle.stream).toEqual(
      expect.objectContaining({
        streamingMode: 'ping-pong',
        pollDuringJob: 'off',
        rxBufferBytes: 80,
        queuedCount: 3,
      }),
    );
    expect(bundle.evidence.transcriptTail).toHaveLength(MACHINE_DIAGNOSTIC_TRANSCRIPT_LIMIT);
    expect(bundle.evidence.transcriptTail[0]?.id).toBe(6);
    expect(bundle.evidence.outboundCommandKinds).toContain('settings-query');
    expect(bundle.evidence.sampleGcode).toBe('G21\nM4 S0\n');
  });

  it('adds a structured profile suggestion from parsed controller evidence', () => {
    const bundle = createMachineDiagnosticBundle({
      createdAt: '2026-06-16T00:00:00.000Z',
      profile: DEFAULT_DEVICE_PROFILE,
      controllerSettings: {
        maxPowerS: 255,
        minPowerS: 10,
        laserModeEnabled: false,
        bedWidth: 300,
        bedHeight: 200,
        homingEnabled: true,
      },
      grblSettingsRows: settingsMapToRows(
        new Map([
          [22, '1'],
          [30, '255'],
          [31, '10'],
          [32, '0'],
          [130, '300'],
          [131, '200'],
        ]),
      ),
      statusReport: parseStatusReport('<Idle|MPos:1.000,2.000,0.000|FS:0,0>'),
      wcoCache: null,
      workOriginActive: true,
      streamer: null,
      transcript: [
        {
          id: 1,
          at: 1,
          direction: 'in',
          raw: '[VER:1.1h.20190825:]',
          kind: 'message',
          source: 'controller',
        },
        {
          id: 2,
          at: 2,
          direction: 'in',
          raw: '[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]',
          kind: 'message',
          source: 'controller',
        },
      ],
    }) as {
      readonly profileSuggestion?: {
        readonly confidence: string;
        readonly patch: Record<string, unknown>;
        readonly blockers: ReadonlyArray<{ readonly code: string }>;
        readonly warnings: ReadonlyArray<{ readonly code: string }>;
        readonly evidence: {
          readonly buildInfo: string | null;
          readonly modalState: string | null;
        };
      };
    };

    expect(bundle.profileSuggestion).toBeDefined();
    expect(bundle.profileSuggestion?.confidence).toBe('high');
    expect(bundle.profileSuggestion?.patch).toMatchObject({
      maxPowerS: 255,
      minPowerS: 10,
      laserModeEnabled: false,
      bedWidth: 300,
      bedHeight: 200,
      homing: { enabled: true, direction: 'front-left' },
    });
    expect(bundle.profileSuggestion?.blockers.map((blocker) => blocker.code)).toEqual([
      'max-power-mismatch',
      'laser-mode-disabled',
      'bed-size-mismatch',
      'work-offset-unknown',
    ]);
    expect(bundle.profileSuggestion?.warnings.map((warning) => warning.code)).toContain(
      'min-power-nonzero',
    );
    expect(bundle.profileSuggestion?.evidence).toMatchObject({
      buildInfo: '[VER:1.1h.20190825:]',
      modalState: '[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]',
    });
  });
});

function transcriptEntry(id: number): SerialTranscriptEntry {
  return {
    id,
    at: id,
    direction: id % 2 === 0 ? 'out' : 'in',
    raw: id % 2 === 0 ? '$$\n' : 'ok',
    kind: id % 2 === 0 ? 'settings-query' : 'ok',
    source: id % 2 === 0 ? 'console' : 'controller',
  };
}
