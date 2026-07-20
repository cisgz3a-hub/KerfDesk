import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import type { LaserState } from '../laser-store';
import {
  createExecutionProvenance,
  isExecutionProvenance,
  type ExecutionProvenanceV2,
} from './execution-provenance';
import { ordinaryExecutionEvidence } from './execution-workflow-evidence';

const NOW = '2026-07-19T03:00:00.000Z';
const MAX_RAW_LINES = 256;
const MAX_SETTINGS_ROWS = 2_048;

describe('execution provenance deep validation', () => {
  it('accepts current schema and compatible legacy schema provenance', async () => {
    const current = await validProvenance();
    const {
      workflow: _workflow,
      envelopeSha256: _envelopeSha256,
      archivedControllerObservationSha256: _observationSha256,
      ...withoutWorkflow
    } = current;
    const legacy = { ...withoutWorkflow, schemaVersion: 1 };

    expect(isExecutionProvenance(current)).toBe(true);
    expect(isExecutionProvenance(legacy)).toBe(true);
    expect(isExecutionProvenance({ ...current, schemaVersion: 1 })).toBe(false);
    expect(
      isExecutionProvenance(
        replaceAtPath(current, ['transport', 'serialPortInfo', 'usbVendorId'], 65_535),
      ),
    ).toBe(true);
  });

  it('rejects malformed discriminants, numbers, nested evidence, and oversized diagnostics', async () => {
    const current = await validProvenance();
    const cases: ReadonlyArray<readonly [string, ReadonlyArray<string>, unknown]> = [
      ['empty build identity', ['build', 'appName'], ''],
      ['oversized build identity', ['build', 'gitSha'], 'x'.repeat(16_385)],
      ['missing V2 envelope hash', ['envelopeSha256'], undefined],
      ['malformed V2 envelope hash', ['envelopeSha256'], 'sha256:not-a-hash'],
      [
        'malformed controller-observation hash',
        ['archivedControllerObservationSha256'],
        'sha256:not-a-hash',
      ],
      ['malformed content hash', ['content', 'gcodeSha256'], 'sha256:not-a-hash'],
      ['negative byte count', ['content', 'gcodeUtf8Bytes'], -1],
      ['unknown transport', ['transport', 'kind'], 'bluetooth'],
      ['negative USB ID', ['transport', 'serialPortInfo', 'usbVendorId'], -1],
      ['oversized USB ID', ['transport', 'serialPortInfo', 'usbProductId'], 65_536],
      ['fractional USB ID', ['transport', 'serialPortInfo', 'usbProductId'], 1.5],
      ['unknown controller kind', ['controller', 'activeKind'], 'mystery-controller'],
      ['non-finite session epoch', ['controller', 'sessionEpoch'], Number.NaN],
      ['qualification epoch drift', ['controller', 'qualification', 'epoch'], 8],
      ['unknown qualification phase', ['controller', 'qualification', 'kind'], 'unknown'],
      [
        'build observation epoch drift',
        ['controller', 'buildInfo', 'observation', 'sessionEpoch'],
        8,
      ],
      ['duplicate GRBL option', ['controller', 'buildInfo', 'parsed', 'optionCodes'], ['V', 'V']],
      [
        'out-of-order GRBL options',
        ['controller', 'buildInfo', 'parsed', 'optionCodes'],
        ['N', 'V'],
      ],
      ['zero GRBL planner buffer', ['controller', 'buildInfo', 'parsed', 'plannerBufferBlocks'], 0],
      ['zero GRBL RX buffer', ['controller', 'buildInfo', 'parsed', 'rxBufferBytes'], 0],
      [
        'too many build-info lines',
        ['controller', 'buildInfo', 'rawLines'],
        Array.from({ length: MAX_RAW_LINES + 1 }, () => '[VER:test]'),
      ],
      ['oversized build-info line', ['controller', 'buildInfo', 'rawLines'], ['x'.repeat(4_097)]],
      ['malformed settings code', ['controller', 'settingsRows'], [{ code: '$-1', rawValue: '1' }]],
      [
        'too many settings rows',
        ['controller', 'settingsRows'],
        Array.from({ length: MAX_SETTINGS_ROWS + 1 }, () => ({ code: '$32', rawValue: '1' })),
      ],
      ['invalid review timestamp', ['review', 'reviewedAtIso'], 'not-a-date'],
      [
        'too many review warnings',
        ['review', 'warningsShown'],
        Array.from({ length: MAX_RAW_LINES + 1 }, () => 'warning'),
      ],
      ['sparse review warnings', ['review', 'warningsShown'], new Array<string>(1)],
      ['oversized review warning', ['review', 'warningsShown'], ['x'.repeat(4_097)]],
      ['unknown acknowledgement', ['review', 'acknowledgement', 'kind'], 'approved'],
      [
        'laser evidence epoch drift',
        ['review', 'laserModeStartEvidence', 'controllerSessionEpoch'],
        8,
      ],
      [
        'laser settings observation drift',
        ['review', 'laserModeStartEvidence', 'settingsObservation', 'observedAt'],
        2,
      ],
      [
        'laser build identity drift',
        ['review', 'laserModeStartEvidence', 'controllerBuildInfo', 'userInfo'],
        'foreign build',
      ],
      ['malformed laser evidence', ['review', 'laserModeStartEvidence', 'm7Required'], 'false'],
      ['unknown workflow', ['workflow', 'kind'], 'manual-line-resume'],
      ['empty replay source', ['workflow', 'completedReplaySourceRunId'], ''],
    ];

    for (const [label, path, value] of cases) {
      expect(isExecutionProvenance(replaceAtPath(current, path, value)), label).toBe(false);
    }
  });

  it('rejects internally inconsistent workflow and operator-review lineage', async () => {
    const current = await validProvenance();
    const recoveryWorkflow = {
      kind: 'laser-recovery',
      sourceRunId: 'run-source',
      sourceRevision: 2,
      sourceAckedLines: 10,
      requestedFromLine: 11,
      effectiveFromLine: 11,
    };

    expect(isExecutionProvenance(replaceAtPath(current, ['workflow'], recoveryWorkflow))).toBe(
      false,
    );
  });
});

async function validProvenance(): Promise<ExecutionProvenanceV2> {
  const buildInfo = {
    protocolVersion: '1.1h',
    buildRevision: '20190830',
    userInfo: '',
    optionCodes: ['V', 'N', 'M'] as const,
    plannerBufferBlocks: 15,
    rxBufferBytes: 128,
  };
  const observation = { sessionEpoch: 7, observedAt: 1 };
  const laser = {
    capabilities: { transport: 'serial' },
    serialPortInfo: { usbVendorId: 0, usbProductId: 0x7523 },
    controllerSessionEpoch: 7,
    activeControllerKind: 'grbl-v1.1',
    detectedControllerKind: 'grbl-v1.1',
    controllerQualification: { kind: 'qualified', epoch: 7, settings: 'verified' },
    controllerBuildInfo: buildInfo,
    controllerBuildInfoRawLines: ['[VER:1.1h.20190830:]', '[OPT:VNM,15,128]'],
    controllerBuildInfoObservation: observation,
    controllerSettingsObservation: observation,
    grblSettingsRows: [{ code: '$32', rawValue: '1' }],
  } as unknown as LaserState;
  return createExecutionProvenance({
    gcode: 'G21\nM5\n',
    profile: DEFAULT_DEVICE_PROFILE,
    laser,
    archivedControllerObservation: {
      settings: { laserModeEnabled: true },
      observedAtIso: NOW,
      wco: { x: 1, y: 2, z: 3 },
    },
    ...ordinaryExecutionEvidence({
      reviewedAtIso: NOW,
      warningsShown: [],
      acknowledgement: { kind: 'laser-verified' },
      laserModeStartEvidence: {
        controllerSessionEpoch: 7,
        settingsCapability: 'grbl-dollar',
        settingsObservation: observation,
        laserModeEnabled: true,
        maxPowerS: DEFAULT_DEVICE_PROFILE.maxPowerS,
        controllerBuildInfo: buildInfo,
        buildInfoObservation: observation,
        expectedMaxPowerS: DEFAULT_DEVICE_PROFILE.maxPowerS,
        m7Required: false,
        unverifiedAcknowledged: false,
      },
    }),
  });
}

function replaceAtPath(
  provenance: ExecutionProvenanceV2,
  path: ReadonlyArray<string>,
  value: unknown,
): unknown {
  const clone: unknown = structuredClone(provenance);
  let cursor = clone;
  for (const key of path.slice(0, -1)) {
    if (!isRecord(cursor)) throw new Error(`Invalid test path at ${key}.`);
    cursor = cursor[key];
  }
  const finalKey = path.at(-1);
  if (!isRecord(cursor) || finalKey === undefined) throw new Error('Invalid test path.');
  cursor[finalKey] = value;
  return clone;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
