import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import { createProject } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

describe('project device profile metadata persistence', () => {
  it('roundtrips optional Neotronics profile metadata without requiring older projects to have it', () => {
    const project = createProject(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);
    const result = deserializeProject(serializeProject(project));

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.device.machineFamily).toBe('neotronics-4040-max');
    expect(result.project.device.gcodeDialect.dialectId).toBe('neotronics-4040-safe');
    expect(result.project.device.zTravelConfirmed).toBe(false);
    expect(result.project.device.laserSubProfile?.model).toBe('LASER TREE LT-4LDS-V2');
    expect(result.project.device.laserSubProfile?.technology).toBe('diode');
    expect(result.project.device.laserSubProfile?.metadataConfidence).toBe('researched');
    expect(result.project.device.laserSubProfile?.wavelengthNm).toBe(455);
  });

  it('backfills old projects without a gcode dialect to the default dynamic GRBL dialect', () => {
    const raw = JSON.parse(serializeProject(createProject()));
    delete raw.device.gcodeDialect;

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.device.gcodeDialect).toEqual({ dialectId: 'grbl-dynamic' });
  });

  it('roundtrips profile streaming settings used by the GRBL streamer', () => {
    const project = createProject({
      ...DEFAULT_DEVICE_PROFILE,
      streamingMode: 'ping-pong',
      rxBufferBytes: 96,
    });

    const result = deserializeProject(serializeProject(project));

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.device.streamingMode).toBe('ping-pong');
    expect(result.project.device.rxBufferBytes).toBe(96);
  });

  it('roundtrips independent preview timing calibration factors', () => {
    const project = createProject({
      ...DEFAULT_DEVICE_PROFILE,
      estimateCutTimeScale: 1.18,
      estimateTravelTimeScale: 1.07,
    });

    const result = deserializeProject(serializeProject(project));

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.device.estimateCutTimeScale).toBe(1.18);
    expect(result.project.device.estimateTravelTimeScale).toBe(1.07);
  });

  it('rejects malformed preview timing calibration factors', () => {
    const raw = JSON.parse(serializeProject(createProject()));
    raw.device.estimateCutTimeScale = 0;
    raw.device.estimateTravelTimeScale = 'slow';

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.reason).toMatch(/estimateCutTimeScale|estimateTravelTimeScale/);
  });

  it('backfills old projects without profile streaming settings to safe defaults', () => {
    const raw = JSON.parse(serializeProject(createProject()));
    delete raw.device.streamingMode;
    delete raw.device.rxBufferBytes;

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.device.streamingMode).toBe(DEFAULT_DEVICE_PROFILE.streamingMode);
    expect(result.project.device.rxBufferBytes).toBe(DEFAULT_DEVICE_PROFILE.rxBufferBytes);
  });

  it('rejects malformed loaded profile streaming settings', () => {
    const raw = JSON.parse(serializeProject(createProject()));
    raw.device.streamingMode = 'blast';
    raw.device.rxBufferBytes = 0;

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.reason).toMatch(/device\.streamingMode|device\.rxBufferBytes/);
  });

  it('rejects unknown loaded device capabilities', () => {
    const raw = JSON.parse(serializeProject(createProject()));
    raw.device.capabilities = ['grbl', 'macro-runner'];

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.reason).toMatch(/device\.capabilities/);
  });

  it('replaces legacy Neotronics 4040 frame feed with the safer built-in feed', () => {
    const raw = JSON.parse(serializeProject(createProject(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE)));
    raw.device.framingFeedMmPerMin = 6000;

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.device.framingFeedMmPerMin).toBe(
      NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE.framingFeedMmPerMin,
    );
  });

  it('clears stale Z travel confirmation when loaded profile has no positive Z travel', () => {
    const raw = JSON.parse(serializeProject(createProject()));
    raw.device.capabilities = ['grbl', 'z-axis'];
    raw.device.zTravelConfirmed = true;
    delete raw.device.zTravelMm;

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.device.zTravelConfirmed).toBe(false);
  });

  it('clears stale Z travel confirmation when loaded profile has no powered Z capability', () => {
    const raw = JSON.parse(serializeProject(createProject()));
    raw.device.capabilities = ['grbl'];
    raw.device.zTravelMm = 75;
    raw.device.zTravelConfirmed = true;

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.device.zTravelMm).toBe(75);
    expect(result.project.device.zTravelConfirmed).toBe(false);
  });

  it('rejects malformed loaded Z travel metadata', () => {
    const raw = JSON.parse(serializeProject(createProject()));
    raw.device.zTravelMm = -5;
    raw.device.zTravelConfirmed = 'yes';

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.reason).toMatch(/device\.zTravelMm|device\.zTravelConfirmed/);
  });

  it('rejects malformed loaded laser-head metadata', () => {
    const raw = JSON.parse(serializeProject(createProject(NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE)));
    raw.device.laserSubProfile.technology = 'plasma';

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') return;
    expect(result.reason).toMatch(/device\.laserSubProfile/);
  });
});
