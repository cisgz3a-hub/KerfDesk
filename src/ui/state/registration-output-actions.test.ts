import { beforeEach, describe, expect, it } from 'vitest';
import {
  IDENTITY_TRANSFORM,
  primaryOperationForObject,
  REGISTRATION_LAYER_ID,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { useStore } from './store';
import { resetStore } from './test-helpers';

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

  it('clears the temporary artwork-output snapshot on undo', () => {
    useStore.getState().setRegistrationOutput('box');
    expect(useStore.getState().registrationArtworkOutputSnapshot).not.toBeNull();

    useStore.getState().undo();

    expect(useStore.getState().registrationArtworkOutputSnapshot).toBeNull();
  });

  it('is a no-op when there is no registration jig', () => {
    resetStore();
    const before = useStore.getState().project;
    useStore.getState().setRegistrationOutput('box');
    expect(useStore.getState().project).toBe(before);
  });
});

function operationIdFor(objectId: string): string {
  const scene = useStore.getState().project.scene;
  const object = scene.objects.find((candidate) => candidate.id === objectId);
  const operation = object === undefined ? null : primaryOperationForObject(object, scene.layers);
  if (operation === null) throw new Error(`operation missing for ${objectId}`);
  return operation.id;
}
