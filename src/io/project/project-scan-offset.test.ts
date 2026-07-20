import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  PROJECT_SCHEMA_VERSION,
  type SceneObject,
} from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

describe('project scan-offset IO', () => {
  it('back-fills missing scan-offset table on old .lf2 files', () => {
    const oldShape = JSON.stringify({
      schemaVersion: PROJECT_SCHEMA_VERSION,
      device: {
        name: 'Old Profile',
        bedWidth: 300,
        bedHeight: 300,
        maxFeed: 3000,
        maxPowerS: 1000,
        origin: 'front-left',
        homing: { enabled: false, direction: 'front-left' },
        autofocusCommand: '',
      },
      workspace: { width: 300, height: 300, units: 'mm' },
      scene: { objects: [], layers: [] },
    });

    const result = deserializeProject(oldShape);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.project.device.scanningOffsets).toEqual([]);
    }
  });

  it('sorts a valid scan-offset table by speed on load', () => {
    const project = createProject();
    const text = serializeProject({
      ...project,
      device: {
        ...project.device,
        scanningOffsets: [
          { speedMmPerMin: 6000, offsetMm: 0.12 },
          { speedMmPerMin: 3000, offsetMm: 0.05 },
        ],
      },
    });

    const result = deserializeProject(text);

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.project.device.scanningOffsets).toEqual([
        { speedMmPerMin: 3000, offsetMm: 0.05 },
        { speedMmPerMin: 6000, offsetMm: 0.12 },
      ]);
    }
  });

  it('roundtrips the persisted pending calibration lifecycle', () => {
    const project = createProject();
    const result = deserializeProject(
      serializeProject({
        ...project,
        device: {
          ...project.device,
          scanningOffsets: [{ speedMmPerMin: 3000, offsetMm: 0.05 }],
          scanOffsetCalibrationStatus: 'pending',
        },
      }),
    );

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.project.device.scanOffsetCalibrationStatus).toBe('pending');
    }
  });

  it('roundtrips the calibration coupon mode used by direction policy', () => {
    const project = createProject();
    const layer = {
      ...createLayer({ id: 'calibration', color: '#330000', mode: 'fill' }),
      scanOffsetCalibrationMode: 'baseline' as const,
    };
    const result = deserializeProject(
      serializeProject({ ...project, scene: { ...project.scene, layers: [layer] } }),
    );

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.project.scene.layers[0]?.scanOffsetCalibrationMode).toBe('baseline');
    }
  });

  it('keeps a legacy nonempty table without inventing a lifecycle field', () => {
    const project = createProject();
    const result = deserializeProject(
      JSON.stringify({
        ...project,
        device: {
          ...project.device,
          scanningOffsets: [{ speedMmPerMin: 3000, offsetMm: 0.05 }],
        },
      }),
    );

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.project.device.scanOffsetCalibrationStatus).toBeUndefined();
    }
  });

  it('reports invalid for malformed scan-offset tables', () => {
    const project = createProject();
    const text = JSON.stringify({
      ...project,
      device: {
        ...project.device,
        scanningOffsets: [{ speedMmPerMin: 0, offsetMm: '0.12' }],
      },
    });

    const result = deserializeProject(text);

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/device\.scanningOffsets/);
    }
  });

  it('reports invalid for duplicate scan-offset speeds', () => {
    const project = createProject();
    const text = JSON.stringify({
      ...project,
      device: {
        ...project.device,
        scanningOffsets: [
          { speedMmPerMin: 6000, offsetMm: 0.12 },
          { speedMmPerMin: 6000, offsetMm: 0.2 },
        ],
      },
    });

    const result = deserializeProject(text);

    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toMatch(/device\.scanningOffsets/);
    }
  });

  it('rejects physically impossible scan offsets and status without a table', () => {
    const project = createProject();
    const huge = deserializeProject(
      JSON.stringify({
        ...project,
        device: {
          ...project.device,
          scanningOffsets: [{ speedMmPerMin: 3000, offsetMm: 1e308 }],
        },
      }),
    );
    const orphanStatus = deserializeProject(
      JSON.stringify({
        ...project,
        device: {
          ...project.device,
          scanningOffsets: [],
          scanOffsetCalibrationStatus: 'pending',
        },
      }),
    );

    expect(huge.kind).toBe('invalid');
    if (huge.kind === 'invalid') expect(huge.reason).toMatch(/device\.scanningOffsets/);
    expect(orphanStatus.kind).toBe('invalid');
    if (orphanStatus.kind === 'invalid') {
      expect(orphanStatus.reason).toMatch(/device\.scanOffsetCalibrationStatus/);
    }
  });

  it('roundtrips finite out-of-policy layer and object offsets for Job Review', () => {
    const project = createProject();
    const layerResult = deserializeProject(
      serializeProject({
        ...project,
        scene: {
          ...project.scene,
          layers: [
            {
              ...createLayer({ id: 'fill', color: '#ff0000', mode: 'fill' }),
              bidirectionalScanOffsetMm: 4.01,
            },
          ],
        },
      }),
    );
    const objectResult = deserializeProject(
      serializeProject({
        ...project,
        scene: { ...project.scene, objects: [objectWithScanOffset(4.01)] },
      }),
    );

    expect(layerResult.kind).toBe('ok');
    if (layerResult.kind === 'ok') {
      expect(layerResult.project.scene.layers[0]?.bidirectionalScanOffsetMm).toBe(4.01);
    }
    expect(objectResult.kind).toBe('ok');
    if (objectResult.kind === 'ok') {
      expect(
        objectResult.project.scene.objects[0]?.operationOverride?.bidirectionalScanOffsetMm,
      ).toBe(4.01);
    }
  });
});

function objectWithScanOffset(bidirectionalScanOffsetMm: number): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'offset-object',
    source: 'offset.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    operationOverride: { bidirectionalScanOffsetMm },
    paths: [],
  };
}
