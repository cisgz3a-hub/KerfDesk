// .lf2 round-trip for the persisted camera alignment (ADR-105): a saved
// alignment must survive save/reload, a malformed one must be DROPPED (never
// trusted), and its absence stays absent (no phantom field).

import { describe, expect, it } from 'vitest';
import type { CameraAlignment } from '../../core/camera';
import { createProject, type Project } from '../../core/scene';
import { deserializeProject } from './deserialize-project';
import { serializeProject } from './serialize-project';

const ALIGNMENT: CameraAlignment = {
  homography: [0.25, 0.01, 12, -0.02, 0.24, 8, 0.0001, 0, 1],
  frameWidth: 1920,
  frameHeight: 1080,
  basis: 'raw',
  alignedAt: 1_750_000_000_000,
};

function projectWithAlignment(): Project {
  const base = createProject();
  return { ...base, device: { ...base.device, cameraAlignment: ALIGNMENT } };
}

describe('project camera alignment persistence', () => {
  it('round-trips a saved alignment', () => {
    const result = deserializeProject(serializeProject(projectWithAlignment()));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.device.cameraAlignment).toEqual(ALIGNMENT);
  });

  it('drops a malformed persisted alignment instead of trusting it', () => {
    const raw = JSON.parse(serializeProject(projectWithAlignment())) as Record<string, unknown>;
    (raw.device as Record<string, unknown>).cameraAlignment = {
      ...ALIGNMENT,
      homography: [1, 2, 3],
    };
    const result = deserializeProject(JSON.stringify(raw));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.device.cameraAlignment).toBeUndefined();
  });

  it('stays absent for projects that never aligned', () => {
    const result = deserializeProject(serializeProject(createProject()));
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.project.device.cameraAlignment).toBeUndefined();
  });
});
