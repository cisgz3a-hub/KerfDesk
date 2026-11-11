// S8-P3-1: rest machining planned its rest pocket three times per export (the
// compile's passes, its roughing group and emit preflight) and adaptive
// clearing twice (compile and preflight). Each is now planned once per output,
// and the G-code is the same. Counted, not timed.
import { describe, expect, it, vi } from 'vitest';
import {
  benchmarkLayer,
  benchmarkProject,
  benchmarkRectangle,
  benchmarkVector,
} from '../../__fixtures__/cnc-leader-fixtures';
import { emitPreparedGcode } from '../../io/gcode/emit-gcode';
import { prepareOutput } from '../../io/gcode/prepare-output';
import type { CncLayerSettings, Project } from '../scene';
import type * as AdaptivePocket from './adaptive-pocket';
import type * as RestPocket from './rest-pocket';

const plans = vi.hoisted(() => ({ rest: 0, adaptive: 0 }));
vi.mock('./rest-pocket', async (importOriginal) => {
  const actual = await importOriginal<typeof RestPocket>();
  return {
    ...actual,
    planRestPocketToolpaths: (...args: Parameters<typeof actual.planRestPocketToolpaths>) => {
      plans.rest += 1;
      return actual.planRestPocketToolpaths(...args);
    },
  };
});
vi.mock('./adaptive-pocket', async (importOriginal) => {
  const actual = await importOriginal<typeof AdaptivePocket>();
  return {
    ...actual,
    planAdaptivePocket: (...args: Parameters<typeof actual.planAdaptivePocket>) => {
      plans.adaptive += 1;
      return actual.planAdaptivePocket(...args);
    },
  };
});

const POCKET: Partial<CncLayerSettings> = {
  cutType: 'pocket',
  depthMm: 3,
  depthPerPassMm: 1.5,
  toolId: 'end6',
  stepoverPercent: 40,
};

function pocketProject(id: string, settings: Partial<CncLayerSettings>, size: number): Project {
  const project = benchmarkProject();
  return {
    ...project,
    scene: {
      layers: [benchmarkLayer(id, { ...POCKET, ...settings })],
      objects: [benchmarkVector(id, [benchmarkRectangle(10, 10, size, size * 0.6)], [id])],
    },
  };
}

function exportGcode(project: Project): string {
  const prepared = prepareOutput(project);
  if (!prepared.ok) throw new Error('prepare failed');
  return emitPreparedGcode(prepared).gcode ?? '';
}

describe('CNC plans once per output (S8-P3-1)', () => {
  it('plans a rest pocket once across prepare and emit', () => {
    // Its own size, so no earlier test's plan is reused.
    const project = pocketProject('rest', { toolId: 'end2', pocketRoughToolId: 'end6' }, 41);
    plans.rest = 0;
    const gcode = exportGcode(project);
    expect(gcode.length).toBeGreaterThan(0);
    // Main planned it three times.
    expect(plans.rest).toBe(1);
  });

  it('plans and verifies an adaptive pocket once across prepare and emit', () => {
    const project = pocketProject('adaptive', { pocketStrategy: 'adaptive' }, 23);
    plans.adaptive = 0;
    exportGcode(project);
    // Main planned and verified it twice.
    expect(plans.adaptive).toBe(1);
  });

  it('plans again when the pocket changes', () => {
    plans.rest = 0;
    const first = exportGcode(
      pocketProject('rest', { toolId: 'end2', pocketRoughToolId: 'end6' }, 37),
    );
    const second = exportGcode(
      pocketProject('rest', { toolId: 'end2', pocketRoughToolId: 'end6' }, 39),
    );
    expect(plans.rest).toBe(2);
    expect(second).not.toBe(first);
  });
});
