import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../../__fixtures__/relief-heightfield';
import { compileCncJob } from '../../../core/cnc/compile-cnc-job';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncTool,
  type Layer,
  type ReliefObject,
  type Scene,
} from '../../../core/scene';
import { createRectangle } from '../../../core/shapes/primitives';
import { useStore } from '../../state';
import { resetStore } from '../../state/test-helpers';
import { buildEffectiveOperationReview } from './job-review-effective-operations';
import { JobReviewLayersTable } from './JobReviewLayersTable';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const FINISH_TOOL: CncTool = {
  id: 'review-ball',
  name: 'Review finishing ball',
  kind: 'ball-nose',
  diameterMm: 2,
  fluteCount: 2,
};
const MACHINE = {
  ...DEFAULT_CNC_MACHINE_CONFIG,
  tools: [...DEFAULT_CNC_MACHINE_CONFIG.tools, FINISH_TOOL],
};
const LAYER: Layer = {
  ...createLayer({ id: 'relief', color: '#a0522d' }),
  cnc: {
    ...DEFAULT_CNC_LAYER_SETTINGS,
    rampEntryDeg: 5,
    reliefFinishToolId: FINISH_TOOL.id,
    stageRecipes: {
      'relief-finish': {
        toolId: FINISH_TOOL.id,
        feedMmPerMin: 321.9,
        plungeMmPerMin: 123.9,
        spindleRpm: 9000.4,
        depthPerPassMm: 0.5,
      },
    },
  },
};

let host: HTMLDivElement;
let root: Root | null = null;

beforeEach(() => {
  resetStore();
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  host.remove();
  resetStore();
});

function reviewScene(withShape: boolean): Scene {
  const relief: ReliefObject = {
    kind: 'relief',
    id: 'floor',
    source: 'floor.png',
    reliefSource: testReliefHeightfield({
      width: 1,
      height: 1,
      physicalWidthMm: 20,
      physicalHeightMm: 20,
      maxDepthMm: 3,
      samplesU8: [0],
    }),
    targetWidthMm: 20,
    reliefDepthMm: 3,
    color: LAYER.color,
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
  };
  const square = createRectangle({
    id: 'square',
    spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    transform: { ...IDENTITY_TRANSFORM, x: 30 },
    color: LAYER.color,
  });
  return { objects: withShape ? [relief, square] : [relief], layers: [LAYER] };
}

describe('Job Review relief levels with independent stage recipes', () => {
  it.each([false, true])(
    'keeps compiled relief facts, entry disclosure and represented finishing values (other shape: %s)',
    async (withShape) => {
      const scene = reviewScene(withShape);
      const device = { ...DEFAULT_DEVICE_PROFILE, maxFeed: 400 };
      const project = { ...createProject(), scene, machine: MACHINE, device };
      useStore.setState({ project });
      const job = compileCncJob(scene, device, MACHINE);
      const before = structuredClone(job);
      const finish = job.groups.find(
        (group) => group.kind === 'cnc' && group.cutType === 'relief-finish',
      );
      expect(finish).toMatchObject({
        cuttingStage: 'relief-finish',
        toolFluteCount: 2,
        feedMmPerMin: 321.9,
        plungeMmPerMin: 123.9,
        spindleRpm: 9000.4,
      });

      const effective = buildEffectiveOperationReview(job);
      root = createRoot(host);
      await act(async () => {
        root?.render(<JobReviewLayersTable machineKind="cnc" effectiveOperations={effective} />);
      });

      const shapeParts = withShape
        ? '1 pass on the other shapes · stepover 40% · tabs 4 per shape (6 × 2 mm), none on reliefs'
        : 'stepover 40%';
      expect([...host.querySelectorAll('td')].map((cell) => cell.textContent)).toContain(
        `relief roughing 2 levels to 2.5 mm · ${shapeParts} · ramp entry 5° (relief finishing plunges) · Manual feeds`,
      );
      expect(effective[0]?.relief).toEqual({
        roughingLevelDepthsMm: [1.5, 2.5],
        reliefCount: 1,
        // The finishing ball cuts the roughing allowance down to the floor.
        maxDepthMm: 3,
        cutsOtherShapes: withShape,
      });
      expect(effective[0]?.plungingReliefStages).toEqual(['relief-finish']);
      expect(host.textContent).toContain('Relief finishing · Review finishing ball');
      // Independent expected F/S representation: floor feeds, round RPM;
      // 321 / (9000 * 2 flutes) = 0.017833... mm/tooth, shown to four places.
      expect(host.textContent).toContain(
        '321 mm/min feed · 123 mm/min plunge · 9,000 RPM · coolant off · 0.0178 mm/tooth programmed nominal chipload',
      );
      expect(host.textContent).toContain('400 mm/min feed');
      expect(job).toEqual(before);
      expect(useStore.getState().project).toBe(project);
    },
  );
});
