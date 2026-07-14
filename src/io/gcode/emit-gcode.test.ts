import { describe, expect, it } from 'vitest';
import {
  addLayer,
  addObject,
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type OutputScope,
  type SceneObject,
} from '../../core/scene';
import { emitGcode } from './emit-gcode';

const sampleObject: SceneObject = {
  kind: 'imported-svg',
  id: 'O1',
  source: 'a.svg',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          points: [
            { x: 1, y: 1 },
            { x: 9, y: 9 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

describe('emitGcode', () => {
  it('returns gcode and a passing preflight for a well-formed project', () => {
    const base = createProject();
    const project = {
      ...base,
      scene: addLayer(
        addObject(base.scene, sampleObject),
        createLayer({ id: 'L1', color: '#ff0000' }),
      ),
    };
    const { gcode, preflight } = emitGcode(project);
    expect(preflight.ok).toBe(true);
    expect(gcode).toContain('G21');
    expect(gcode).toContain('G1');
  });

  it('prepends a provenance header only when metadata is passed (P0-A)', () => {
    const base = createProject();
    const project = {
      ...base,
      scene: addLayer(
        addObject(base.scene, sampleObject),
        createLayer({ id: 'L1', color: '#ff0000' }),
      ),
    };
    const withMeta = emitGcode(project, {
      metadata: {
        appName: 'KerfDesk',
        appVersion: '9.9.9',
        gitSha: 'deadbee',
        buildTimeUtc: '2026-06-03T00:00:00.000Z',
        emitterRevision: 'test-rev',
      },
    });
    const withoutMeta = emitGcode(project);
    // Header present and first; the motion body is unchanged after it.
    expect(withMeta.gcode.startsWith('; KerfDesk')).toBe(true);
    expect(withMeta.gcode).toContain('; commit: deadbee');
    expect(withMeta.gcode.endsWith(withoutMeta.gcode)).toBe(true);
    // No metadata => no header => deterministic body only.
    expect(withoutMeta.gcode.startsWith('G21')).toBe(true);
    // The header never changes the preflight verdict (comments are inert).
    expect(withMeta.preflight.ok).toBe(withoutMeta.preflight.ok);
  });

  it('refuses an oversized raster before compile, returning empty g-code (P1-A)', () => {
    const base = createProject();
    const color = '#808080';
    const raster: SceneObject = {
      kind: 'raster-image',
      id: 'R1',
      color,
      source: 'x.png',
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      pixelWidth: 4,
      pixelHeight: 4,
      dither: 'floyd-steinberg',
      linesPerMm: 25,
      bounds: { minX: 0, minY: 0, maxX: 300, maxY: 300 },
      transform: IDENTITY_TRANSFORM,
    };
    const project = {
      ...base,
      scene: addLayer(addObject(base.scene, raster), {
        ...createLayer({ id: color, color, mode: 'image' }),
        linesPerMm: 25,
      }),
    };
    const { gcode, preflight } = emitGcode(project);
    expect(preflight.ok).toBe(false);
    expect(preflight.issues.some((i) => i.code === 'raster-too-large')).toBe(true);
    // No compile ran, so nothing was allocated and no g-code was produced.
    expect(gcode).toBe('');
  });

  it('emits only selected artwork when Cut Selected Graphics is enabled', () => {
    const base = createProject();
    const project = {
      ...base,
      scene: {
        layers: [createLayer({ id: 'L1', color: '#ff0000' })],
        objects: [lineObject('A', 10), lineObject('B', 120)],
      },
    };

    const { gcode, preflight } = emitGcode(project, {
      outputScope: selectedScope(['B']),
    });

    expect(preflight.ok).toBe(true);
    expect(gcode).toContain('X120');
    expect(gcode).not.toContain('X10');
  });

  it('returns a failing preflight when the project has no output layers', () => {
    const project = createProject();
    const { preflight } = emitGcode(project);
    expect(preflight.ok).toBe(false);
    expect(preflight.issues.some((i) => i.code === 'no-output-layer')).toBe(true);
  });
});

function lineObject(id: string, x: number): SceneObject {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: x, minY: 0, maxX: x + 10, maxY: 0 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: '#ff0000',
        polylines: [
          {
            points: [
              { x, y: 0 },
              { x: x + 10, y: 0 },
            ],
            closed: false,
          },
        ],
      },
    ],
  };
}

function selectedScope(selectedObjectIds: ReadonlyArray<string>): OutputScope {
  return {
    cutSelectedGraphics: true,
    useSelectionOrigin: false,
    selectedObjectIds,
  };
}
