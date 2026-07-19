import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import type { RasterGroup } from '../../core/job';
import { DEFAULT_OUTPUT_SCOPE, createProject } from '../../core/scene';
import type { PreparedOutput } from '../../io/gcode';
import type { CanvasMotionPlan } from '../state/canvas-motion-plan';
import type { LaserState } from '../state/laser-store';
import {
  createArchivedControllerObservation,
  createExecutionArtifact,
} from '../state/recovery/execution-artifact';
import { createExecutionProvenance } from '../state/recovery/execution-provenance';
import { ordinaryExecutionEvidence } from '../state/recovery/execution-workflow-evidence';
import {
  computeExecutionArtifactExportEnvelopeSha256,
  decodeExecutionArtifactExport,
  EXECUTION_ARTIFACT_EXPORT_ENCODING,
  EXECUTION_ARTIFACT_EXPORT_FORMAT,
  serializeExecutionArtifactExport,
} from './execution-artifact-export-codec';

describe('execution artifact export codec', () => {
  it('round-trips typed-array payloads through a versioned digested envelope', async () => {
    const source = new Uint16Array([65_000, 100, 0, 65_000]);
    const artifact = await rasterArtifact(source.subarray(1, 3));

    const serialized = await serializeExecutionArtifactExport(artifact);
    const envelope = JSON.parse(serialized) as Record<string, unknown>;
    expect(envelope).toMatchObject({
      format: EXECUTION_ARTIFACT_EXPORT_FORMAT,
      schemaVersion: 1,
      encoding: EXECUTION_ARTIFACT_EXPORT_ENCODING,
      envelopeSha256: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });

    const decoded = await decodeExecutionArtifactExport(serialized);
    const raster = decoded.prepared.job.groups[0];
    expect(raster?.kind).toBe('raster');
    if (raster?.kind !== 'raster') throw new Error('Expected decoded raster.');
    expect(raster.sValues).toBeInstanceOf(Uint16Array);
    expect(raster.sValues).toEqual(new Uint16Array([100, 0]));
    expect(decoded.gcode).toBe(artifact.gcode);
  });

  it('rejects an export whose encoded artifact changed after sealing', async () => {
    const serialized = await serializeExecutionArtifactExport(
      await rasterArtifact(new Uint16Array([1])),
    );
    const envelope = JSON.parse(serialized) as {
      artifact: { gcode: string };
    };
    envelope.artifact.gcode = 'M3 S1000\n';

    await expect(decodeExecutionArtifactExport(JSON.stringify(envelope))).rejects.toThrow(
      'digest does not match',
    );
  });

  it('rejects invalid provenance even when a changed export envelope is resealed', async () => {
    const serialized = await serializeExecutionArtifactExport(
      await rasterArtifact(new Uint16Array([1])),
    );
    const envelope = JSON.parse(serialized) as {
      format: typeof EXECUTION_ARTIFACT_EXPORT_FORMAT;
      schemaVersion: 1;
      encoding: typeof EXECUTION_ARTIFACT_EXPORT_ENCODING;
      artifact: { provenance: { build: { gitSha: string } } };
      envelopeSha256: `sha256:${string}`;
    };
    envelope.artifact.provenance.build.gitSha = 'forged-build';
    const body = {
      format: envelope.format,
      schemaVersion: envelope.schemaVersion,
      encoding: envelope.encoding,
      artifact: envelope.artifact,
    };
    envelope.envelopeSha256 = await computeExecutionArtifactExportEnvelopeSha256(
      body as Parameters<typeof computeExecutionArtifactExportEnvelopeSha256>[0],
    );

    await expect(decodeExecutionArtifactExport(JSON.stringify(envelope))).rejects.toThrow(
      'provenance integrity check',
    );
  });

  it('rejects a resealed payload relabeled as a provenance-free legacy artifact', async () => {
    const serialized = await serializeExecutionArtifactExport(
      await rasterArtifact(new Uint16Array([1])),
    );
    const envelope = JSON.parse(serialized) as {
      format: typeof EXECUTION_ARTIFACT_EXPORT_FORMAT;
      schemaVersion: 1;
      encoding: typeof EXECUTION_ARTIFACT_EXPORT_ENCODING;
      artifact: {
        schemaVersion: number;
        provenance?: unknown;
        estimatedArtifactBytes?: number;
      };
      envelopeSha256: `sha256:${string}`;
    };
    envelope.artifact.schemaVersion = 1;
    delete envelope.artifact.provenance;
    delete envelope.artifact.estimatedArtifactBytes;
    const body = {
      format: envelope.format,
      schemaVersion: envelope.schemaVersion,
      encoding: envelope.encoding,
      artifact: envelope.artifact,
    };
    envelope.envelopeSha256 = await computeExecutionArtifactExportEnvelopeSha256(
      body as Parameters<typeof computeExecutionArtifactExportEnvelopeSha256>[0],
    );

    await expect(decodeExecutionArtifactExport(JSON.stringify(envelope))).rejects.toThrow(
      'not a valid current exact artifact',
    );
  });
});

async function rasterArtifact(sValues: Uint16Array) {
  const raster: RasterGroup = {
    kind: 'raster',
    layerId: 'export-raster',
    color: '#000000',
    power: 50,
    speed: 1_000,
    passes: 1,
    airAssist: false,
    sValues,
    pixelWidth: sValues.length,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: sValues.length, maxY: 1 },
    overscanMm: 0,
    dotWidthCorrectionMm: 0,
  };
  const project = createProject(DEFAULT_DEVICE_PROFILE);
  const prepared = {
    ok: true,
    project,
    job: { groups: [raster] },
    jobOriginOffset: { x: 0, y: 0 },
  } as Extract<PreparedOutput, { readonly ok: true }>;
  const createdAtIso = '2026-07-19T03:00:00.000Z';
  const archivedControllerObservation = createArchivedControllerObservation({
    controllerSettings: null,
    observedAtIso: createdAtIso,
    controllerObservation: {
      activeControllerKind: 'grbl-v1.1',
      detectedControllerKind: 'grbl-v1.1',
      controllerSessionEpoch: 7,
    },
  });
  const laser = provenanceLaserState();
  const gcode = 'G21\nM5\n';
  const provenance = await createExecutionProvenance({
    gcode,
    profile: project.device,
    laser,
    archivedControllerObservation,
    ...ordinaryExecutionEvidence({
      reviewedAtIso: createdAtIso,
      warningsShown: [],
      acknowledgement: { kind: 'laser-verified' },
      laserModeStartEvidence: laserModeEvidence(),
    }),
  });
  return createExecutionArtifact({
    runId: 'run-export-codec',
    gcode,
    prepared,
    outputScope: DEFAULT_OUTPUT_SCOPE,
    canvasPlan: { retentionKey: 'export-codec-signature' } as CanvasMotionPlan,
    controllerSettings: null,
    archivedControllerObservation,
    createdAtIso,
    provenance,
  });
}

function provenanceLaserState(): LaserState {
  return {
    capabilities: { transport: 'serial' },
    serialPortInfo: { usbVendorId: 0x1a86, usbProductId: 0x7523 },
    controllerSessionEpoch: 7,
    activeControllerKind: 'grbl-v1.1',
    detectedControllerKind: 'grbl-v1.1',
    controllerQualification: { kind: 'qualified', epoch: 7, settings: 'verified' },
    controllerBuildInfo: null,
    controllerBuildInfoRawLines: [],
    controllerBuildInfoObservation: null,
    controllerSettingsObservation: { sessionEpoch: 7, observedAt: 1 },
    grblSettingsRows: [{ code: '$32', rawValue: '1' }],
  } as unknown as LaserState;
}

function laserModeEvidence() {
  return {
    controllerSessionEpoch: 7,
    settingsCapability: 'grbl-dollar' as const,
    settingsObservation: { sessionEpoch: 7, observedAt: 1 },
    laserModeEnabled: true,
    maxPowerS: DEFAULT_DEVICE_PROFILE.maxPowerS,
    controllerBuildInfo: null,
    buildInfoObservation: null,
    expectedMaxPowerS: DEFAULT_DEVICE_PROFILE.maxPowerS,
    m7Required: false,
    unverifiedAcknowledged: false,
  };
}
