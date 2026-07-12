import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  createProject,
  type CncLayerSettings,
  type Project,
  type SceneObject,
} from '../scene';
import { runCncPreflight } from './cnc-preflight';

const config = DEFAULT_CNC_MACHINE_CONFIG;

const GOOD_GCODE = [
  'G21',
  'G90',
  'G94',
  'M3 S12000',
  'G0 Z3.810',
  'G0 X10.000 Y10.000',
  'G1 Z-1.000 F300',
  'G1 X20.000 Y10.000 F1000',
  'G0 Z3.810',
  'M5',
  'G0 X0.000 Y0.000',
].join('\n');

function projectWithCnc(cnc: Partial<CncLayerSettings> = {}): Project {
  const base = createProject();
  const layer = {
    ...createLayer({ id: 'L1', color: '#ff0000' }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, ...cnc },
  };
  return { ...base, scene: { ...base.scene, layers: [layer] } };
}

function squareObject(id: string, color: string, size: number): SceneObject {
  const points = [
    { x: 50, y: 50 },
    { x: 50 + size, y: 50 },
    { x: 50 + size, y: 50 + size },
    { x: 50, y: 50 + size },
  ];
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: 50, minY: 50, maxX: 50 + size, maxY: 50 + size },
    transform: IDENTITY_TRANSFORM,
    paths: [{ color, polylines: [{ closed: true, points }] }],
  };
}

describe('runCncPreflight', () => {
  it('blocks rest machining when the roughing bit is not larger', () => {
    const base = projectWithCnc({
      cutType: 'pocket',
      pocketRoughToolId: 'em-1588',
    });
    const project: Project = {
      ...base,
      scene: { ...base.scene, objects: [squareObject('O1', '#ff0000', 20)] },
    };
    const result = runCncPreflight(project, config, GOOD_GCODE);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'cnc-rest-machining-invalid',
        message: expect.stringContaining('must be larger'),
      }),
    );
  });

  it('accepts a valid larger-rougher and smaller-rest-bit pocket setup', () => {
    const base = projectWithCnc({
      cutType: 'pocket',
      toolId: 'em-1588',
      pocketRoughToolId: 'em-6350',
    });
    const project: Project = {
      ...base,
      scene: { ...base.scene, objects: [squareObject('O1', '#ff0000', 20)] },
    };
    const result = runCncPreflight(project, config, GOOD_GCODE);
    expect(result.issues.some((issue) => issue.code === 'cnc-rest-machining-invalid')).toBe(false);
  });

  it('blocks the temporary rest-machining and helical-entry conflict', () => {
    const base = projectWithCnc({
      cutType: 'pocket',
      toolId: 'em-1588',
      pocketRoughToolId: 'em-6350',
      helixEntry: { minDiameterMm: 2, maxDiameterMm: 8, angleDeg: 3 },
    });
    const project: Project = {
      ...base,
      scene: { ...base.scene, objects: [squareObject('O1', '#ff0000', 20)] },
    };
    const result = runCncPreflight(project, config, GOOD_GCODE);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'cnc-rest-machining-invalid',
        message: expect.stringContaining('cannot be combined'),
      }),
    );
  });

  it('blocks a requested helix that cannot fit instead of silently plunging', () => {
    const base = projectWithCnc({
      cutType: 'pocket',
      helixEntry: { minDiameterMm: 50, maxDiameterMm: 60, angleDeg: 3 },
    });
    const project: Project = {
      ...base,
      scene: { ...base.scene, objects: [squareObject('O1', '#ff0000', 20)] },
    };
    const result = runCncPreflight(project, config, GOOD_GCODE);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'cnc-helix-entry-invalid',
        message: expect.stringContaining('does not fit'),
      }),
    );
  });

  it('blocks helical entry with a raster pocket strategy', () => {
    const base = projectWithCnc({
      cutType: 'pocket',
      pocketStrategy: 'raster-x',
      helixEntry: { minDiameterMm: 2, maxDiameterMm: 8, angleDeg: 3 },
    });
    const project: Project = {
      ...base,
      scene: { ...base.scene, objects: [squareObject('O1', '#ff0000', 20)] },
    };
    const result = runCncPreflight(project, config, GOOD_GCODE);
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'cnc-helix-entry-invalid',
        message: expect.stringContaining('Offset pocket fill'),
      }),
    );
  });

  it('flags a layer whose shapes are too narrow for the bit instead of dropping it silently', () => {
    // Default bit is 3.175 mm: a 2 mm pocket offsets away entirely and used
    // to vanish from the job with no message while other layers still cut.
    const base = createProject();
    const big = {
      ...createLayer({ id: 'big', color: '#ff0000' }),
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'pocket' as const },
    };
    const tiny = {
      ...createLayer({ id: 'tiny', color: '#0000ff' }),
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'pocket' as const },
    };
    const project: Project = {
      ...base,
      scene: {
        ...base.scene,
        objects: [squareObject('O1', '#ff0000', 40), squareObject('O2', '#0000ff', 2)],
        layers: [big, tiny],
      },
    };

    const result = runCncPreflight(project, config, GOOD_GCODE);

    const dropped = result.issues.filter((issue) => issue.code === 'cnc-layer-empty');
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.message).toContain('tiny');
  });

  it('passes a sane project and safe G-code', () => {
    const result = runCncPreflight(projectWithCnc(), config, GOOD_GCODE);
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('flags a missing output layer', () => {
    const base = createProject();
    const result = runCncPreflight(base, config, GOOD_GCODE);
    expect(result.issues.some((issue) => issue.code === 'no-output-layer')).toBe(true);
  });

  it('flags non-positive depths', () => {
    const result = runCncPreflight(projectWithCnc({ depthMm: 0 }), config, GOOD_GCODE);
    expect(result.issues.some((issue) => issue.code === 'cnc-settings-invalid')).toBe(true);
  });

  it('flags a spindle speed above the machine maximum', () => {
    const result = runCncPreflight(projectWithCnc({ spindleRpm: 99999 }), config, GOOD_GCODE);
    expect(result.issues.some((issue) => issue.code === 'cnc-settings-invalid')).toBe(true);
  });

  it('flags v-carve when the active bit is not a v-bit (H.3)', () => {
    // Default config's active tool is the 1/8 in end mill.
    const result = runCncPreflight(projectWithCnc({ cutType: 'v-carve' }), config, GOOD_GCODE);
    expect(result.issues.some((issue) => issue.message.includes('V-carve requires a v-bit'))).toBe(
      true,
    );
    expect(result.ok).toBe(false);
  });

  it('accepts v-carve when a v-bit is active (H.3)', () => {
    const vbitConfig = { ...config, toolId: 'vb-60' };
    const result = runCncPreflight(projectWithCnc({ cutType: 'v-carve' }), vbitConfig, GOOD_GCODE);
    expect(result.issues.some((issue) => issue.message.includes('V-carve requires'))).toBe(false);
  });

  it('flags emitted Z below the stock floor even when settings look sane (H.1)', () => {
    // Settings say 1 mm deep, but the emitted text plunges through the
    // spoilboard — the text-level invariant catches what settings cannot.
    const overdeep = GOOD_GCODE.replace('G1 Z-1.000 F300', 'G1 Z-99.000 F300');
    const result = runCncPreflight(projectWithCnc({ depthMm: 1 }), config, overdeep);
    expect(result.issues.some((issue) => issue.code === 'cnc-overdeep-cut')).toBe(true);
    expect(result.ok).toBe(false);
  });

  it('flags cut depth far beyond the stock thickness', () => {
    const result = runCncPreflight(projectWithCnc({ depthMm: 20 }), config, GOOD_GCODE);
    expect(result.issues.some((issue) => issue.code === 'cnc-depth-exceeds-stock')).toBe(true);
  });

  it('allows a through-cut slightly past the stock bottom', () => {
    const depthMm = config.stock.thicknessMm + 0.5;
    const result = runCncPreflight(projectWithCnc({ depthMm }), config, GOOD_GCODE);
    expect(result.issues.some((issue) => issue.code === 'cnc-depth-exceeds-stock')).toBe(false);
  });

  it('flags plunged XY rapids in the emitted motion', () => {
    const plunged = ['G0 Z3.810', 'G1 Z-2.000 F300', 'G0 X50.000 Y50.000', 'G1 X1 Y1 F100'].join(
      '\n',
    );
    const result = runCncPreflight(projectWithCnc(), config, plunged);
    expect(result.issues.some((issue) => issue.code === 'plunged-travel')).toBe(true);
  });

  it('flags out-of-bed motion', () => {
    const outOfBed = GOOD_GCODE.replace('G1 X20.000 Y10.000 F1000', 'G1 X9999.000 Y10.000 F1000');
    const result = runCncPreflight(projectWithCnc(), config, outOfBed);
    expect(result.issues.some((issue) => issue.code === 'out-of-bed')).toBe(true);
  });

  it('flags empty output', () => {
    const result = runCncPreflight(projectWithCnc(), config, 'G21\nM5');
    expect(result.issues.some((issue) => issue.code === 'empty-output')).toBe(true);
  });
});
