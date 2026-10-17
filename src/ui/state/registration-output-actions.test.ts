import { beforeEach, describe, expect, it } from 'vitest';
import {
  findRegistrationBoxes,
  IDENTITY_TRANSFORM,
  isRegistrationBox,
  operationIdsForObject,
  primaryOperationForObject,
  REGISTRATION_LAYER_ID,
  updateLayer,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { deserializeProject } from '../../io/project/deserialize-project';
import { serializeProject } from '../../io/project/serialize-project';
import {
  applyRegistrationOutput,
  type RegistrationOutputState,
} from './registration-output-actions';

const ART_COLOR = '#0000ff';
const DISABLED_ART_COLOR = '#00aa00';

function outputById(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const layer of useStore.getState().project.scene.layers) out[layer.id] = layer.output;
  return out;
}

describe('setRegistrationOutput', () => {
  beforeEach(() => {
    resetStore();
    useStore.getState().addRegistrationBox(80, 40);
    useStore.getState().drawShape(
      createRectangle({
        id: 'art',
        color: ART_COLOR,
        spec: { widthMm: 20, heightMm: 20, cornerRadiusMm: 0 },
        transform: { ...IDENTITY_TRANSFORM, x: 10, y: 10 },
      }),
    );
  });

  it('box scope outputs only the registration layer (run 1)', () => {
    useStore.getState().setRegistrationOutput('box');
    const output = outputById();
    expect(output[REGISTRATION_LAYER_ID]).toBe(true);
    expect(output[operationIdFor('art')]).toBe(false);
  });

  it('artwork scope outputs everything except the registration layer (run 2)', () => {
    useStore.getState().setRegistrationOutput('artwork');
    const output = outputById();
    expect(output[REGISTRATION_LAYER_ID]).toBe(false);
    expect(output[operationIdFor('art')]).toBe(true);
  });

  it('applies Outline only and Artwork only to every member of a five-jig set', () => {
    resetStore();
    useStore.getState().replaceRegistrationJigSet({
      outline: { kind: 'rectangle', widthMm: 40, heightMm: 30 },
      rows: 1,
      columns: 5,
      spacingX: 5,
      spacingY: 0,
    });
    useStore.getState().drawShape(
      createRectangle({
        id: 'set-art',
        color: ART_COLOR,
        spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
        transform: { ...IDENTITY_TRANSFORM, x: 0, y: 0 },
      }),
    );
    useStore.getState().centerSelectionInRegistrationBox();

    useStore.getState().setRegistrationOutput('box');
    const outlineScene = useStore.getState().project.scene;
    expect(findRegistrationBoxes(outlineScene)).toHaveLength(5);
    expect(outputObjectCount(outlineScene, true)).toBe(5);
    expect(outputObjectCount(outlineScene, false)).toBe(0);

    useStore.getState().setRegistrationOutput('artwork');
    const artworkScene = useStore.getState().project.scene;
    expect(outputObjectCount(artworkScene, true)).toBe(0);
    expect(outputObjectCount(artworkScene, false)).toBe(5);
  });

  it('artwork scope restores only layers that were enabled before box scope', () => {
    useStore.getState().drawShape(
      createRectangle({
        id: 'disabled-art',
        color: DISABLED_ART_COLOR,
        spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
        transform: { ...IDENTITY_TRANSFORM, x: 40, y: 10 },
      }),
    );
    const artOperationId = operationIdFor('art');
    const disabledOperationId = operationIdFor('disabled-art');
    useStore.getState().setLayerParam(disabledOperationId, { output: false });

    useStore.getState().setRegistrationOutput('box');
    expect(outputById()[artOperationId]).toBe(false);
    expect(outputById()[disabledOperationId]).toBe(false);

    useStore.getState().setRegistrationOutput('artwork');
    const output = outputById();
    expect(output[REGISTRATION_LAYER_ID]).toBe(false);
    expect(output[artOperationId]).toBe(true);
    expect(output[disabledOperationId]).toBe(false);
  });

  it('enables all artwork after reopening a legacy Outline-only project without saved intent', () => {
    useStore.getState().setRegistrationOutput('box');
    const savedProject = { ...useStore.getState().project };
    delete savedProject.registrationArtworkOutputSnapshot;
    useStore.getState().setProject(savedProject);
    expect(useStore.getState().registrationArtworkOutputSnapshot).toBeNull();

    useStore.getState().setRegistrationOutput('artwork');

    const output = outputById();
    expect(output[REGISTRATION_LAYER_ID]).toBe(false);
    expect(output[operationIdFor('art')]).toBe(true);
  });

  it('clears the temporary artwork-output snapshot on undo', () => {
    useStore.getState().setRegistrationOutput('box');
    expect(useStore.getState().registrationArtworkOutputSnapshot).not.toBeNull();

    useStore.getState().undo();

    expect(useStore.getState().registrationArtworkOutputSnapshot).toBeNull();
  });

  it.each(['history', 'reload'] as const)(
    'restores enabled and disabled artwork after an Outline-only %s round trip',
    (roundTrip) => {
      useStore.getState().drawShape(
        createRectangle({
          id: 'disabled-art',
          color: DISABLED_ART_COLOR,
          spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
          transform: IDENTITY_TRANSFORM,
        }),
      );
      const enabled = operationIdFor('art');
      const disabled = operationIdFor('disabled-art');
      useStore.getState().setLayerParam(disabled, { output: false });
      useStore.getState().setRegistrationOutput('box');
      if (roundTrip === 'history') {
        useStore.getState().undo();
        useStore.getState().redo();
      } else {
        const loaded = deserializeProject(serializeProject(useStore.getState().project));
        expect(loaded.kind).toBe('ok');
        if (loaded.kind !== 'ok') return;
        useStore.setState({ project: loaded.project, registrationArtworkOutputSnapshot: null });
      }
      expect(outputById()[enabled]).toBe(false);
      useStore.getState().setRegistrationOutput('artwork');
      expect(outputById()).toMatchObject({
        [enabled]: true,
        [disabled]: false,
        [REGISTRATION_LAYER_ID]: false,
      });
      expect(useStore.getState().project).not.toHaveProperty('registrationArtworkOutputSnapshot');
    },
  );

  it('preserves the original enabled and disabled artwork when Outline only is repeated', () => {
    useStore.getState().drawShape(
      createRectangle({
        id: 'disabled-art',
        color: DISABLED_ART_COLOR,
        spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
        transform: { ...IDENTITY_TRANSFORM, x: 40, y: 10 },
      }),
    );
    const artOperationId = operationIdFor('art');
    const disabledOperationId = operationIdFor('disabled-art');
    useStore.getState().setLayerParam(disabledOperationId, { output: false });
    useStore.getState().setRegistrationOutput('box');
    const firstOutline = useStore.getState();

    useStore.getState().setRegistrationOutput('box');
    useStore.getState().setRegistrationOutput('box');

    expect(useStore.getState().registrationArtworkOutputSnapshot).toBe(
      firstOutline.registrationArtworkOutputSnapshot,
    );
    expect(useStore.getState().project).toBe(firstOutline.project);
    expect(useStore.getState().undoStack).toBe(firstOutline.undoStack);
    useStore.getState().setRegistrationOutput('artwork');
    expect(outputById()[artOperationId]).toBe(true);
    expect(outputById()[disabledOperationId]).toBe(false);
    expect(outputById()[REGISTRATION_LAYER_ID]).toBe(false);
  });

  it('applies an output change to an isolated draft without mutating the live project', () => {
    const live = useStore.getState();
    const draft: RegistrationOutputState = {
      project: live.project,
      registrationArtworkOutputSnapshot: null,
      undoStack: [],
    };

    const outline = applyRegistrationOutput(draft, 'box');
    const repeatedOutline = applyRegistrationOutput(outline, 'box');
    const editedDraft = {
      ...repeatedOutline,
      project: {
        ...repeatedOutline.project,
        scene: updateLayer(repeatedOutline.project.scene, REGISTRATION_LAYER_ID, { output: false }),
      },
    };
    const restoredOutline = applyRegistrationOutput(editedDraft, 'box');
    const artwork = applyRegistrationOutput(restoredOutline, 'artwork');

    expect(useStore.getState().project).toBe(live.project);
    expect(repeatedOutline).toBe(outline);
    expect(restoredOutline.registrationArtworkOutputSnapshot).toBe(
      outline.registrationArtworkOutputSnapshot,
    );
    expect(outline.undoStack).toEqual([draft.project]);
    expect(outline.dirty).toBe(true);
    expect(artwork.registrationArtworkOutputSnapshot).toBeNull();
    expect(
      artwork.project.scene.layers.find((layer) => layer.id === operationIdFor('art'))?.output,
    ).toBe(true);
  });

  it('is a no-op when there is no registration jig', () => {
    resetStore();
    const before = useStore.getState().project;
    useStore.getState().setRegistrationOutput('box');
    expect(useStore.getState().project).toBe(before);
  });

  it.each(['remove', 'capture'] as const)(
    'restores artwork and clears durable intent when replacing the jig through %s',
    (action) => {
      const enabled = operationIdFor('art');
      useStore.getState().setRegistrationOutput('box');
      if (action === 'remove') useStore.getState().removeRegistrationBox();
      else useStore.getState().addCapturedBoardBox(90, 60);
      expect(outputById()[enabled]).toBe(true);
      expect(useStore.getState().project).not.toHaveProperty('registrationArtworkOutputSnapshot');
      expect(useStore.getState().registrationArtworkOutputSnapshot).toBeNull();
    },
  );
});

function operationIdFor(objectId: string): string {
  const scene = useStore.getState().project.scene;
  const object = scene.objects.find((candidate) => candidate.id === objectId);
  const operation = object === undefined ? null : primaryOperationForObject(object, scene.layers);
  if (operation === null) throw new Error(`operation missing for ${objectId}`);
  return operation.id;
}

function outputObjectCount(
  scene: ReturnType<typeof useStore.getState>['project']['scene'],
  jig: boolean,
): number {
  const outputIds = new Set(scene.layers.filter((layer) => layer.output).map((layer) => layer.id));
  return scene.objects.filter(
    (object) =>
      isRegistrationBox(object) === jig &&
      operationIdsForObject(object, scene.layers).some((id) => outputIds.has(id)),
  ).length;
}
