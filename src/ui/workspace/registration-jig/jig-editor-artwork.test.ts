import { beforeEach, describe, expect, it } from 'vitest';
import {
  IDENTITY_TRANSFORM,
  primaryOperationForObject,
  REGISTRATION_LAYER_ID,
  transformedBBox,
  type Scene,
  type TextObject,
} from '../../../core/scene';
import { applyRegistrationOutput } from '../../state/registration-output-actions';
import { useStore } from '../../state/store';
import { resetStore, svgObj } from '../../state/test-helpers';
import { deleteJigArtwork, importJigArtwork, upsertJigText } from './jig-editor-artwork';
import { createJigEditorSession } from './jig-editor-session';

function operationFor(scene: Scene, objectId: string) {
  const object = scene.objects.find((candidate) => candidate.id === objectId);
  const operation = object && primaryOperationForObject(object, scene.layers);
  if (!operation) throw new Error(`Missing operation for ${objectId}`);
  return operation;
}

function textObject(fontKey = 'roboto-regular'): TextObject {
  return {
    kind: 'text',
    id: 'writing',
    content: 'Jig writing',
    fontKey,
    sizeMm: 12,
    alignment: 'center',
    lineHeight: 1,
    letterSpacing: 0,
    color: '#123456',
    bounds: { minX: 0, minY: 0, maxX: 20, maxY: 12 },
    transform: { ...IDENTITY_TRANSFORM, x: 30, y: 40 },
    paths: [
      {
        color: '#123456',
        polylines: [
          {
            closed: false,
            points: [
              { x: 0, y: 0 },
              { x: 20, y: 12 },
            ],
          },
        ],
      },
    ],
  };
}

describe('registration jig draft artwork edits', () => {
  beforeEach(() => {
    resetStore();
    useStore.setState({ registrationArtworkOutputSnapshot: null });
  });

  it('removes deleted draft artwork from groups, operation intent and dependent image masks', () => {
    useStore.getState().addRegistrationBox(80, 40);
    useStore.getState().importSvgObject(svgObj('mask', ['#000000']));
    const operation = operationFor(useStore.getState().project.scene, 'mask');
    useStore.getState().setRegistrationOutput('box');
    const session = createJigEditorSession(useStore.getState());
    const scene = session.draft.project.scene;
    const mask = scene.objects.find((object) => object.id === 'mask')!;
    const draft = {
      ...session.draft,
      selectedObjectId: 'mask',
      additionalSelectedIds: new Set<string>(),
      project: {
        ...session.draft.project,
        scene: {
          ...scene,
          objects: [
            ...scene.objects,
            {
              kind: 'raster-image' as const,
              id: 'image',
              source: 'image.png',
              pixelWidth: 10,
              pixelHeight: 10,
              bounds: mask.bounds,
              transform: IDENTITY_TRANSFORM,
              color: '#123456',
              dither: 'threshold' as const,
              linesPerMm: 10,
              imageMaskId: 'mask',
            },
          ],
          groups: [{ id: 'group', name: 'Grouped', objectIds: ['mask', 'image'] }],
        },
      },
    };
    const result = deleteJigArtwork({ ...session, draft });
    expect(result.draft.project.scene.objects.some((object) => object.id === 'mask')).toBe(false);
    expect(
      result.draft.project.scene.groups?.some((group) => group.objectIds.includes('mask')),
    ).toBe(false);
    expect(
      result.draft.project.scene.objects.find((object) => object.id === 'image'),
    ).not.toHaveProperty('imageMaskId');
    expect(result.draft.project.scene.layers.some((layer) => layer.id === operation.id)).toBe(
      false,
    );
    expect(result.draft.registrationArtworkOutputSnapshot).not.toHaveProperty(operation.id);
    expect(result.draft.project.registrationArtworkOutputSnapshot).not.toHaveProperty(operation.id);
    expect(useStore.getState().project.scene.objects.some((object) => object.id === 'mask')).toBe(
      true,
    );
    expect(result.past).toHaveLength(1);
  });

  it('imports a large trace inside the jig without the bed import overwriting its fit', () => {
    const session = createJigEditorSession(useStore.getState());
    const source = {
      ...svgObj('trace', ['#000000']),
      kind: 'traced-image' as const,
      bounds: { minX: 0, minY: 0, maxX: 2000, maxY: 2000 },
    };
    const result = importJigArtwork(session, source);
    const imported = result.draft.project.scene.objects.find((object) => object.id === 'trace');
    expect(imported).toBeDefined();
    expect(transformedBBox(imported!)).toEqual({ minX: 182, minY: 182, maxX: 218, maxY: 218 });
    expect(primaryOperationForObject(imported!, result.draft.project.scene.layers)).toBeDefined();
    expect(result.past).toHaveLength(1);
  });

  it('records a newly imported operation during Outline only and restores it with earlier artwork intent', () => {
    useStore.getState().addRegistrationBox(80, 40);
    useStore.getState().upsertTextObject(textObject());
    useStore.getState().upsertTextObject({ ...textObject(), id: 'disabled', color: '#654321' });
    const before = useStore.getState().project.scene;
    const enabledId = operationFor(before, 'writing').id;
    const disabledId = operationFor(before, 'disabled').id;
    useStore.getState().setLayerParam(disabledId, { output: false });
    useStore.getState().setRegistrationOutput('box');
    const state = useStore.getState();
    const session = createJigEditorSession(state);

    const imported = importJigArtwork(session, svgObj('new-art', ['#445566']));
    const newOperation = operationFor(imported.draft.project.scene, 'new-art');
    expect(newOperation.output).toBe(false);
    expect(imported.draft.registrationArtworkOutputSnapshot?.[newOperation.id]).toBe(true);
    expect(
      imported.draft.project.scene.layers.find((layer) => layer.id === REGISTRATION_LAYER_ID)
        ?.output,
    ).toBe(true);
    const restored = applyRegistrationOutput({ ...imported.draft, undoStack: [] }, 'artwork');
    const outputs = Object.fromEntries(
      restored.project.scene.layers.map((layer) => [layer.id, layer.output]),
    );
    expect(outputs).toMatchObject({
      [enabledId]: true,
      [disabledId]: false,
      [newOperation.id]: true,
      [REGISTRATION_LAYER_ID]: false,
    });
    expect(useStore.getState().project).toBe(state.project);
    expect(state.project.scene.objects.some((object) => object.id === 'new-art')).toBe(false);
    expect(imported.past).toEqual([session.draft]);
  });

  it('retains the supplied centre-compensated transform when updating text', () => {
    const added = upsertJigText(createJigEditorSession(useStore.getState()), textObject());
    const existing = added.draft.project.scene.objects.find((object) => object.id === 'writing');
    if (existing?.kind !== 'text') throw new Error('Text missing');
    const transform = { ...existing.transform, x: 102, y: 87, rotationDeg: 32, mirrorY: true };
    const updated = { ...existing, content: 'Different writing', transform, powerScale: 0.65 };
    const edited = upsertJigText(added, updated);
    const saved = edited.draft.project.scene.objects.find((object) => object.id === 'writing');

    expect(saved).toEqual(updated);
    expect(saved?.transform).toBe(transform);
    expect(edited.draft.project.scene.layers).toBe(added.draft.project.scene.layers);
    expect(edited.draft.selectedObjectId).toBe('writing');
    expect(edited.draft.additionalSelectedIds.size).toBe(0);
    expect(added.draft.project.scene.objects.find((object) => object.id === 'writing')).toBe(
      existing,
    );
  });

  it('keeps new writing at its supplied jig position instead of recentering it on the bed', () => {
    const text = textObject();
    const session = upsertJigText(createJigEditorSession(useStore.getState()), text);
    expect(
      session.draft.project.scene.objects.find((object) => object.id === text.id)?.transform,
    ).toEqual(text.transform);
  });

  it.each([
    ['roboto-regular', 'v-carve'],
    ['ems-decorous-script', 'engrave'],
  ])('retains normal CNC text defaults for a new %s operation', (fontKey, cutType) => {
    useStore.getState().setMachineKind('cnc');
    useStore.getState().updateCncMachine({ toolId: 'vb-60' });
    const initial = useStore.getState();
    const session = upsertJigText(createJigEditorSession(initial), textObject(fontKey));

    expect(operationFor(session.draft.project.scene, 'writing').cnc?.cutType).toBe(cutType);
    expect(useStore.getState().project).toBe(initial.project);
  });
});
