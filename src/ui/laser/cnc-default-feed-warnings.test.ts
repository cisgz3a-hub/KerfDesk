import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  createLayer,
  createProject,
  type CncLayerSettings,
  type Project,
} from '../../core/scene';
import { detectCncDefaultFeedWarnings } from './cnc-default-feed-warnings';

function cncProjectWithLayerCnc(cnc: CncLayerSettings | undefined): Project {
  const layer = { ...createLayer({ id: 'L1', color: '#ff0000' }), ...(cnc ? { cnc } : {}) };
  return {
    ...createProject(),
    machine: DEFAULT_CNC_MACHINE_CONFIG,
    scene: { objects: [], layers: [layer] },
  };
}

describe('detectCncDefaultFeedWarnings', () => {
  it('warns for the out-of-box default layer (no material, untouched starter feeds)', () => {
    // No layer.cnc → the compile fallback DEFAULT_CNC_LAYER_SETTINGS applies:
    // feed 1000 / 1.5 mm-per-pass, no materialKey.
    const warnings = detectCncDefaultFeedWarnings(cncProjectWithLayerCnc(undefined));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('generic starter feeds');
  });

  it('is silent once a material is picked', () => {
    const cnc = { ...DEFAULT_CNC_LAYER_SETTINGS, materialKey: 'softwood-mdf' };
    expect(detectCncDefaultFeedWarnings(cncProjectWithLayerCnc(cnc))).toEqual([]);
  });

  it('is silent once the feed is edited off the starter value', () => {
    const cnc = { ...DEFAULT_CNC_LAYER_SETTINGS, feedMmPerMin: 1400 };
    expect(detectCncDefaultFeedWarnings(cncProjectWithLayerCnc(cnc))).toEqual([]);
  });

  it('is silent for a non-output layer', () => {
    const layer = { ...createLayer({ id: 'L1', color: '#ff0000' }), output: false };
    const project: Project = {
      ...createProject(),
      machine: DEFAULT_CNC_MACHINE_CONFIG,
      scene: { objects: [], layers: [layer] },
    };
    expect(detectCncDefaultFeedWarnings(project)).toEqual([]);
  });

  it('is silent for a laser project', () => {
    expect(detectCncDefaultFeedWarnings(createProject())).toEqual([]);
  });
});
