// Project — the persistence root that .lf2 files serialize. Bundles the
// device profile, workspace dimensions, and the scene. Pure; never mutated.

import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import type { MachineConfig } from './machine';
import { EMPTY_SCENE, type Scene } from './scene';
import type { ProjectVariableData } from './variable-template';
import type { PrintAndCutDesignTargets } from './print-and-cut';

export const PROJECT_SCHEMA_VERSION = 2 as const;

export type Workspace = {
  readonly width: number; // mm
  readonly height: number; // mm
  readonly units: 'mm'; // internal model is mm (PROJECT.md non-negotiable #6)
};

export type ProjectOptimizationSettings = {
  /** Legacy compatibility field, kept synchronized with travelPolicy. */
  readonly reduceTravelMoves: boolean;
  readonly travelPolicy: 'nearest-neighbor' | 'source-order';
  readonly insideFirst: boolean;
  readonly layerPriority: 'project-order' | 'reverse-project-order';
  readonly pathDirection: 'allow-reverse' | 'preserve';
  readonly startPoint: 'machine-origin' | 'job-lower-left' | 'job-center';
};

export const DEFAULT_PROJECT_OPTIMIZATION: ProjectOptimizationSettings = {
  reduceTravelMoves: true,
  travelPolicy: 'nearest-neighbor',
  insideFirst: true,
  layerPriority: 'project-order',
  pathDirection: 'allow-reverse',
  startPoint: 'machine-origin',
};

export type Project = {
  readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  readonly device: DeviceProfile;
  readonly workspace: Workspace;
  readonly optimization: ProjectOptimizationSettings;
  readonly variables?: ProjectVariableData;
  readonly printAndCutTargets?: PrintAndCutDesignTargets;
  readonly notes: string;
  // Absent on laser projects saved before CNC support — treated as laser.
  readonly machine?: MachineConfig;
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
