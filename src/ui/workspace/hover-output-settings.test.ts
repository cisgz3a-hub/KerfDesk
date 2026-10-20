import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createLayerSubLayer,
  createProject,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { hoverOutputSettings } from './hover-output-settings';

function vector(colors: ReadonlyArray<string>, extra: Partial<SceneObject> = {}): SceneObject {
  return {
    kind: 'imported-svg',
    id: 'A1',
    source: 'plate.svg',
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: colors.map((color) => ({
      color,
      polylines: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
          ],
        },
      ],
    })),
    ...extra,
  } as SceneObject;
}

function bitmap(extra: Partial<SceneObject> = {}): SceneObject {
  return {
    kind: 'raster-image',
    id: 'B1',
    source: 'photo.png',
    dataUrl: 'data:,',
    pixelWidth: 10,
    pixelHeight: 10,
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    color: '#ff0000',
    dither: 'grayscale',
    linesPerMm: 10,
    ...extra,
  } as SceneObject;
}

function projectWith(layers: ReadonlyArray<Layer>, object: SceneObject): Project {
  const base = createProject();
  return { ...base, scene: { ...base.scene, layers: [...layers], objects: [object] } };
}

function operation(id: string, color: string, settings: Partial<Layer>): Layer {
  return { ...createLayer({ id, color }), ...settings };
}

const RED = operation('red', '#ff0000', { power: 40, speed: 1200 });

describe('hoverOutputSettings', () => {
  it("reports the operation's power and speed", () => {
    const object = vector(['#ff0000']);
    expect(hoverOutputSettings(projectWith([RED], object), object)).toEqual({
      kind: 'runs',
      lines: [{ color: '#ff0000', power: '40%', speed: '1200 mm/min' }],
      more: 0,
    });
  });

  it('reads speed in in/min with Inches on, as the layer Speed box does (ADR-629)', () => {
    const object = vector(['#ff0000']);
    const project = projectWith([RED], object);
    expect(hoverOutputSettings(project, object, 'in')).toMatchObject({
      lines: [{ power: '40%', speed: '47.2 in/min' }],
    });
    const fast = operation('red', '#ff0000', { power: 40, speed: 99_000 });
    const capped = projectWith([fast], object);
    const maxInPerMin = Number((capped.device.maxFeed / 25.4).toFixed(1));
    expect(hoverOutputSettings(capped, object, 'in')).toMatchObject({
      lines: [{ speed: `${maxInPerMin} in/min (capped)` }],
    });
  });

  it('applies the artwork override and power scale, as output does', () => {
    const object = vector(['#ff0000'], {
      powerScale: 50,
      operationOverride: { power: 80, speed: 900 },
    });
    const settings = hoverOutputSettings(projectWith([RED], object), object);
    expect(settings).toMatchObject({ lines: [{ power: '40%', speed: '900 mm/min' }] });
  });

  it('shows a Grayscale image as its power range, and a speed past Output max feed as capped', () => {
    const image = operation('red', '#ff0000', {
      mode: 'image',
      ditherAlgorithm: 'grayscale',
      minPower: 10,
      power: 60,
      speed: 99_000,
    });
    const object = bitmap();
    const project = projectWith([image], object);
    expect(hoverOutputSettings(project, object)).toMatchObject({
      lines: [{ power: '10–60%', speed: `${project.device.maxFeed} mm/min (capped)` }],
    });
  });

  it('shows a dithered image at its peak only, since a dither burns full power or none', () => {
    const object = bitmap();
    for (const ditherAlgorithm of ['threshold', 'ordered', 'floyd-steinberg'] as const) {
      const image = operation('red', '#ff0000', {
        mode: 'image',
        ditherAlgorithm,
        minPower: 10,
        power: 60,
      });
      expect(hoverOutputSettings(projectWith([image], object), object)).toMatchObject({
        lines: [{ power: '60%' }],
      });
    }
    // "Use original pixels" burns as Grayscale whatever dither is stored.
    const original = operation('red', '#ff0000', {
      mode: 'image',
      ditherAlgorithm: 'threshold',
      passThrough: true,
      minPower: 10,
      power: 60,
    });
    expect(hoverOutputSettings(projectWith([original], object), object)).toMatchObject({
      lines: [{ power: '10–60%' }],
    });
  });

  it('says a piece on an operation of the wrong mode is not engraved', () => {
    const vectorOnImage = vector(['#ff0000']);
    const image = operation('red', '#ff0000', { mode: 'image', minPower: 10 });
    expect(hoverOutputSettings(projectWith([image], vectorOnImage), vectorOnImage)).toEqual({
      kind: 'note',
      text: 'Not engraved: operation is in Image mode',
    });
    const bitmapOnFill = bitmap();
    const fill = operation('red', '#ff0000', { mode: 'fill' });
    expect(hoverOutputSettings(projectWith([fill], bitmapOnFill), bitmapOnFill)).toEqual({
      kind: 'note',
      text: 'Not engraved: operation is in Fill mode',
    });
    // An artwork override that switches the mode counts, as it does in compile.
    const overridden = vector(['#ff0000'], { operationOverride: { mode: 'image' } });
    expect(hoverOutputSettings(projectWith([RED], overridden), overridden)).toMatchObject({
      kind: 'note',
    });
  });

  it('lists each enabled sub-operation, and leaves out a disabled one', () => {
    const withPasses: Layer = {
      ...RED,
      subLayers: [
        createLayerSubLayer(RED, {
          id: 'clean',
          label: 'Clean-up',
          settings: { ...RED, power: 15, speed: 3000 },
        }),
        createLayerSubLayer(RED, {
          id: 'off',
          label: 'Off',
          enabled: false,
          settings: { ...RED, power: 99, speed: 100 },
        }),
      ],
    };
    const object = vector(['#ff0000']);
    expect(hoverOutputSettings(projectWith([withPasses], object), object)).toMatchObject({
      lines: [
        { power: '40%', speed: '1200 mm/min' },
        { power: '15%', speed: '3000 mm/min' },
      ],
      more: 0,
    });
  });

  it('collapses identical settings and keeps the readout to three lines', () => {
    const colors = ['#000001', '#000002', '#000003', '#000004', '#000005'];
    const layers = colors.map((color, index) =>
      operation(`op${index}`, color, { power: index === 1 ? 10 : 10 + index, speed: 1000 }),
    );
    const object = vector(colors);
    // op0 and op1 share 10% at 1000 mm/min: four distinct lines, three shown.
    expect(hoverOutputSettings(projectWith(layers, object), object)).toMatchObject({
      lines: [{ power: '10%' }, { power: '12%' }, { power: '13%' }],
      more: 1,
    });
  });

  it('says so when the piece has no operation or its output is off', () => {
    const object = vector(['#00ff00']);
    expect(hoverOutputSettings(projectWith([RED], object), object)).toEqual({
      kind: 'note',
      text: 'No operation',
    });
    const red = vector(['#ff0000']);
    expect(hoverOutputSettings(projectWith([{ ...RED, output: false }], red), red)).toEqual({
      kind: 'note',
      text: 'Output off',
    });
  });

  it("does not show power for a trace's source bitmap, which output skips", () => {
    const source: SceneObject = {
      kind: 'raster-image',
      id: 'S1',
      source: 'photo.png',
      role: 'trace-source',
      dataUrl: 'data:,',
      pixelWidth: 10,
      pixelHeight: 10,
      bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
      transform: IDENTITY_TRANSFORM,
      color: '#ff0000',
      dither: 'grayscale',
      linesPerMm: 10,
    };
    const image = operation('red', '#ff0000', { mode: 'image' });
    expect(hoverOutputSettings(projectWith([image], source), source)).toEqual({
      kind: 'note',
      text: 'Trace source, not output',
    });
  });

  it('stays out of the way on a CNC machine', () => {
    const object = vector(['#ff0000']);
    const project = { ...projectWith([RED], object), machine: DEFAULT_CNC_MACHINE_CONFIG };
    expect(hoverOutputSettings(project, object)).toBeNull();
  });
});
