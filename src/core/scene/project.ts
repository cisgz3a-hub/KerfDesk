// Project — the persistence root that .lf2 files serialize. Bundles the
// device profile, workspace dimensions, and the scene. Pure; never mutated.

import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import type { CncMachineConfig, MachineConfig } from './machine';
import { EMPTY_SCENE, type Scene } from './scene';
import type { ProjectVariableData } from './variable-template';
import type { PrintAndCutDesignTargets } from './print-and-cut';

// v9 preserves owned image clips. Older readers would engrave the full source
// bitmap if allowed to silently ignore its clip geometry.
// v10 adds perforation and overcut (ADR-415). An older reader would ignore them
// and cut straight through a perforated line.
// v11 introduced independent CNC stage recipes (ADR-457); a parallel v11 build
// introduced path text alignment (ADR-480). v12 preserves both contracts so
// neither older reader can silently drop motion settings or text placement.
export const PROJECT_SCHEMA_VERSION = 12 as const;

export type EmbeddedFont = {
  readonly key: string;
  readonly fileName: string;
  readonly dataBase64: string;
};

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
  /** Opt-in removal of coincident laser Line spans within each operation. */
  readonly removeOverlappingLines: boolean;
  /**
   * How far apart two near-parallel Line spans may lie and still be cut once
   * when removeOverlappingLines is on (LBG-C13), mm, 0 to 0.5. Absent or 0
   * merges only spans that coincide at emitted precision, as before. No schema
   * bump: an older reader ignores the field and cuts near-coincident spans
   * twice, which is what every earlier build did.
   */
  readonly overlapMergeToleranceMm?: number;
  readonly layerPriority: 'project-order' | 'reverse-project-order';
  readonly pathDirection: 'allow-reverse' | 'preserve';
  readonly startPoint: 'machine-origin' | 'job-lower-left' | 'job-center';
  /** Opt-in physical region for Line contour entry; absent keeps the planner. */
  readonly lineStartRegion?: LineStartRegion | undefined;
  /**
   * Where each closed laser shape starts and stops (LBG-C04): where it was
   * drawn, at the vertex nearest the head, or at the nearest corner so the
   * start/stop mark lands on one. No schema bump: an older reader ignores the
   * field and starts closed shapes where drawn, which cuts the same outline.
   */
  readonly closedShapeStart: 'drawn' | 'nearest' | 'nearest-corner';
};

export type ProjectJobPlacement = {
  readonly startFrom: 'absolute' | 'current-position' | 'user-origin' | 'verified-origin';
  readonly anchor:
    | 'front-left'
    | 'front-center'
    | 'front-right'
    | 'center-left'
    | 'center'
    | 'center-right'
    | 'back-left'
    | 'back-center'
    | 'back-right';
};

export type LineStartRegion = ProjectJobPlacement['anchor'];

export const LINE_START_REGIONS: ReadonlyArray<LineStartRegion> = [
  'back-left',
  'back-center',
  'back-right',
  'center-left',
  'center',
  'center-right',
  'front-left',
  'front-center',
  'front-right',
];

export function isLineStartRegion(value: unknown): value is LineStartRegion {
  return LINE_START_REGIONS.some((region) => region === value);
}

/**
 * ADR-496: the material this laser job runs on. With `autoApplyRecipes` on,
 * each new laser operation takes the active library's best recipe for it.
 */
export type ProjectLaserMaterial = {
  readonly name: string;
  readonly thicknessMm?: number;
  readonly autoApplyRecipes: boolean;
};

export type ProjectJobSetup = {
  // The active mode's placement. The other mode's waits in `parkedPlacement`
  // and the two change places on every Laser/CNC switch (ADR-416).
  readonly placement: ProjectJobPlacement;
  readonly parkedPlacement?: ProjectJobPlacement;
  readonly outputScope: {
    readonly cutSelectedGraphics: boolean;
    readonly useSelectionOrigin: boolean;
    readonly selectedObjectIds: ReadonlyArray<string>;
  };
  readonly laserMaterial?: ProjectLaserMaterial;
};

/**
 * The merge tolerance's range (LBG-C13). 0 is the exact rule; half a millimetre
 * is already wider than a laser kerf, beyond which merging would move edges by
 * more than the beam covers.
 */
export const OVERLAP_MERGE_TOLERANCE_RANGE_MM = { min: 0, max: 0.5 } as const;

/** A merge tolerance inside its range; anything but a finite number is 0. */
export function clampOverlapMergeTolerance(value: number): number {
  if (!Number.isFinite(value)) return OVERLAP_MERGE_TOLERANCE_RANGE_MM.min;
  return Math.min(
    OVERLAP_MERGE_TOLERANCE_RANGE_MM.max,
    Math.max(OVERLAP_MERGE_TOLERANCE_RANGE_MM.min, value),
  );
}

export const DEFAULT_PROJECT_OPTIMIZATION: ProjectOptimizationSettings = {
  reduceTravelMoves: true,
  travelPolicy: 'nearest-neighbor',
  insideFirst: true,
  removeOverlappingLines: false,
  layerPriority: 'project-order',
  pathDirection: 'allow-reverse',
  startPoint: 'machine-origin',
  closedShapeStart: 'drawn',
};

export type Project = {
  readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  readonly device: DeviceProfile;
  readonly workspace: Workspace;
  readonly optimization: ProjectOptimizationSettings;
  readonly jobSetup: ProjectJobSetup;
  readonly variables?: ProjectVariableData;
  readonly printAndCutTargets?: PrintAndCutDesignTargets;
  readonly embeddedFonts?: ReadonlyArray<EmbeddedFont>;
  readonly notes: string;
  // Absent on laser projects saved before CNC support — treated as laser.
  readonly machine?: MachineConfig;
  // The CNC setup (stock, bits, params, tiling) kept while the project is in
  // Laser mode, so saving a laser job does not throw the router setup away.
  // Never present while `machine` is CNC.
  readonly parkedCncMachine?: CncMachineConfig;
  readonly scene: Scene;
};

export function createProject(device: DeviceProfile = DEFAULT_DEVICE_PROFILE): Project {
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    device,
    workspace: { width: device.bedWidth, height: device.bedHeight, units: 'mm' },
    optimization: DEFAULT_PROJECT_OPTIMIZATION,
    jobSetup: {
      placement: {
        startFrom: device.homing.enabled ? 'absolute' : 'user-origin',
        anchor: 'front-left',
      },
      outputScope: {
        cutSelectedGraphics: false,
        useSelectionOrigin: false,
        selectedObjectIds: [],
      },
    },
    notes: '',
    scene: EMPTY_SCENE,
  };
}
