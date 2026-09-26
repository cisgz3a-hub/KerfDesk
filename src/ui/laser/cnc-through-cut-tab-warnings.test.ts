import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type CncLayerSettings,
  type Project,
  type ReliefObject,
  type SceneObject,
} from '../../core/scene';
import { settingsWithStockTabGate } from '../../core/cnc/cnc-tabs';
import { detectCncThroughCutTabWarnings } from './cnc-through-cut-tab-warnings';

function cncProjectWithLayerCnc(cnc: CncLayerSettings | undefined): Project {
  const layer = { ...createLayer({ id: 'L1', color: '#ff0000' }), ...(cnc ? { cnc } : {}) };
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: { objects: [], layers: [layer] },
  };
}

describe('detectCncThroughCutTabWarnings', () => {
  it('keeps the out-of-box profile safe with a shallow starter depth', () => {
    // No layer.cnc uses the compile fallback: the starter profile stays above
    // the stock bottom, so it cannot release the part.
    const warnings = detectCncThroughCutTabWarnings(cncProjectWithLayerCnc(undefined));
    expect(warnings).toEqual([]);
  });

  it('is silent when holding tabs are enabled', () => {
    const cnc = { ...DEFAULT_CNC_LAYER_SETTINGS, tabsEnabled: true };
    expect(detectCncThroughCutTabWarnings(cncProjectWithLayerCnc(cnc))).toEqual([]);
  });

  it('warns when the operator disables tabs on a through-cut profile', () => {
    const cnc = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      depthMm: DEFAULT_CNC_MACHINE_CONFIG.stock.thicknessMm,
      tabsEnabled: false,
    };
    const warnings = detectCncThroughCutTabWarnings(cncProjectWithLayerCnc(cnc));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('no holding tabs');
  });

  // Audit 1.19: only tab-less profiles were checked, so a pocket, engrave,
  // v-carve or relief layer set past the stock cut the spoilboard silently.
  it('warns when a pocket is set deeper than the stock', () => {
    const cnc = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'pocket' as const,
      depthMm: DEFAULT_CNC_MACHINE_CONFIG.stock.thicknessMm + 1.65,
    };
    const warnings = detectCncThroughCutTabWarnings(cncProjectWithLayerCnc(cnc));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('into the spoilboard');
    expect(warnings[0]).toContain('1.65 mm past the bottom');
  });

  it('leaves V-carve spoilboard depth to exact compiled-pass warnings', () => {
    const cnc = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'v-carve' as const,
      depthMm: DEFAULT_CNC_MACHINE_CONFIG.stock.thicknessMm + 20,
      vCarveFlatDepthEnabled: false,
    };

    expect(detectCncThroughCutTabWarnings(cncProjectWithLayerCnc(cnc))).toEqual([]);
  });

  it('does not treat a relief-only layer setting as the relief object depth', () => {
    const project = cncProjectWithLayerCnc({
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'pocket',
      depthMm: DEFAULT_CNC_MACHINE_CONFIG.stock.thicknessMm + 20,
    });
    const relief: ReliefObject = {
      kind: 'relief',
      id: 'relief',
      source: 'height.png',
      reliefSource: testReliefHeightfield({
        width: 1,
        height: 1,
        physicalWidthMm: 10,
        physicalHeightMm: 10,
        maxDepthMm: 2,
        samplesU8: [255],
      }),
      targetWidthMm: 10,
      reliefDepthMm: 2,
      color: '#ff0000',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
    };

    expect(
      detectCncThroughCutTabWarnings({
        ...project,
        scene: { ...project.scene, objects: [relief] },
      }),
    ).toEqual([]);
  });

  it('retains the layer-depth warning when a relief shares its operation with vector geometry', () => {
    const project = cncProjectWithLayerCnc({
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'pocket',
      depthMm: DEFAULT_CNC_MACHINE_CONFIG.stock.thicknessMm + 1,
    });
    const relief: ReliefObject = {
      kind: 'relief',
      id: 'relief',
      source: 'height.png',
      reliefSource: testReliefHeightfield({
        width: 1,
        height: 1,
        physicalWidthMm: 10,
        physicalHeightMm: 10,
        maxDepthMm: 2,
        samplesU8: [255],
      }),
      targetWidthMm: 10,
      reliefDepthMm: 2,
      color: '#ff0000',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
    };
    const vector: SceneObject = {
      kind: 'imported-svg',
      id: 'vector',
      source: 'shape.svg',
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
      paths: [{ color: '#ff0000', polylines: [] }],
    };

    expect(
      detectCncThroughCutTabWarnings({
        ...project,
        scene: { ...project.scene, objects: [relief, vector] },
      }),
    ).toEqual([expect.stringContaining('into the spoilboard')]);
  });

  it('warns about spoilboard overcut on a tabbed profile, not the free-part case', () => {
    const cnc = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      depthMm: DEFAULT_CNC_MACHINE_CONFIG.stock.thicknessMm + 2,
      tabsEnabled: true,
    };
    const warnings = detectCncThroughCutTabWarnings(cncProjectWithLayerCnc(cnc));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('into the spoilboard');
    expect(warnings[0]).not.toContain('no holding tabs');
  });

  it('is silent for a pocket that stops exactly on the stock bottom', () => {
    const cnc = {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'pocket' as const,
      depthMm: DEFAULT_CNC_MACHINE_CONFIG.stock.thicknessMm,
    };
    expect(detectCncThroughCutTabWarnings(cncProjectWithLayerCnc(cnc))).toEqual([]);
  });

  it('is silent when the cut depth stays inside the stock', () => {
    const cnc = { ...DEFAULT_CNC_LAYER_SETTINGS, depthMm: 3 };
    expect(detectCncThroughCutTabWarnings(cncProjectWithLayerCnc(cnc))).toEqual([]);
  });

  it('is silent for a non-profile cut type (a pocket has no part to free)', () => {
    const cnc = { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'pocket' as const };
    expect(detectCncThroughCutTabWarnings(cncProjectWithLayerCnc(cnc))).toEqual([]);
  });

  it('is silent for a non-output layer', () => {
    const layer = { ...createLayer({ id: 'L1', color: '#ff0000' }), output: false };
    const project: Project = {
      ...createProject(),
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      scene: { objects: [], layers: [layer] },
    };
    expect(detectCncThroughCutTabWarnings(project)).toEqual([]);
  });

  it('returns nothing for a laser project', () => {
    expect(detectCncThroughCutTabWarnings(createProject())).toEqual([]);
  });
});

describe('tabs skipped because of the stock thickness (ADR-258 amendment 2)', () => {
  function projectWith(stockThicknessMm: number, cnc: CncLayerSettings): Project {
    const project = cncProjectWithLayerCnc(cnc);
    const stock = { ...DEFAULT_CNC_MACHINE_CONFIG.stock, thicknessMm: stockThicknessMm };
    return { ...project, machine: { ...DEFAULT_CNC_MACHINE_CONFIG, stock } };
  }

  it('names the stock thickness it relied on when tabs are dropped', () => {
    // A 12.7 mm value left from a 1/2" job while 1/4" plywood is cut 6.8 mm deep:
    // the compiler emits no tabs, and nothing else in Job Review says so.
    const cnc = { ...DEFAULT_CNC_LAYER_SETTINGS, depthMm: 6.8, tabsEnabled: true };
    const warnings = detectCncThroughCutTabWarnings(projectWith(12.7, cnc));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('skips its holding tabs');
    expect(warnings[0]).toContain('Stock thickness is 12.7 mm');
    expect(warnings[0]).toContain('6.8 mm cut leaves a 5.9 mm floor');
  });

  it('is silent wherever the tabs are still cut or never apply', () => {
    const tabs = { ...DEFAULT_CNC_LAYER_SETTINGS, tabsEnabled: true };
    const shipped = DEFAULT_CNC_MACHINE_CONFIG.stock.thicknessMm;
    // A floor thinner than a tab keeps them.
    expect(detectCncThroughCutTabWarnings(projectWith(12.7, { ...tabs, depthMm: 11.5 }))).toEqual(
      [],
    );
    // The shipped thickness counts as "not set", so any cut keeps its tabs.
    expect(detectCncThroughCutTabWarnings(projectWith(shipped, { ...tabs, depthMm: 3 }))).toEqual(
      [],
    );
    // No deeper than a tab, and tabs switched off: nothing was dropped.
    expect(detectCncThroughCutTabWarnings(projectWith(12.7, { ...tabs, depthMm: 2 }))).toEqual([]);
    expect(
      detectCncThroughCutTabWarnings(
        projectWith(12.7, { ...tabs, depthMm: 6.8, tabsEnabled: false }),
      ),
    ).toEqual([]);
    // Pockets never get tabs.
    expect(
      detectCncThroughCutTabWarnings(
        projectWith(12.7, { ...tabs, depthMm: 6.8, cutType: 'pocket' as const }),
      ),
    ).toEqual([]);
  });

  it('fires exactly where the compiler drops tabs a profile asked for', () => {
    for (const stockThicknessMm of [3, 6.35, 9, 12.7, 18]) {
      for (const depthMm of [0.5, 1, 2, 2.5, 4, 6.8, 9, 12, 18, 19]) {
        const cnc = { ...DEFAULT_CNC_LAYER_SETTINGS, depthMm, tabsEnabled: true };
        const gated = settingsWithStockTabGate(cnc, stockThicknessMm);
        const dropped = depthMm > cnc.tabHeightMm && !gated.tabsEnabled;
        const warned = detectCncThroughCutTabWarnings(projectWith(stockThicknessMm, cnc)).some(
          (warning) => warning.includes('skips its holding tabs'),
        );
        expect({ stockThicknessMm, depthMm, warned }).toEqual({
          stockThicknessMm,
          depthMm,
          warned: dropped,
        });
      }
    }
  });
});

// ADR-258 amendment 3 (CNC audit TP-1): the overcut warning says how thick the
// tabs stay, because a set stock thickness now measures them from the stock
// bottom, and the shipped default still loses tab height to the overcut.
describe('tab thickness in the spoilboard overcut warning (ADR-258 amendment 3)', () => {
  const tabs = { ...DEFAULT_CNC_LAYER_SETTINGS, tabsEnabled: true };
  function projectWith(stockThicknessMm: number, cnc: CncLayerSettings): Project {
    const project = cncProjectWithLayerCnc(cnc);
    const stock = { ...DEFAULT_CNC_MACHINE_CONFIG.stock, thicknessMm: stockThicknessMm };
    return { ...project, machine: { ...DEFAULT_CNC_MACHINE_CONFIG, stock } };
  }

  it('says a set stock keeps the tabs full height above the stock bottom', () => {
    const warnings = detectCncThroughCutTabWarnings(projectWith(6, { ...tabs, depthMm: 6.5 }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('into the spoilboard');
    expect(warnings[0]).toContain('Its holding tabs stay 2 mm thick above the stock bottom');
  });

  it('says how much of each tab the shipped default stock leaves after the overcut', () => {
    const shipped = DEFAULT_CNC_MACHINE_CONFIG.stock.thicknessMm;
    const partly = detectCncThroughCutTabWarnings(
      projectWith(shipped, { ...tabs, depthMm: shipped + 0.5 }),
    );
    expect(partly[0]).toContain('only 1.5 mm of each is in the stock');
    const gone = detectCncThroughCutTabWarnings(
      projectWith(shipped, { ...tabs, depthMm: shipped + 2.15 }),
    );
    expect(gone[0]).toContain('sit below the stock, and the part comes free');
  });

  it('adds nothing about tabs to an overcut without them', () => {
    const pocket = { ...tabs, cutType: 'pocket' as const, depthMm: 6.5 };
    const tabless = { ...tabs, tabsEnabled: false, depthMm: 6.5 };
    for (const cnc of [pocket, tabless]) {
      const [warning] = detectCncThroughCutTabWarnings(projectWith(6, cnc));
      expect(warning).not.toContain('holding tabs stay');
      expect(warning).not.toContain('measured from the cut floor');
    }
  });
});
