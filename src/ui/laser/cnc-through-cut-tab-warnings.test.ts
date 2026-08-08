import { describe, expect, it } from 'vitest';
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
      depthMap: {
        schemaVersion: 1,
        width: 1,
        height: 1,
        bitDepth: 8,
        samplesBase64: '/w==',
        polarity: 'light-is-high',
      },
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
      depthMap: {
        schemaVersion: 1,
        width: 1,
        height: 1,
        bitDepth: 8,
        samplesBase64: '/w==',
        polarity: 'light-is-high',
      },
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
