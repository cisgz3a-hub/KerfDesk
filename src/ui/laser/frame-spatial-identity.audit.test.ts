import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Layer, Project } from '../../core/scene';
import { DEFAULT_CNC_LAYER_SETTINGS, DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene/machine';
import { useStore } from '../state';
import { initialLaserState } from '../state/laser-store-helpers';
import { useLaserStore } from '../state/laser-store';
import { installFrameOnceProject } from './frame-once.test-support';
import { currentFrameSpatialSignature } from './frame-spatial-identity';
import { currentReplayExecutionSignature } from './start-job-execution-tracking';

beforeEach(installFrameOnceProject);
afterEach(() => useLaserStore.setState(initialLaserState()));

function editProject(edit: (project: Project) => Project): void {
  useStore.setState((state) => ({ project: edit(state.project) }));
}

function editLayer(patch: Partial<Layer>): void {
  editProject((project) => ({
    ...project,
    scene: {
      ...project.scene,
      layers: project.scene.layers.map((layer) => ({ ...layer, ...patch })),
    },
  }));
}

describe('spatial Frame input identity separate from exact execution', () => {
  it.each([
    { power: 71 },
    { minPower: 12 },
    { speed: 2300 },
    { airAssist: true },
    { powerMode: 'constant' as const },
    { tabCutPowerPercent: 15 },
    { passes: 3 },
    { name: 'New operation name' },
  ])('retains authored coordinates for process edit %j while exact execution changes', (patch) => {
    const spatial = currentFrameSpatialSignature();
    const exact = currentReplayExecutionSignature();
    editLayer(patch);
    expect(currentFrameSpatialSignature()).toBe(spatial);
    expect(currentReplayExecutionSignature()).not.toBe(exact);
  });

  it('retains per-artwork powerScale and legacy/operation-owned process edits', () => {
    const signature = currentFrameSpatialSignature();
    editProject((project) => ({
      ...project,
      scene: {
        ...project.scene,
        objects: project.scene.objects.map((object) => ({
          ...object,
          powerScale: 70,
          operationOverride: {
            power: 40,
            speed: 900,
            byOperation: { red: { power: 61, speed: 1100 } },
          },
        })),
      },
    }));
    expect(currentFrameSpatialSignature()).toBe(signature);
  });

  it('treats profile capability order as membership while keeping exact execution identity strict', () => {
    const signature = currentFrameSpatialSignature();
    const exact = currentReplayExecutionSignature();
    editProject((project) => ({
      ...project,
      device: {
        ...project.device,
        capabilities: [...(project.device.capabilities ?? [])].reverse(),
      },
    }));
    expect(currentFrameSpatialSignature()).toBe(signature);
    expect(currentReplayExecutionSignature()).not.toBe(exact);
    editProject((project) => ({
      ...project,
      device: {
        ...project.device,
        capabilities: (project.device.capabilities ?? []).filter((value) => value !== 'rotary'),
      },
    }));
    expect(currentFrameSpatialSignature()).not.toBe(signature);
  });

  it('retains unknown device field values and their array order in spatial identity', () => {
    const points = [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ];
    editProject((project) => ({
      ...project,
      device: { ...project.device, futureFrameCoordinates: points },
    }));
    const signature = currentFrameSpatialSignature();
    editProject((project) => ({
      ...project,
      device: { ...project.device, futureFrameCoordinates: [...points].reverse() },
    }));
    expect(currentFrameSpatialSignature()).not.toBe(signature);
  });

  it('retains sub-operation process values and CNC feed, plunge and spindle values', () => {
    editLayer({
      subLayers: [
        {
          id: 'finish',
          label: 'Finish',
          enabled: true,
          settings: useStore.getState().project.scene.layers[0]!,
        },
      ],
      cnc: DEFAULT_CNC_LAYER_SETTINGS,
    });
    const signature = currentFrameSpatialSignature();
    const layer = useStore.getState().project.scene.layers[0]!;
    editLayer({
      subLayers: layer.subLayers.map((subLayer) => ({
        ...subLayer,
        label: 'Renamed',
        settings: { ...subLayer.settings, speed: 800, power: 20 },
      })),
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        feedMmPerMin: 400,
        plungeMmPerMin: 120,
        spindleRpm: 9000,
      },
    });
    expect(currentFrameSpatialSignature()).toBe(signature);
  });

  it.each([
    { depthMm: 2 },
    { toolId: 'different-primary-tool' },
    { stepoverPercent: 20 },
    { tabHeightMm: 1 },
    { cutType: 'pocket' as const },
  ])('preserves CNC coordinate fields after implicit defaults are materialized %j', (patch) => {
    editProject((project) => ({ ...project, machine: DEFAULT_CNC_MACHINE_CONFIG }));
    const signature = currentFrameSpatialSignature();
    editLayer({ cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...patch } });
    expect(currentFrameSpatialSignature()).not.toBe(signature);
  });

  it.each([
    { kerfOffsetMm: 0.5 },
    { hatchAngleDeg: 45 },
    { fillOverscanMm: 10 },
    { output: false },
  ])('preserves coordinate/output edits in identity %j', (patch) => {
    const signature = currentFrameSpatialSignature();
    editLayer(patch);
    expect(currentFrameSpatialSignature()).not.toBe(signature);
  });

  it('preserves null inheritance when a legacy override carries coordinates', () => {
    const project = useStore.getState().project;
    const object = project.scene.objects[0]!;
    editProject((current) => ({
      ...current,
      scene: { ...current.scene, objects: [{ ...object, operationOverride: { kerfOffsetMm: 1 } }] },
    }));
    const signature = currentFrameSpatialSignature();
    editProject((current) => ({
      ...current,
      scene: {
        ...current.scene,
        objects: [
          { ...object, operationOverride: { kerfOffsetMm: 1, byOperation: { red: null } } },
        ],
      },
    }));
    expect(currentFrameSpatialSignature()).not.toBe(signature);
  });
});
