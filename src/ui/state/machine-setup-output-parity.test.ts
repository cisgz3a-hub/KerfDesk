import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type Layer,
} from '../../core/scene';
import { emitGcode } from '../../io/gcode';
import { cncStartupOperationDraft } from './cnc-startup-setup';
import { useStore } from './store';
import { resetStore } from './test-helpers';

describe('CNC Startup Setup output compatibility', () => {
  beforeEach(() => resetStore());

  it('preserves unchanged mixed-material, multi-tool, and secondary-tool output byte for byte', () => {
    const layers = legacyMixedToolLayers();
    useStore.setState((state) => ({
      project: {
        ...state.project,
        machine: DEFAULT_CNC_MACHINE_CONFIG,
        scene: { objects: [closedArtwork(layers)], layers },
      },
      cachedCncMachine: DEFAULT_CNC_MACHINE_CONFIG,
      undoStack: [],
      redoStack: [],
      dirty: false,
    }));
    const before = emitGcode(useStore.getState().project);
    expect(before.preflight.issues.map((issue) => issue.code)).toEqual([
      'cnc-secondary-tool-feed-retained',
      'cnc-secondary-tool-feed-retained',
    ]);
    expect(before.gcode).toBeTruthy();

    useStore
      .getState()
      .replaceCncStartupSetup(
        DEFAULT_DEVICE_PROFILE,
        DEFAULT_CNC_MACHINE_CONFIG,
        DEFAULT_CNC_MACHINE_CONFIG,
        {
          operationDrafts: layers.map(cncStartupOperationDraft),
          customTools: [],
          materialApplyRequested: false,
        },
      );

    const after = emitGcode(useStore.getState().project);
    expect(after.preflight).toEqual(before.preflight);
    expect(after.gcode).toBe(before.gcode);
    expect(useStore.getState().project.scene.layers.map((layer) => layer.cnc)).toEqual(
      layers.map((layer) => layer.cnc),
    );
  });
});

function legacyMixedToolLayers(): ReadonlyArray<Layer> {
  return [
    {
      ...createLayer({ id: 'pocket', name: 'Pocket', color: '#aa0000' }),
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        cutType: 'pocket',
        materialKey: 'hardwood',
        toolId: 'em-3175',
        pocketRoughToolId: 'em-6350',
      },
    },
    {
      ...createLayer({ id: 'v-carve', name: 'V-carve', color: '#0000aa' }),
      cnc: {
        ...DEFAULT_CNC_LAYER_SETTINGS,
        cutType: 'v-carve',
        materialKey: 'acrylic',
        toolId: 'vb-90',
        vCarveFlatDepthEnabled: true,
        vClearToolId: 'em-1588',
      },
    },
  ];
}

function closedArtwork(layers: ReadonlyArray<Layer>): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'legacy-mixed-tool-artwork',
    source: 'legacy-mixed-tool-artwork.svg',
    bounds: { minX: 0, minY: 0, maxX: 25, maxY: 10 },
    transform: IDENTITY_TRANSFORM,
    paths: layers.map((layer, index) => {
      const x = index * 15;
      return {
        color: layer.color,
        polylines: [
          {
            points: [
              { x, y: 0 },
              { x: x + 10, y: 0 },
              { x: x + 10, y: 10 },
              { x, y: 10 },
            ],
            closed: true,
          },
        ],
      };
    }),
  };
}
