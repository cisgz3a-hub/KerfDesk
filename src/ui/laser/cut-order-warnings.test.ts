import { describe, expect, it } from 'vitest';
import { artwork, operation } from '../../core/cut-order.test-support';
import { cutsLastOrder } from '../../core/cuts-last-order';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { compileJob } from '../../core/job';
import { createProject, EMPTY_SCENE, type Layer, type Project, type Scene } from '../../core/scene';
import { detectCutOrderWarnings, isCutOrderWarning } from './cut-order-warnings';
import { detectJobIntentWarnings } from './job-intent-warnings';

const outline = artwork('outline', [{ operationId: 'cut', rect: [0, 0, 100, 100] }]);

function logo(id: string, operationId: string, x: number) {
  return artwork(id, [{ operationId, rect: [x, 10, 10, 10] }]);
}

function warningsFor(scene: Scene): ReadonlyArray<string> {
  return detectCutOrderWarnings(compileJob(scene, DEFAULT_DEVICE_PROFILE), scene.layers);
}

describe('detectCutOrderWarnings', () => {
  it('names the cut and the work inside it that runs later', () => {
    const layers: ReadonlyArray<Layer> = [
      { ...operation('cut'), name: 'Cut outline' },
      { ...operation('engrave', 'fill'), name: 'Engrave logo' },
    ];
    const warnings = warningsFor({
      layers,
      objects: [outline, logo('logo', 'engrave', 10)],
      artworkOrder: ['outline', 'logo'],
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(
      /^Cut order: a cut runs before the work inside it \("Cut outline" before "Engrave logo"\)\. /,
    );
    expect(warnings[0]).toContain('Sort cuts last');
    expect(warnings.every(isCutOrderWarning)).toBe(true);
  });

  it('lists three pairs and counts the rest in one warning', () => {
    const engraveIds = ['e1', 'e2', 'e3', 'e4'];
    const warnings = warningsFor({
      layers: [operation('cut'), ...engraveIds.map((id) => operation(id, 'fill'))],
      objects: [outline, ...engraveIds.map((id, index) => logo(`logo-${id}`, id, 10 + index * 20))],
      artworkOrder: ['outline', ...engraveIds.map((id) => `logo-${id}`)],
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(
      'cuts run before the work inside them ("cut" before "e1", "cut" before "e2", "cut" before "e3" and 1 more)',
    );
  });

  it('does not match other warnings', () => {
    expect(isCutOrderWarning('Fill overscan is 0, which disables the runway.')).toBe(false);
  });
});

describe('job intent warnings: cut order', () => {
  function project(scene: Scene): Project {
    return { ...createProject(), scene: { ...EMPTY_SCENE, ...scene } };
  }

  it('warns until Sort cuts last runs the cut after the engraving', () => {
    const before = project({
      layers: [operation('cut'), operation('engrave', 'fill')],
      objects: [outline, logo('logo', 'engrave', 10)],
      artworkOrder: ['outline', 'logo'],
    });
    const sorted = cutsLastOrder(before.scene, before.optimization.layerPriority).sorted;
    if (sorted === null) throw new Error('expected a reorder');
    const after = {
      ...before,
      scene: { ...before.scene, layers: sorted.layers, artworkOrder: sorted.artworkOrder },
    };

    expect(detectJobIntentWarnings(before).filter(isCutOrderWarning)).toHaveLength(1);
    expect(detectJobIntentWarnings(after).filter(isCutOrderWarning)).toEqual([]);
  });

  it('stays quiet for a cut with nothing inside it', () => {
    const scene = project({
      layers: [operation('cut'), operation('engrave', 'fill')],
      objects: [outline, logo('logo', 'engrave', 150)],
      artworkOrder: ['outline', 'logo'],
    });

    expect(detectJobIntentWarnings(scene).filter(isCutOrderWarning)).toEqual([]);
  });
});
