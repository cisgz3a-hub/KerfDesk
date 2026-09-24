import { describe, expect, it } from 'vitest';
import { Buffer } from 'node:buffer';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE, type DeviceProfile } from '../../core/devices';
import { FALCON_COMPATIBLE_PROFILE } from '../../core/devices/falcon-profiles';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type RasterImage,
} from '../../core/scene';
import { detectJobIntentWarnings } from './job-intent-warnings';

const COLOR = '#ff0000';

function wing(pixelsPerMm: number): RasterImage {
  const widthMm = 20;
  const heightMm = 10;
  const width = widthMm * pixelsPerMm;
  const height = heightMm * pixelsPerMm;
  return {
    kind: 'raster-image',
    id: 'wing',
    source: 'wing.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    lumaBase64: Buffer.from(new Uint8Array(width * height).fill(0)).toString('base64'),
    pixelWidth: width,
    pixelHeight: height,
    bounds: { minX: 0, minY: 0, maxX: widthMm, maxY: heightMm },
    transform: { ...IDENTITY_TRANSFORM, x: 20, y: 20 },
    color: COLOR,
    dither: 'floyd-steinberg',
    linesPerMm: 10,
  };
}

function imageProject(
  layer: Partial<Layer>,
  options: {
    readonly device?: DeviceProfile;
    readonly pixelsPerMm?: number;
    readonly objects?: ReadonlyArray<RasterImage>;
  } = {},
): Project {
  const base = createProject(options.device ?? NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE);
  return {
    ...base,
    scene: {
      ...EMPTY_SCENE,
      objects: options.objects ?? [wing(options.pixelsPerMm ?? 40)],
      layers: [
        {
          ...createLayer({ id: 'L1', color: COLOR, mode: 'image' }),
          name: 'Engrave',
          power: 30,
          speed: 2000,
          ...layer,
        },
      ],
    },
  };
}

function energyWarnings(project: Project): ReadonlyArray<string> {
  return detectJobIntentWarnings(project).filter((warning) => warning.includes('energy per area'));
}

function tunedPreset(settings: Partial<Layer>) {
  const base = createLayer({ id: 'L1', color: COLOR, mode: 'image' });
  return {
    libraryId: 'lib',
    presetId: 'birch-photo',
    lastResolved: { ...base, power: 30, speed: 2000, ...settings },
  };
}

describe('raster energy warnings', () => {
  it('warns that 25 lines/mm burns 2.5x the default energy, relative to the unknown tuning', () => {
    expect(energyWarnings(imageProject({ linesPerMm: 25 }))).toEqual([
      'Image "wing.png" on "Engrave" burns 25 lines/mm (rows 0.04 mm apart): 2.5× the energy per area of 10 lines/mm at the same power and speed. The 0.18 mm beam sweeps each point about 4.5 times, so fine white lines and dots fill in and the image burns darker than the canvas shows. If this power and speed were chosen for 10 lines/mm, use about 40% of that power or about 2.5× that speed, and confirm with an Interval Test.',
    ]);
  });

  it('offers only the power route when the matching speed would pass the machine max feed', () => {
    const warnings = energyWarnings(imageProject({ linesPerMm: 25, speed: 3000 }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(
      'use about 40% of that power, and confirm with an Interval Test.',
    );
    expect(warnings[0]).not.toContain('that speed');
  });

  it('stays quiet at the densities power and speed are normally tuned for', () => {
    expect(energyWarnings(imageProject({ linesPerMm: 10 }))).toEqual([]);
    expect(energyWarnings(imageProject({ linesPerMm: 14 }))).toEqual([]);
  });

  it('warns about Pass-Through, which burns at the source density past the lines/mm cap', () => {
    const warnings = energyWarnings(imageProject({ linesPerMm: 10, passThrough: true }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('burns 40 lines/mm (rows 0.025 mm apart): 4× the energy');
  });

  it('compares the whole dose with a linked image preset and gives the power that matches it', () => {
    const warnings = energyWarnings(
      imageProject({ linesPerMm: 25, materialBinding: tunedPreset({ linesPerMm: 10 }) }),
    );
    expect(warnings).toEqual([
      'Image "wing.png" on "Engrave" burns 2.5× the energy per area of its material preset: 25 lines/mm at 30% and 2000 mm/min, where the preset uses 10 lines/mm at 30% and 2000 mm/min. The 0.18 mm beam sweeps each point about 4.5 times, so fine white lines and dots fill in and the image burns darker than the canvas shows. To match the preset, lower power to about 12% or raise speed to about 5000 mm/min, and confirm with an Interval Test.',
    ]);
  });

  it('clears once power, speed or the preset itself already match the dose', () => {
    const at10 = tunedPreset({ linesPerMm: 10 });
    expect(
      energyWarnings(imageProject({ linesPerMm: 25, power: 12, materialBinding: at10 })),
    ).toEqual([]);
    expect(
      energyWarnings(imageProject({ linesPerMm: 25, speed: 5000, materialBinding: at10 })),
    ).toEqual([]);
    expect(
      energyWarnings(
        imageProject({ linesPerMm: 25, materialBinding: tunedPreset({ linesPerMm: 25 }) }),
      ),
    ).toEqual([]);
  });

  it('does not treat a Pass-Through or non-image preset as the dose reference', () => {
    const warnings = energyWarnings(
      imageProject({
        linesPerMm: 25,
        materialBinding: tunedPreset({ linesPerMm: 25, passThrough: true }),
      }),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('of 10 lines/mm at the same power and speed');
  });

  it('names the artwork override when that is the power to change', () => {
    const art = { ...wing(40), operationOverride: { power: 30 } };
    const warnings = energyWarnings(
      imageProject(
        { linesPerMm: 25, power: 50, materialBinding: tunedPreset({ linesPerMm: 10 }) },
        { objects: [art] },
      ),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("lower the artwork's power override to about 12%");
  });

  it('shows which setting departs from the preset when passes, not density, add the dose', () => {
    const warnings = energyWarnings(
      imageProject({ passes: 2, materialBinding: tunedPreset({ linesPerMm: 10 }) }),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(
      '2× the energy per area of its material preset: 10 lines/mm at 30% and 2000 mm/min, 2 passes, where the preset uses 10 lines/mm at 30% and 2000 mm/min.',
    );
  });

  it('comes before the older job warnings, so Save keeps showing those as its newest toasts', () => {
    // A 5 px/mm source at 25 lines/mm also raises the older upsample warning.
    const all = detectJobIntentWarnings(imageProject({ linesPerMm: 25 }, { pixelsPerMm: 5 }));
    const energy = all.findIndex((warning) => warning.includes('energy per area'));
    const older = all.findIndex(
      (warning) => !warning.includes('energy per area') && !warning.includes('uses Threshold'),
    );
    expect(energy).toBe(0);
    expect(older).toBeGreaterThan(energy);
  });

  it('says it once for copies of one image and nothing at zero power', () => {
    const copies = [wing(40), { ...wing(40), id: 'wing-2' }];
    expect(energyWarnings(imageProject({ linesPerMm: 25 }, { objects: copies }))).toHaveLength(1);
    expect(energyWarnings(imageProject({ linesPerMm: 25, power: 0 }))).toEqual([]);
  });

  it('omits the beam overlap when the machine profile has no spot size', () => {
    const warnings = energyWarnings(
      imageProject({ linesPerMm: 20 }, { device: FALCON_COMPATIBLE_PROFILE }),
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('2× the energy per area of 10 lines/mm');
    expect(warnings[0]).not.toContain('beam');
    expect(warnings[0]).toContain('at the same power and speed. Fine white lines');
  });
});
