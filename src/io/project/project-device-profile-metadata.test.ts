import { describe, expect, it } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
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
  });

  it('backfills old projects without a gcode dialect to the default dynamic GRBL dialect', () => {
    const raw = JSON.parse(serializeProject(createProject()));
    delete raw.device.gcodeDialect;

    const result = deserializeProject(JSON.stringify(raw));

    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.device.gcodeDialect).toEqual({ dialectId: 'grbl-dynamic' });
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
});
