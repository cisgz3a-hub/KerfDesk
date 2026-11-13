// CNC audit v3 N6 (ADR-233 Amendment 1): runCncPreflight's spindle and
// stage-recipe feed checks (cnc-rate-issues.ts).
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  createLayer,
  createProject,
  type CncLayerSettings,
  type Project,
} from '../scene';
import { COMPILE_INTEGRITY_PREFLIGHT_CODES } from './blocking-codes';
import { runCncPreflight } from './cnc-preflight';

const config = DEFAULT_CNC_MACHINE_CONFIG;
const GOOD_GCODE =
  'G21\nG90\nM3 S12000\nG0 Z5\nG0 X10 Y10\nG1 Z-1 F300\nG1 X20 Y10 F1000\nG0 Z5\nM5';

function projectWithCnc(cnc: Partial<CncLayerSettings> = {}): Project {
  const base = createProject();
  const layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...cnc },
  };
  return { ...base, scene: { ...base.scene, layers: [layer] } };
}

describe('runCncPreflight spindle and recipe rates', () => {
  // CNC audit v3 N6r-P2-1: this was an advisory, so Save and Start sent M3 S0
  // and cut. It is compile integrity now (ADR-233 Amd 1).
  it('refuses a non-positive spindle speed as compile integrity', () => {
    const result = runCncPreflight(projectWithCnc({ spindleRpm: 0 }), config, GOOD_GCODE);
    const issue = result.issues.find((candidate) => candidate.code === 'cnc-spindle-off');
    expect(issue?.message).toContain('has a spindle speed of 0 RPM');
    expect(COMPILE_INTEGRITY_PREFLIGHT_CODES.has('cnc-spindle-off')).toBe(true);
  });

  // CNC audit v3 N6-P3-1: the compiler caps a recipe's feed as it does the
  // layer's, so a recipe the job can run gets the same advisory.
  it('gives a stage recipe feed above CNC Max feed the layer advisory', () => {
    const toolId = config.tools[0]!.id;
    const result = runCncPreflight(
      projectWithCnc({
        stageRecipes: {
          'profile-finish': {
            toolId,
            depthPerPassMm: 1,
            feedMmPerMin: 9000,
            plungeMmPerMin: 8000,
            spindleRpm: 12000,
          },
        },
      }),
      config,
      GOOD_GCODE,
    );
    const messages = result.issues.map((issue) => issue.message);
    expect(messages).toContain(
      'The Wall finishing recipe on layer "Operation": feed 9000 mm/min is outside (0, 6000].',
    );
    expect(messages).toContain(
      'The Wall finishing recipe on layer "Operation": plunge rate 8000 mm/min is outside (0, 6000].',
    );
  });
});
