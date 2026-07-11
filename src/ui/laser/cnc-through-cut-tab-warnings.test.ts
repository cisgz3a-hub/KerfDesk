import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  createLayer,
  createProject,
  type CncLayerSettings,
  type Project,
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
  it('warns for the out-of-box default layer (profile, depth == stock, tabs off)', () => {
    // No layer.cnc → the compile fallback DEFAULT_CNC_LAYER_SETTINGS applies:
    // profile-outside, 6.35 mm, tabs off — against 6.35 mm default stock.
    const warnings = detectCncThroughCutTabWarnings(cncProjectWithLayerCnc(undefined));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('no holding tabs');
  });

  it('is silent when holding tabs are enabled', () => {
    const cnc = { ...DEFAULT_CNC_LAYER_SETTINGS, tabsEnabled: true };
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
