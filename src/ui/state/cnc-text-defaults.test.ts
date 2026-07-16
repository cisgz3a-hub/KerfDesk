import { beforeEach, describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, primaryOperationForObject, type TextObject } from '../../core/scene';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const TEXT_COLOR = '#111111';

function textObject(overrides: Partial<TextObject> = {}): TextObject {
  return {
    kind: 'text',
    id: 'T1',
    content: 'Oak',
    fontKey: 'Roboto',
    sizeMm: 20,
    alignment: 'left',
    lineHeight: 1,
    letterSpacing: 0,
    color: TEXT_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 20 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color: TEXT_COLOR,
        polylines: [
          {
            closed: true,
            points: [
              { x: 0, y: 0 },
              { x: 40, y: 0 },
              { x: 40, y: 20 },
            ],
          },
        ],
      },
    ],
    ...overrides,
  };
}

function textLayerCutType(): string | undefined {
  const scene = useStore.getState().project.scene;
  const text = scene.objects.find((object) => object.kind === 'text');
  return text === undefined
    ? undefined
    : primaryOperationForObject(text, scene.layers)?.cnc?.cutType;
}

beforeEach(() => {
  resetStore();
});

describe('CNC text defaults (H.6c)', () => {
  it('a fresh text layer in CNC mode with a v-bit defaults to v-carve', () => {
    useStore.getState().setMachineKind('cnc');
    useStore.getState().updateCncMachine({ toolId: 'vb-60' });

    useStore.getState().upsertTextObject(textObject());

    expect(textLayerCutType()).toBe('v-carve');
  });

  it.each(['relief-single-line', 'ems-nixish', 'ems-decorous-script', 'ems-casual-hand'])(
    'a fresh %s single-line layer engraves even when a v-bit is active',
    (fontKey) => {
      useStore.getState().setMachineKind('cnc');
      useStore.getState().updateCncMachine({ toolId: 'vb-60' });

      useStore.getState().upsertTextObject(textObject({ fontKey }));

      expect(textLayerCutType()).toBe('engrave');
    },
  );

  it('a fresh text layer in CNC mode with an end mill defaults to on-path engrave', () => {
    useStore.getState().setMachineKind('cnc');

    useStore.getState().upsertTextObject(textObject());

    expect(textLayerCutType()).toBe('engrave');
  });

  it('laser mode leaves the new text layer without CNC settings', () => {
    useStore.getState().upsertTextObject(textObject());

    expect(textLayerCutType()).toBeUndefined();
  });

  it('seeds a text-only operation when a laser project switches to CNC', () => {
    useStore.getState().upsertTextObject(textObject());

    useStore.getState().setMachineKind('cnc');

    expect(textLayerCutType()).toBe('engrave');
  });

  it('never rewrites a layer the operator already configured', () => {
    useStore.getState().setMachineKind('cnc');
    useStore.getState().upsertTextObject(textObject());
    // Operator retunes the layer to a pocket...
    const scene = useStore.getState().project.scene;
    const text = scene.objects.find((object) => object.kind === 'text');
    const layer = text === undefined ? null : primaryOperationForObject(text, scene.layers);
    if (layer?.cnc === undefined) throw new Error('text layer with CNC settings missing');
    useStore.getState().setLayerParam(layer.id, {
      cnc: { ...layer.cnc, cutType: 'pocket' },
    });

    // ...then edits the text: settings must survive.
    useStore.getState().upsertTextObject(textObject({ content: 'Oak Sign' }));

    expect(textLayerCutType()).toBe('pocket');
  });
});
