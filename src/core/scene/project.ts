// Project — the persistence root that .lf2 files serialize. Bundles the
// device profile, workspace dimensions, and the scene. Pure; never mutated.

import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import { EMPTY_SCENE, type Scene } from './scene';

export const PROJECT_SCHEMA_VERSION = 1 as const;

export type Workspace = {
  readonly width: number; // mm
  readonly height: number; // mm
  readonly units: 'mm'; // internal model is mm (PROJECT.md non-negotiable #6)
};

export type ProjectOptimizationSettings = {
  readonly reduceTravelMoves: boolean;
};

export const DEFAULT_PROJECT_OPTIMIZATION: ProjectOptimizationSettings = {
  reduceTravelMoves: true,
};

export type Project = {
  readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  readonly device: DeviceProfile;
  readonly workspace: Workspace;
  readonly optimization: ProjectOptimizationSettings;
  readonly notes: string;
  readonly scene: Scene;
};

export function createProject(device: DeviceProfile = DEFAULT_DEVICE_PROFILE): Project {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    device,
    workspace: { width: device.bedWidth, height: device.bedHeight, units: 'mm' },
    optimization: DEFAULT_PROJECT_OPTIMIZATION,
    notes: '',
    scene: EMPTY_SCENE,
  };
}
