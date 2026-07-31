import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
  type Layer,
  type SceneObject,
} from '../scene';
import { createRectangle } from '../shapes/primitives';
import { runPreEmitPreflight } from './pre-emit';

const VCARVE_COLOR = '#ff0000';
const ANGLELESS_V_BIT: CncTool = {
  id: 'angleless-v-bit',
  name: 'Legacy angleless V-bit',
  kind: 'v-bit',
  diameterMm: 3,
};

function anglelessMachine(
  patch: Partial<CncTool> = {},
  extraTools: ReadonlyArray<CncTool> = [],
): CncMachineConfig {
  return {
    ...DEFAULT_CNC_MACHINE_CONFIG,
    toolId: ANGLELESS_V_BIT.id,
    tools: [{ ...ANGLELESS_V_BIT, ...patch }, ...extraTools],
  };
}

function vcarveLayer(id: string, settings: Partial<CncLayerSettings> = {}, output = true): Layer {
  return {
    ...createLayer({ id, color: VCARVE_COLOR }),
    output,
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'v-carve', ...settings },
  };
}

function rectangle(id: string, color: string, sizeMm: number): SceneObject {
  return createRectangle({
    id,
    color,
    spec: { widthMm: sizeMm, heightMm: sizeMm, cornerRadiusMm: 0 },
  });
}

function preflight(
  layers: ReadonlyArray<Layer>,
  objects: ReadonlyArray<SceneObject>,
  machine = anglelessMachine(),
) {
  const base = createProject();
  return runPreEmitPreflight({
    ...base,
    machine,
    scene: { ...base.scene, layers, objects },
  });
}

describe('invalid CNC tool geometry preflight', () => {
  it('refuses contributing V-carve geometry but ignores the same output-disabled layer', () => {
    const layer = vcarveLayer('v-carve');
    const object = rectangle('v-carve-square', VCARVE_COLOR, 20);

    expect(preflight([layer], [object])).toEqual({
      ok: false,
      issues: [
        {
          code: 'cnc-tool-geometry-invalid',
          message:
            'Layer v-carve: V-carve requires an explicit included angle from 1 to 179 degrees for "Legacy angleless V-bit". Edit or replace this bit before generating toolpaths.',
        },
      ],
    });
    expect(preflight([{ ...layer, output: false }], [object])).toEqual({ ok: true, issues: [] });
  });

  it('does not let an unused or too-narrow single-stage V-carve block output', () => {
    const validColor = '#00ff00';
    const validLayer = createLayer({ id: 'valid', color: validColor });
    const unusedVCarve = vcarveLayer('unused-v-carve');
    const validObject = rectangle('valid-square', validColor, 20);

    expect(preflight([validLayer, unusedVCarve], [validObject])).toEqual({
      ok: true,
      issues: [],
    });
    expect(preflight([unusedVCarve], [rectangle('too-narrow-v-carve', VCARVE_COLOR, 0.1)])).toEqual(
      { ok: true, issues: [] },
    );
  });

  it('does not mistake invalid pass depth or diameter for proof that no pass can emit', () => {
    const object = rectangle('v-carve-square', VCARVE_COLOR, 20);
    expect(preflight([vcarveLayer('v-carve', { depthPerPassMm: 0 })], [object])).toMatchObject({
      ok: false,
      issues: [{ code: 'cnc-tool-geometry-invalid' }],
    });
    expect(
      preflight(
        [vcarveLayer('v-carve', { vResolutionMm: 0.5 })],
        [object],
        anglelessMachine({ diameterMm: Number.NaN }),
      ),
    ).toMatchObject({ ok: false, issues: [{ code: 'cnc-tool-geometry-invalid' }] });
  });

  it('refuses when an angleless narrow V-carve can still emit its clearing stage', () => {
    const clearTool: CncTool = {
      id: 'tiny-clear',
      name: 'Tiny clearing bit',
      kind: 'end-mill',
      diameterMm: 0.01,
    };
    const layer = vcarveLayer('two-stage-v-carve', {
      depthMm: 0.1,
      vResolutionMm: 0.1,
      vClearToolId: clearTool.id,
    });

    expect(
      preflight(
        [layer],
        [rectangle('narrow-v-carve', VCARVE_COLOR, 0.1)],
        anglelessMachine({}, [clearTool]),
      ),
    ).toMatchObject({ ok: false, issues: [{ code: 'cnc-tool-geometry-invalid' }] });
  });
});
