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
import { useToastStore } from '../../state/toast-store';
import {
  clearJigArtwork,
  deleteJigArtworkWithRepairs,
  importJigArtwork,
  jigArtworkIds,
  upsertJigText,
} from './jig-editor-artwork';
import { createJigEditorSession, type JigEditorSession } from './jig-editor-session';
import { createRectangle } from '../../../core/shapes/primitives';
import { findRegistrationBoxes, isRegistrationBox } from '../../../core/scene';

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
    const toasts = useToastStore.getState().toasts.length;
    const deletion = deleteJigArtworkWithRepairs({ ...session, draft });
    const result = deletion.session;
    // Pure: the caller reports repairs outside its state updater.
    expect(deletion.repairs).toMatchObject({ repairedImageMasks: 1 });
    expect(useToastStore.getState().toasts).toHaveLength(toasts);
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
    expect(result.draft.project).not.toBe(session.draft.project);
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
    expect(result.draft.project).not.toBe(session.draft.project);
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
    expect(imported.draft.project).not.toBe(session.draft.project);
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

describe('one design on every piece (ADR-641)', () => {
  function gridSession(): JigEditorSession {
    resetStore();
    useStore.setState({ registrationArtworkOutputSnapshot: null });
    useStore.getState().replaceRegistrationJigSet({
      outline: { kind: 'rectangle', widthMm: 40, heightMm: 30 },
      rows: 1,
      columns: 3,
      spacingX: 5,
      spacingY: 0,
    });
    return createJigEditorSession(useStore.getState());
  }
  function artwork(session: JigEditorSession) {
    return session.draft.project.scene.objects.filter((object) => !isRegistrationBox(object));
  }
  function outlinesHolding(session: JigEditorSession): ReadonlySet<number> {
    const outlines = findRegistrationBoxes(session.draft.project.scene).map(transformedBBox);
    return new Set(
      artwork(session).map((object) => {
        const bounds = transformedBBox(object);
        const x = (bounds.minX + bounds.maxX) / 2;
        const y = (bounds.minY + bounds.maxY) / 2;
        return outlines.findIndex(
          (outline) =>
            x >= outline.minX && x <= outline.maxX && y >= outline.minY && y <= outline.maxY,
        );
      }),
    );
  }

  it('copies a single import into every outline', () => {
    const imported = importJigArtwork(gridSession(), svgObj('logo', ['#112233']));
    expect(artwork(imported)).toHaveLength(3);
    expect(outlinesHolding(imported)).toEqual(new Set([0, 1, 2]));
  });

  it('fills one outline per file when several are imported together', () => {
    let session = gridSession();
    const anchorIds = new Set<string>();
    session = importJigArtwork(session, svgObj('a', ['#112233']), { anchorIds, batchIndex: 0 });
    session = importJigArtwork(session, svgObj('b', ['#445566']), { anchorIds, batchIndex: 1 });
    expect(artwork(session)).toHaveLength(2);
    expect(outlinesHolding(session).size).toBe(2);
  });

  it('copies new text at its own size, and editing one copy changes only that copy', () => {
    const added = upsertJigText(gridSession(), textObject());
    const texts = artwork(added).filter((object) => object.kind === 'text');
    expect(texts).toHaveLength(3);
    for (const text of texts) {
      const bounds = transformedBBox(text);
      expect(bounds.maxX - bounds.minX).toBeCloseTo(20);
    }
    const copy = texts.find((text) => text.id !== 'writing');
    if (copy?.kind !== 'text') throw new Error('Missing text copy');
    const edited = upsertJigText(added, { ...copy, content: 'Other name' });
    const contents = artwork(edited).map((object) =>
      object.kind === 'text' ? object.content : '',
    );
    expect(contents.filter((content) => content === 'Other name')).toHaveLength(1);
    expect(artwork(edited)).toHaveLength(3);
  });

  it('Clear canvas removes the artwork in the pieces and keeps the outlines and other designs', () => {
    gridSession();
    useStore.getState().drawShape(
      createRectangle({
        id: 'outside',
        color: '#0000ff',
        spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
        transform: { ...IDENTITY_TRANSFORM, x: 390, y: 390 },
      }),
    );
    const session = importJigArtwork(
      createJigEditorSession(useStore.getState()),
      svgObj('logo', ['#112233']),
    );
    expect(jigArtworkIds(session.draft.project.scene).size).toBe(3);
    const cleared = clearJigArtwork(session).session;
    expect(artwork(cleared).map((object) => object.id)).toEqual(['outside']);
    expect(findRegistrationBoxes(cleared.draft.project.scene)).toHaveLength(3);
    expect(jigArtworkIds(cleared.draft.project.scene).size).toBe(0);
  });
});
