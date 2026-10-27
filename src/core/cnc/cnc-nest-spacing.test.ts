import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  type CncCutType,
  type Project,
} from '../scene';
import { cncNestSpacing } from './cnc-nest-spacing';

const QUARTER_INCH = { id: 'em-6350', name: '1/4" end mill', kind: 'end-mill', diameterMm: 6.35 };

function cncProject(layers: ReadonlyArray<{ cutType: CncCutType; toolId?: string }>): Project {
  const base = createProject(DEFAULT_DEVICE_PROFILE);
  return {
    ...base,
    machine: {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      tools: [...DEFAULT_CNC_MACHINE_CONFIG.tools, { ...QUARTER_INCH, kind: 'end-mill' }],
    },
    scene: {
      ...base.scene,
      layers: layers.map((layer, index) => ({
        ...createLayer({ id: `l${index}`, color: `#00000${index}` }),
        cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...layer },
      })),
    },
  };
}

describe('cncNestSpacing (ADR-433 Amendment 4)', () => {
  it('is the 1/8" profile bit plus 1 mm, rounded up to 0.1 mm', () => {
    expect(cncNestSpacing(cncProject([{ cutType: 'profile-outside' }]))).toEqual({
      bitDiameterMm: 3.175,
      spacingMm: 4.2,
    });
  });

  it('takes the widest bit that cuts on or outside an outline', () => {
    const project = cncProject([
      { cutType: 'profile-on-path', toolId: 'em-6350' },
      { cutType: 'profile-outside' },
    ]);
    expect(cncNestSpacing(project)?.spacingMm).toBe(7.4);
  });

  it('ignores bits that stay inside the parts', () => {
    const project = cncProject([
      { cutType: 'pocket', toolId: 'em-6350' },
      { cutType: 'profile-inside', toolId: 'em-6350' },
    ]);
    expect(cncNestSpacing(project)).toBeNull();
  });

  it('ignores a profile layer that does not output', () => {
    const project = cncProject([{ cutType: 'profile-outside', toolId: 'em-6350' }]);
    const muted: Project = {
      ...project,
      scene: {
        ...project.scene,
        layers: project.scene.layers.map((layer) => ({ ...layer, output: false })),
      },
    };
    expect(cncNestSpacing(muted)).toBeNull();
  });

  it('has nothing to say for a laser project', () => {
    expect(cncNestSpacing(createProject(DEFAULT_DEVICE_PROFILE))).toBeNull();
  });
});
