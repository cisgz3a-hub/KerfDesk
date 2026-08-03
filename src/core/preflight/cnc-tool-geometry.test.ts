import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
  type Layer,
  type ReliefObject,
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
// The shipped 'eng-15' starter was dropped (shank diameter recorded as a
// cutting diameter), but the engraving KIND is still user-creatable, so this
// case keeps its coverage with a locally defined cutter.
const LEGACY_ENGRAVING_TOOL: CncTool = {
  id: 'legacy-engraving',
  name: 'Legacy engraving bit',
  kind: 'engraving',
  diameterMm: 3.175,
  tipAngleDeg: 30,
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

function pocketLayer(id: string, settings: Partial<CncLayerSettings> = {}): Layer {
  return {
    ...createLayer({ id, color: VCARVE_COLOR }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType: 'pocket', ...settings },
  };
}

function reliefObject(): ReliefObject {
  return {
    kind: 'relief',
    id: 'relief-object',
    source: 'model.stl',
    meshPositions: [0, 0, 0, 40, 0, 3, 0, 40, 6],
    targetWidthMm: 40,
    reliefDepthMm: 5,
    emptyCells: 'floor',
    color: VCARVE_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 40 },
    transform: IDENTITY_TRANSFORM,
  };
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
      vCarveFlatDepthEnabled: true,
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

  it.each([
    ['ball-nose', 'bn-3175'],
    ['engraving', LEGACY_ENGRAVING_TOOL.id],
  ] as const)(
    'refuses a contributing V-carve flat-floor stage assigned to a %s cutter',
    (kind, clearToolId) => {
      const layer = vcarveLayer('wrong-clear-kind', {
        toolId: 'vb-60',
        vCarveFlatDepthEnabled: true,
        vClearToolId: clearToolId,
      });
      const machine: CncMachineConfig = {
        ...DEFAULT_CNC_MACHINE_CONFIG,
        tools: [...DEFAULT_CNC_MACHINE_CONFIG.tools, LEGACY_ENGRAVING_TOOL],
      };
      const clearTool = machine.tools.find((tool) => tool.id === clearToolId);
      if (clearTool === undefined) throw new Error('expected clearing tool');

      expect(preflight([layer], [rectangle('wide-v-carve', VCARVE_COLOR, 60)], machine)).toEqual({
        ok: false,
        issues: [
          {
            code: 'cnc-tool-geometry-invalid',
            message:
              `Layer wrong-clear-kind: V-carve flat-floor clearing requires a flat end mill; ` +
              `"${clearTool.name}" is ${kind}. Choose an end mill before generating toolpaths.`,
          },
        ],
      });
    },
  );

  it('does not refuse a wrong-kind clearing selection when the contour has no flat floor', () => {
    const layer = vcarveLayer('narrow-wrong-clear-kind', {
      toolId: 'vb-60',
      vCarveFlatDepthEnabled: true,
      vClearToolId: 'bn-3175',
    });

    expect(
      preflight(
        [layer],
        [rectangle('narrow-v-carve', VCARVE_COLOR, 3)],
        DEFAULT_CNC_MACHINE_CONFIG,
      ),
    ).toEqual({ ok: true, issues: [] });
  });

  it('does not widen the historical clear-tool refusal scope for over-cone jobs', () => {
    const overConeVBit: CncTool = {
      id: 'v90-6',
      name: '6 mm 90 degree V-bit',
      kind: 'v-bit',
      diameterMm: 6,
      tipAngleDeg: 90,
    };
    const wrongKindClearTool: CncTool = {
      id: 'wrong-clear',
      name: '3 mm ball nose',
      kind: 'ball-nose',
      diameterMm: 3,
    };
    const machine: CncMachineConfig = {
      ...DEFAULT_CNC_MACHINE_CONFIG,
      toolId: overConeVBit.id,
      tools: [overConeVBit, wrongKindClearTool],
    };
    const object = rectangle('over-cone-square', VCARVE_COLOR, 18);

    for (const vClearToolId of ['missing-clear', wrongKindClearTool.id]) {
      const result = preflight(
        [
          vcarveLayer('over-cone-v-carve', {
            toolId: overConeVBit.id,
            vCarveFlatDepthEnabled: true,
            vClearToolId,
            depthMm: 10,
            depthPerPassMm: 1,
          }),
        ],
        [object],
        machine,
      );
      expect(result.issues.some((issue) => issue.code === 'cnc-tool-geometry-invalid')).toBe(false);
    }
  });

  it.each([
    ['missing', 'missing-rougher'],
    ['ball-nose', 'bn-6350'],
  ] as const)('refuses an active rest-pocket %s roughing bit', (_case, roughToolId) => {
    const result = preflight(
      [pocketLayer('invalid-rest-rougher', { toolId: 'em-1588', pocketRoughToolId: roughToolId })],
      [rectangle('pocket', VCARVE_COLOR, 30)],
      DEFAULT_CNC_MACHINE_CONFIG,
    );

    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'cnc-tool-geometry-invalid',
        message: expect.stringContaining('pocket roughing requires a flat end mill'),
      }),
    );
  });

  it('keeps an invalid rest rougher dormant for adaptive pockets', () => {
    expect(
      preflight(
        [
          pocketLayer('adaptive-pocket', {
            pocketStrategy: 'adaptive',
            pocketRoughToolId: 'bn-6350',
          }),
        ],
        [rectangle('pocket', VCARVE_COLOR, 30)],
        DEFAULT_CNC_MACHINE_CONFIG,
      ).issues.some((issue) => issue.code === 'cnc-tool-geometry-invalid'),
    ).toBe(false);
  });

  it('refuses a missing active V-clear bit but ignores the same dormant binding', () => {
    const settings = {
      toolId: 'vb-60',
      vCarveFlatDepthEnabled: true,
      vClearToolId: 'missing-clear',
    };
    const active = preflight(
      [vcarveLayer('missing-v-clear', settings)],
      [rectangle('wide-v-carve', VCARVE_COLOR, 60)],
      DEFAULT_CNC_MACHINE_CONFIG,
    );
    expect(active.issues).toContainEqual({
      code: 'cnc-tool-geometry-invalid',
      message:
        'Layer missing-v-clear: selected V-carve clearing bit "missing-clear" is missing. Choose a flat end mill or disable floor clearing before generating toolpaths.',
    });
    expect(
      preflight(
        [
          vcarveLayer('dormant-v-clear', settings, false),
          createLayer({ id: 'live', color: '#00ff00' }),
        ],
        [rectangle('live-square', '#00ff00', 20)],
        DEFAULT_CNC_MACHINE_CONFIG,
      ).issues.some((issue) => issue.code === 'cnc-tool-geometry-invalid'),
    ).toBe(false);
    expect(
      preflight(
        [vcarveLayer('narrow-v-clear', settings)],
        [rectangle('narrow-v-carve', VCARVE_COLOR, 0.1)],
        DEFAULT_CNC_MACHINE_CONFIG,
      ).issues.some((issue) => issue.code === 'cnc-tool-geometry-invalid'),
    ).toBe(false);
  });

  it('refuses a missing active relief-finishing bit but ignores it without a relief', () => {
    const layer: Layer = {
      ...createLayer({ id: 'relief-layer', color: VCARVE_COLOR }),
      cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, reliefFinishToolId: 'missing-finisher' },
    };
    const active = preflight([layer], [reliefObject()], DEFAULT_CNC_MACHINE_CONFIG);
    expect(active.issues).toContainEqual({
      code: 'cnc-tool-geometry-invalid',
      message:
        'Layer relief-layer: selected relief finishing bit "missing-finisher" is missing. Choose a finishing bit or disable finishing before generating toolpaths.',
    });
    expect(
      preflight(
        [layer],
        [rectangle('ordinary-vector', VCARVE_COLOR, 20)],
        DEFAULT_CNC_MACHINE_CONFIG,
      ).issues.some((issue) => issue.code === 'cnc-tool-geometry-invalid'),
    ).toBe(false);
  });
});
