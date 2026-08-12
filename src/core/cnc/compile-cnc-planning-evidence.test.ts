import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncLayerSettings,
  type ImportedSvg,
  type Layer,
  type ReliefObject,
  type Scene,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';
import type * as PocketPaths from './pocket-paths';

const pocketRingOverride = vi.hoisted(() => ({
  current: null as PocketPaths.PocketToolpaths | null,
}));

vi.mock('./pocket-paths', async (importOriginal) => {
  const original = await importOriginal<typeof PocketPaths>();
  return {
    ...original,
    pocketRingToolpaths: (...args: Parameters<typeof original.pocketRingToolpaths>) =>
      pocketRingOverride.current ?? original.pocketRingToolpaths(...args),
  };
});

const dev = DEFAULT_DEVICE_PROFILE;
const config = DEFAULT_CNC_MACHINE_CONFIG;

function squareObject(id: string, color: string, size: number, at = 50): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: at, minY: at, maxX: at + size, maxY: at + size },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            closed: true,
            points: [
              { x: at, y: at },
              { x: at + size, y: at },
              { x: at + size, y: at + size },
              { x: at, y: at + size },
            ],
          },
        ],
      },
    ],
  };
}

function cncLayer(id: string, color: string, cnc: Partial<CncLayerSettings>): Layer {
  return {
    ...createLayer({ id, color }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, tabsEnabled: false, ...cnc },
  };
}

function sceneWith(layers: Layer[], objects: ImportedSvg[]): Scene {
  return { objects, layers };
}

describe('compileCncJob planning evidence', () => {
  beforeEach(() => {
    pocketRingOverride.current = null;
  });

  it('retains exact relief-grid evidence with the compiled job', () => {
    const color = '#a0522d';
    const relief: ReliefObject = {
      kind: 'relief',
      id: 'relief',
      source: 'portrait.png',
      reliefSource: testReliefHeightfield({
        width: 2,
        height: 2,
        physicalWidthMm: 20,
        physicalHeightMm: 20,
        maxDepthMm: 3,
        samplesU8: [0, 255, 128, 255],
        provenance: { sourceName: 'portrait.png' },
      }),
      targetWidthMm: 20,
      reliefDepthMm: 3,
      color,
      bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
      transform: IDENTITY_TRANSFORM,
    };
    const layer = cncLayer('relief-op', color, {
      cutType: 'pocket',
      pocketStrategy: 'adaptive',
      depthPerPassMm: 3,
      stepoverPercent: 40,
      reliefFinishToolId: 'bn-3175',
      reliefScallopMm: 2,
    });

    const job = compileCncJob({ objects: [relief], layers: [layer] }, dev, config);

    expect(job.cncCompilation?.reliefPlans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          layerId: 'relief-op',
          source: 'portrait.png',
          stage: 'roughing',
          cellSizeMm: 3.175 / 8,
          toolDiameterMm: 3.175,
        }),
        expect.objectContaining({
          layerId: 'relief-op',
          source: 'portrait.png',
          stage: 'finishing',
          toolKind: 'ball-nose',
          toolDiameterMm: 3.175,
          scallopMm: 2,
          rowSpacingMm: 3.175,
        }),
      ]),
    );
    expect(job.cncCompilation?.stepoverOperations).toEqual([
      { layerId: 'relief-op', stepoverPercent: 40 },
    ]);
  });

  it('retains the stored Stepover while preserving current-main pocket planning', () => {
    const scene = sceneWith(
      [cncLayer('L1', '#ff0000', { cutType: 'pocket', stepoverPercent: 200 })],
      [squareObject('O1', '#ff0000', 20)],
    );

    const job = compileCncJob(scene, dev, config);

    expect(job.cncCompilation?.stepoverOperations).toEqual([
      { layerId: 'L1', stepoverPercent: 200 },
    ]);

    const limited = compileCncJob(
      sceneWith(
        [cncLayer('limited', '#ff0000', { cutType: 'pocket', stepoverPercent: 0.001 })],
        [squareObject('limited-square', '#ff0000', 20)],
      ),
      dev,
      config,
    );
    expect(limited.cncCompilation?.offsetLadderDiagnostics).not.toContainEqual({
      layerId: 'limited',
      kind: 'pass-limit',
    });
  });

  it('retains stored Stepover evidence from the female inlay planner', () => {
    const job = compileCncJob(
      sceneWith(
        [
          cncLayer('inlay-limited', '#ff0000', {
            cutType: 'inlay-pair',
            stepoverPercent: 0.001,
          }),
        ],
        [squareObject('inlay-square', '#ff0000', 20)],
      ),
      dev,
      config,
    );

    expect(job.groups).toHaveLength(2);
    expect(job.cncCompilation?.stepoverOperations).toEqual([
      { layerId: 'inlay-limited', stepoverPercent: 0.001 },
    ]);
    expect(job.cncCompilation?.offsetLadderDiagnostics).not.toContainEqual({
      layerId: 'inlay-limited',
      kind: 'pass-limit',
    });
  });

  it('omits unused Stepover evidence for an adaptive-only pocket', () => {
    const job = compileCncJob(
      sceneWith(
        [
          cncLayer('adaptive', '#ff0000', {
            cutType: 'pocket',
            pocketStrategy: 'adaptive',
            stepoverPercent: 200,
          }),
        ],
        [squareObject('adaptive-square', '#ff0000', 20)],
      ),
      dev,
      config,
    );

    expect(job.groups).toHaveLength(1);
    expect(job.cncCompilation?.stepoverOperations).toEqual([]);
    expect(job.cncCompilation?.offsetLadderDiagnostics ?? []).toEqual([]);
  });

  it('retains a first-offset geometry failure from rest roughing', () => {
    pocketRingOverride.current = {
      toolpaths: [],
      offsetFailed: true,
      passLimited: false,
      stepoverUsed: true,
    };
    const job = compileCncJob(
      sceneWith(
        [
          cncLayer('rest-failed', '#ff0000', {
            cutType: 'pocket',
            pocketStrategy: 'offset',
            pocketRoughToolId: 'em-6350',
          }),
        ],
        [squareObject('rest-square', '#ff0000', 20)],
      ),
      dev,
      config,
    );

    expect(job.groups).toEqual([]);
    expect(job.cncCompilation?.offsetLadderDiagnostics).toContainEqual({
      layerId: 'rest-failed',
      kind: 'geometry-failed',
    });
    expect(job.cncCompilation?.stepoverOperations).toEqual([
      { layerId: 'rest-failed', stepoverPercent: DEFAULT_CNC_LAYER_SETTINGS.stepoverPercent },
    ]);
  });

  it('retains female-inlay geometry failure from the planner that generated its paths', () => {
    pocketRingOverride.current = {
      toolpaths: [
        {
          closed: true,
          points: [
            { x: 52, y: 52 },
            { x: 68, y: 52 },
            { x: 68, y: 68 },
            { x: 52, y: 68 },
          ],
        },
      ],
      offsetFailed: true,
      passLimited: false,
      stepoverUsed: true,
    };
    const job = compileCncJob(
      sceneWith(
        [cncLayer('inlay-failed', '#ff0000', { cutType: 'inlay-pair' })],
        [squareObject('inlay-square', '#ff0000', 20)],
      ),
      dev,
      config,
    );

    expect(job.groups).toHaveLength(2);
    expect(job.cncCompilation?.offsetLadderDiagnostics).toContainEqual({
      layerId: 'inlay-failed',
      kind: 'geometry-failed',
    });
  });

  it('does not claim Stepover consumption when configured planners never run', () => {
    const missingClearTool = compileCncJob(
      sceneWith(
        [
          cncLayer('v-no-clear', '#ff0000', {
            cutType: 'v-carve',
            toolId: 'vb-90-6350-hobby',
            vCarveFlatDepthEnabled: true,
            vClearToolId: 'missing-clear-tool',
            stepoverPercent: 200,
          }),
        ],
        [squareObject('v-square', '#ff0000', 20)],
      ),
      dev,
      config,
    );
    const invalidInlay = compileCncJob(
      sceneWith(
        [cncLayer('invalid-inlay', '#ff0000', { cutType: 'inlay-pair', stepoverPercent: 200 })],
        [squareObject('tiny-inlay', '#ff0000', 1)],
      ),
      dev,
      config,
    );

    expect(
      missingClearTool.groups.map((group) => (group.kind === 'cnc' ? group.cutType : group.kind)),
    ).toEqual(['v-carve']);
    expect(missingClearTool.cncCompilation?.stepoverOperations).toEqual([]);
    expect(invalidInlay.groups).toEqual([]);
    expect(invalidInlay.cncCompilation?.stepoverOperations).toEqual([]);
  });
});
