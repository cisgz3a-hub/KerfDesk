// .lf2 round-trip for the saved camera model (ADR-440): a saved calibration
// must survive save/reload, a malformed one must be DROPPED (never trusted),
// the checkerboard calibration and four-corner alignment of older projects
// are left behind, and an absent model stays absent (no phantom field).

import { describe, expect, it } from 'vitest';
import { savedCameraModel } from '../../core/camera/model/model-fixtures';
import { createProject, type Project } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

function projectWithModel(): Project {
  const base = createProject();
  return { ...base, device: { ...base.device, cameraModel: savedCameraModel() } };
}

function reloadWithDevice(patch: Record<string, unknown>) {
  const raw = JSON.parse(serializeProject(projectWithModel())) as Record<string, unknown>;
  raw.device = { ...(raw.device as Record<string, unknown>), ...patch };
  return deserializeProject(JSON.stringify(raw));
}

describe('project camera model persistence', () => {
  it('round-trips a saved camera model', () => {
    const result = deserializeProject(serializeProject(projectWithModel()));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.device.cameraModel).toEqual(savedCameraModel());
  });

  it('drops a malformed persisted model instead of trusting it', () => {
    const result = reloadWithDevice({
      cameraModel: { ...savedCameraModel(), pose: { rvec: [1] } },
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.device.cameraModel).toBeUndefined();
  });

  it('leaves the old lens calibration and bed alignment behind', () => {
    const result = reloadWithDevice({
      cameraCalibration: { imageWidth: 1280, imageHeight: 720 },
      cameraAlignment: { homography: [1, 0, 0, 0, 1, 0, 0, 0, 1], basis: 'raw' },
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.device).not.toHaveProperty('cameraCalibration');
    expect(result.project.device).not.toHaveProperty('cameraAlignment');
    expect(result.project.device.cameraModel).toEqual(savedCameraModel());
  });

  it('stays absent for projects that were never calibrated', () => {
    const result = deserializeProject(serializeProject(createProject()));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.device.cameraModel).toBeUndefined();
  });
});
