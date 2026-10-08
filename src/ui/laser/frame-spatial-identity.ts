import { defaultCncMachiningSetup } from '../../core/scene/cnc-machining-setup';
import {
  LASER_MACHINE_CONFIG,
  DEFAULT_CNC_LAYER_SETTINGS,
  machineKindOf,
  type CncLayerSettings,
  type Layer,
  type LayerOperationSettings,
  type Project,
  type SceneObject,
} from '../../core/scene';
import type { ObjectOperationSettingsOverride } from '../../core/scene/scene-object';
import type { CncStageRecipe } from '../../core/scene/cnc-stage-recipe';
import type { CncTwoSidedSetup } from '../../core/scene/cnc-two-sided-setup';
import type { Scene } from '../../core/scene/scene';
import { reliefAuthoringLinkIds } from '../../core/relief/relief-authoring-link-ids';
import type { DeviceProfile } from '../../core/devices';
import { currentOutputScope, useStore } from '../state';
import { canvasPlanRetentionKey } from '../state/canvas-motion-plan';
import { currentPrintCutOutputRegistration } from './print-cut-output';

const spatialProjects = new WeakMap<Project, Project>();

/** Authored coordinates and output bindings, separate from the exact execution
 * key. Newly prepared motion bounds still qualify every Start: feed-dependent
 * scan offsets/runways cannot hide behind this process-input projection. */
export function currentFrameSpatialSignature(
  app: ReturnType<typeof useStore.getState> = useStore.getState(),
): string {
  return canvasPlanRetentionKey(
    spatialProject(app.project),
    currentOutputScope(app),
    app.jobPlacement,
    currentPrintCutOutputRegistration(app.project),
  );
}

function spatialProject(project: Project): Project {
  const cached = spatialProjects.get(project);
  if (cached !== undefined) return cached;
  const isCnc = machineKindOf(project.machine) === 'cnc';
  const { cncSetup: setup, ...base } = project;
  const scene = spatialCncSideScene(project);
  const projected = {
    ...base,
    ...(isCnc && setup?.twoSided !== undefined
      ? {
          cncSetup: {
            ...defaultCncMachiningSetup(),
            twoSided: spatialCncSideSetup(setup.twoSided),
          },
        }
      : {}),
    machine: project.machine ?? LASER_MACHINE_CONFIG,
    device: spatialDevice(project.device),
    scene: {
      ...scene,
      layers: scene.layers.map((layer) => spatialLayer(layer, isCnc)),
      objects: scene.objects.map(spatialObject),
    },
  };
  spatialProjects.set(project, projected);
  return projected;
}

/** Only the active side contributes coordinates; inactive intent remains in
 * the unprojected execution/review key. Unknown future fields stay conservative. */
function spatialCncSideSetup(side: CncTwoSidedSetup): CncTwoSidedSetup {
  const sideB = side.activeSide === 'B';
  return {
    ...side,
    sideAObjectIds: sideB ? [] : side.sideAObjectIds,
    sideBObjectIds: sideB ? side.sideBObjectIds : [],
    flipAxis: sideB ? side.flipAxis : 'x',
    sideBStockOriginMm: sideB ? side.sideBStockOriginMm : { x: 0, y: 0 },
    registration: [],
  };
}

/** Match the side membership filter without materializing or compiling geometry.
 * Projection targets and live authoring links still supply active coordinates. */
function spatialCncSideScene(project: Project): Scene {
  const scene = project.scene;
  const side = project.machine?.kind === 'cnc' ? project.cncSetup?.twoSided : undefined;
  if (side === undefined) return scene;
  const ids = new Set(side.activeSide === 'A' ? side.sideAObjectIds : side.sideBObjectIds);
  retainSpatialReliefProjections(scene, ids);
  for (const object of scene.outputDependencies ?? []) ids.add(object.id);
  retainSpatialReliefLinks(
    new Map(
      [...scene.objects, ...(scene.outputDependencies ?? [])].map((object) => [object.id, object]),
    ),
    ids,
  );
  return {
    ...scene,
    objects: scene.objects.filter((object) => ids.has(object.id)),
    ...(scene.artworkOrder === undefined
      ? {}
      : { artworkOrder: scene.artworkOrder.filter((id) => ids.has(id)) }),
  };
}

function retainSpatialReliefProjections(scene: Scene, ids: Set<string>): void {
  for (const layer of scene.layers) {
    const projection = layer.output ? layer.cnc?.reliefProjection : undefined;
    if (projection !== undefined) ids.add(projection.reliefObjectId);
  }
}

function retainSpatialReliefLinks(
  objects: ReadonlyMap<string, SceneObject>,
  ids: Set<string>,
): void {
  const pending = [...ids];
  for (const id of pending) {
    const object = objects.get(id);
    if (object?.kind !== 'relief' || object.reliefSource.kind !== 'heightfield-v1') continue;
    if (!('reliefAuthoring' in object) || object.reliefAuthoring === undefined) continue;
    for (const linkedId of reliefAuthoringLinkIds(object.reliefAuthoring)) {
      if (ids.has(linkedId)) continue;
      ids.add(linkedId);
      pending.push(linkedId);
    }
  }
}

/** Warning/timing metadata, process scales and idle button configuration do
 * not prove coordinates. Air commands and controlled laser-off feed only
 * change accessory/feed words at the already prepared endpoints.
 * Raster S quantization can still change its envelope: the actual newly
 * prepared bounds are compared before every Start, after using the real
 * profile. Acceleration/scan calibration and unknown future fields remain. */
function spatialDevice(device: DeviceProfile): DeviceProfile {
  const {
    estimateCutTimeScale: _cutTime,
    estimateTravelTimeScale: _travelTime,
    airAssistRestartUnreliable: _airRestart,
    controlledLaserOffTravelFeedMmPerMin: _offFeed,
    fireControl: _fireControl,
    capabilities,
    ...base
  } = device;
  const projected: DeviceProfile = {
    ...base,
    noGoZones: [],
    maxPowerS: 1000,
    minPowerS: 0,
    laserModeEnabled: true,
    airAssistCommand: 'none',
    framingFeedMmPerMin: 1,
    junctionDeviationMm: 0.01,
    autofocusCommand: '',
    // Output labels describe supported heads. The actual project machine kind
    // already binds spatial identity; Wizard Save makes an implicit Laser head
    // explicit without changing its coordinates. Other capabilities remain.
    capabilities: [...new Set(capabilities ?? [])]
      .filter((value) => value !== 'laser-output' && value !== 'cnc-output')
      .sort(),
  };
  // Machine Setup can move equivalent device fields to another object-key
  // position. Only this spatial projection canonicalizes keys; the executable
  // retention/replay identity and meaningful array order remain untouched.
  return Object.fromEntries(
    Object.entries(projected).sort(([left], [right]) => left.localeCompare(right)),
  ) as DeviceProfile;
}

function spatialLayer(layer: Layer, isCnc: boolean): Layer {
  const { materialBinding: _binding, ...base } = spatialSettings(layer) as Layer;
  const cnc = layer.cnc ?? (isCnc ? DEFAULT_CNC_LAYER_SETTINGS : undefined);
  return {
    ...base,
    name: '',
    subLayers: layer.subLayers.map((subLayer) => ({
      ...subLayer,
      label: '',
      settings: spatialSettings(subLayer.settings),
    })),
    ...(cnc === undefined ? {} : { cnc: spatialCncSettings(cnc) }),
  };
}

/** The compiler and CNC editor use this same implicit layer default. Saved
 * cutting records are provenance, not compiled coordinates. Neutralize primary
 * and stage process values only here; exact execution retains their real values.
 * Depth/tool/strategy, tabs and future coordinate fields remain spatial inputs. */
function spatialCncSettings(cnc: CncLayerSettings): CncLayerSettings {
  const {
    materialKey: _material,
    feedSource: _source,
    cuttingPreset: _preset,
    stageRecipes,
    ...coordinates
  } = cnc;
  return {
    ...coordinates,
    feedMmPerMin: 1,
    plungeMmPerMin: 1,
    spindleRpm: 0,
    ...(stageRecipes === undefined
      ? {}
      : {
          stageRecipes: Object.fromEntries(
            Object.entries(stageRecipes).map(([stage, recipe]) => [
              stage,
              recipe === undefined ? undefined : spatialCncStageRecipe(recipe),
            ]),
          ),
        }),
  };
}

function spatialCncStageRecipe(recipe: CncStageRecipe): CncStageRecipe {
  const { cuttingPreset: _preset, ...coordinates } = recipe;
  return { ...coordinates, feedMmPerMin: 1, plungeMmPerMin: 1, spindleRpm: 0 };
}

function spatialSettings(settings: LayerOperationSettings): LayerOperationSettings {
  const { tabCutPowerPercent: _tabPower, powerMode: _powerMode, ...base } = settings;
  return { ...base, power: 0, minPower: 0, speed: 1, airAssist: false, passes: 1 };
}

function spatialOverride(
  settings: ObjectOperationSettingsOverride,
): ObjectOperationSettingsOverride {
  const {
    power: _power,
    minPower: _minPower,
    speed: _speed,
    powerMode: _powerMode,
    airAssist: _airAssist,
    passes: _passes,
    tabCutPowerPercent: _tabPower,
    ...coordinates
  } = settings;
  return coordinates;
}

function spatialObject(object: SceneObject): SceneObject {
  const { powerScale: _powerScale, operationOverride, locked: _locked, ...base } = object;
  if (operationOverride === undefined) return base;
  const { byOperation, ...legacy } = operationOverride;
  const legacyCoordinates = spatialOverride(legacy);
  const overrides = Object.fromEntries(
    Object.entries(byOperation ?? {})
      .map(
        ([id, value]) =>
          [
            id,
            value === null
              ? Object.keys(legacyCoordinates).length > 0
                ? null
                : {}
              : spatialOverride(value),
          ] as const,
      )
      .filter(([, value]) => value === null || Object.keys(value).length > 0),
  );
  const projected = {
    ...legacyCoordinates,
    ...(Object.keys(overrides).length === 0 ? {} : { byOperation: overrides }),
  };
  return Object.keys(projected).length === 0 ? base : { ...base, operationOverride: projected };
}
