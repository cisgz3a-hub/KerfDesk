import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  type Scene,
} from '../scene';
import type { CncGroup } from '../job';
import { findDroppedCncLayers } from './compile-cnc-diagnostics';
import type * as CncCompiler from './compile-cnc-job';
const calls = vi.hoisted(() => ({ collect: vi.fn(), plan: vi.fn() }));
vi.mock('./compile-cnc-job', async (original) => ({
  ...(await original<typeof CncCompiler>()),
  collectLayerPolylines: calls.collect,
  xyToolpathsForCutType: calls.plan,
}));
const group: CncGroup = {
  kind: 'cnc',
  layerId: 'pocket',
  color: '#000000',
  cutType: 'pocket',
  toolDiameterMm: 3,
  feedMmPerMin: 500,
  plungeMmPerMin: 200,
  spindleRpm: 12000,
  spindleSpinupSec: 0,
  safeZMm: 5,
  passes: [],
};
const scene: Scene = {
  objects: [],
  layers: [
    {
      ...createLayer({ id: 'pocket', color: '#000000' }),
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'pocket', pocketRoughToolId: 'rough' },
    },
  ],
};
beforeEach(() => {
  calls.collect.mockReset().mockReturnValue([
    {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 0, y: 5 },
      ],
    },
  ]);
  calls.plan.mockReset().mockImplementation(() => {
    throw new Error('Unexpected duplicate planner');
  });
});
describe('dropped-layer diagnostics from prepared output', () => {
  it('trusts represented compiled operations without recollecting or replanning their geometry', () => {
    expect(
      findDroppedCncLayers(scene, DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG, {
        groups: [group],
      }),
    ).toEqual([]);
    expect(calls.collect).not.toHaveBeenCalled();
    expect(calls.plan).not.toHaveBeenCalled();
  });
  it('reports an absent vector operation without rerunning a pocket planner', () => {
    expect(
      findDroppedCncLayers(scene, DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG, {
        groups: [],
      }),
    ).toEqual(['pocket']);
    expect(calls.plan).not.toHaveBeenCalled();
  });
});
