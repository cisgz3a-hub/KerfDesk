import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../../core/devices';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { detectJobIntentWarnings } from './job-intent-warnings';

const traced: SceneObject = {
  kind: 'traced-image',
  id: 'trace-1',
  source: 'logo.png',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

function projectWith(object: SceneObject, mode: 'line' | 'fill' | 'image'): Project {
  return {
    ...createProject(),
    scene: {
      ...EMPTY_SCENE,
      objects: [object],
      layers: [{ ...createLayer({ id: 'L1', color: '#ff0000' }), mode }],
    },
  };
}

function lumaBase64(width: number, height: number): string {
  return Buffer.from(new Uint8Array(width * height).fill(255)).toString('base64');
}

const smallRaster: SceneObject = {
  kind: 'raster-image',
  id: 'R1',
  source: 'photo.png',
  dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  lumaBase64: lumaBase64(100, 100),
  pixelWidth: 100,
  pixelHeight: 100,
  // 100 px of stored detail over 50 mm: fine at 10 lines/mm (500 px grid →
  // upsampled 5×).
  bounds: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
  transform: IDENTITY_TRANSFORM,
  color: '#ff0000',
  dither: 'threshold',
  linesPerMm: 10,
};

const tinyIsland: SceneObject = {
  kind: 'imported-svg',
  id: 'tiny-island',
  source: 'tiny-island.svg',
  bounds: { minX: 0, minY: 0, maxX: 3, maxY: 3 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 3, y: 0 },
            { x: 3, y: 3 },
            { x: 0, y: 3 },
          ],
          closed: true,
        },
      ],
    },
  ],
};

const largeIsland: SceneObject = {
  ...tinyIsland,
  id: 'large-island',
  bounds: { minX: 0, minY: 0, maxX: 30, maxY: 30 },
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 30, y: 0 },
            { x: 30, y: 30 },
            { x: 0, y: 30 },
          ],
          closed: true,
        },
      ],
    },
  ],
};

describe('detectJobIntentWarnings', () => {
  // H12 (AUDIT-2026-06-10): the engrave luma is extracted from the
  // 2048-px-capped decode (ADR-037, a TRACE runtime cap), and compile
  // nearest-neighbor UPSAMPLES it to the burn grid — silently, while the
  // canvas shows the sharp full-res bitmap. Surface the mismatch.
  it('warns when the burn grid exceeds the stored image resolution (silent upsample)', () => {
    const warnings = detectJobIntentWarnings(projectWith(smallRaster, 'image'));
    expect(
      warnings.some(
        (w) => w.includes('photo.png') && w.includes('100 × 100 px') && w.includes('500 × 500 px'),
      ),
    ).toBe(true);
  });

  it('does not warn when the stored resolution covers the burn grid', () => {
    const denseRaster: SceneObject = {
      ...smallRaster,
      lumaBase64: lumaBase64(600, 600),
      pixelWidth: 600,
      pixelHeight: 600,
    };
    const warnings = detectJobIntentWarnings(projectWith(denseRaster, 'image'));
    expect(warnings.some((w) => w.includes('photo.png'))).toBe(false);
  });

  it('does not emit the upsample warning for pass-through layers', () => {
    const project = projectWith(smallRaster, 'image');
    const layer = project.scene.layers[0];
    const passThroughProject: Project = {
      ...project,
      scene: {
        ...project.scene,
        layers: layer === undefined ? project.scene.layers : [{ ...layer, passThrough: true }],
      },
    };
    const warnings = detectJobIntentWarnings(passThroughProject);
    expect(warnings.some((w) => w.includes('photo.png'))).toBe(false);
  });

  it('warns when output layers still use uncalibrated first-run power and speed defaults', () => {
    expect(detectJobIntentWarnings(projectWith(traced, 'line'))).toContain(
      'Operation "Operation" is still using the uncalibrated defaults (30% power, 1500 mm/min, 1 pass). Run a material test on scrap before burning final material.',
    );
  });

  it('warns when a traced image will run as vector Line output, not raster engraving', () => {
    expect(detectJobIntentWarnings(projectWith(traced, 'line'))).toContain(
      'Trace "logo.png" is vector Line output, not raster image engraving. It will run as M3 constant-power vector moves and can cut if power/speed are too aggressive.',
    );
  });

  it('warns when a traced image will run as vector Fill output, not raster engraving', () => {
    expect(detectJobIntentWarnings(projectWith(traced, 'fill'))).toContain(
      'Trace "logo.png" is vector Fill output, not raster image engraving. It will run as M4 dynamic-power fill sweeps from traced vector geometry; tiny traced text can stay wavy if the source outline is poor.',
    );
  });

  it('warns when Island Fill has short sweeps that need partial acceleration runway', () => {
    const project = projectWith(tinyIsland, 'fill');
    const layer = project.scene.layers[0];
    const islandProject: Project = {
      ...project,
      scene: {
        ...project.scene,
        layers:
          layer === undefined
            ? project.scene.layers
            : [{ ...layer, fillStyle: 'island', fillOverscanMm: 5, hatchSpacingMm: 1 }],
      },
    };

    expect(detectJobIntentWarnings(islandProject)).toContain(
      'Island Fill has 3 short sweep(s) that need partial acceleration runway. KerfDesk will add capped laser-off runway, but test on scrap if those small islands look darker than the rest.',
    );
  });

  it('warns when the 4040-safe Island Fill motion policy is active', () => {
    const project = projectWith(largeIsland, 'fill');
    const layer = project.scene.layers[0];
    const islandProject: Project = {
      ...project,
      device: NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      scene: {
        ...project.scene,
        layers:
          layer === undefined
            ? project.scene.layers
            : [{ ...layer, fillStyle: 'island', fillOverscanMm: 5, hatchSpacingMm: 1 }],
      },
    };

    expect(detectJobIntentWarnings(islandProject)).toContain(
      '4040-safe Island Fill is active. KerfDesk will use local clustered, unidirectional sweeps with full laser-off runway; this may run slower but is safer for sensitive motion.',
    );
  });

  it('warns that fine-detail 4040 Island Fill can darken small islands even with overscan', () => {
    const project = projectWith(tinyIsland, 'fill');
    const layer = project.scene.layers[0];
    const islandProject: Project = {
      ...project,
      device: NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      scene: {
        ...project.scene,
        layers:
          layer === undefined
            ? project.scene.layers
            : [{ ...layer, fillStyle: 'island', fillOverscanMm: 5, hatchSpacingMm: 1 }],
      },
    };

    expect(detectJobIntentWarnings(islandProject)).toContain(
      '4040-safe Island Fill has 3 short sweep(s) that can overburn or darken small details even with full laser-off runway. Use Scanline Fill for final 4040 burns until Island Fill is calibrated for this machine.',
    );
    expect(detectJobIntentWarnings(islandProject)).not.toContain(
      '4040-safe Island Fill is active. KerfDesk will use local clustered, unidirectional sweeps with full laser-off runway; this may run slower but is safer for sensitive motion.',
    );
  });

  it('does not emit a vector-trace warning for image-mode layers', () => {
    expect(detectJobIntentWarnings(projectWith(traced, 'image'))).not.toContain(
      'Trace "logo.png" is vector Line output, not raster image engraving. It will run as M3 constant-power vector moves and can cut if power/speed are too aggressive.',
    );
  });

  it('does not warn about calibration after the operator changes the default layer recipe', () => {
    const project = {
      ...projectWith(traced, 'line'),
      scene: {
        ...projectWith(traced, 'line').scene,
        layers: [{ ...createLayer({ id: 'L1', color: '#ff0000' }), power: 10 }],
      },
    };

    expect(detectJobIntentWarnings(project).some((w) => w.includes('uncalibrated'))).toBe(false);
  });
});
