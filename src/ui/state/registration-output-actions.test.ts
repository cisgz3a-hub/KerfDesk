import { beforeEach, describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, REGISTRATION_LAYER_ID } from '../../core/scene';
import { createRectangle } from '../../core/shapes';
import { useStore } from './store';
import { resetStore } from './test-helpers';

const ART_COLOR = '#0000ff';

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
    expect(output[ART_COLOR]).toBe(false);
  });

  it('artwork scope outputs everything except the registration layer (run 2)', () => {
    useStore.getState().setRegistrationOutput('artwork');
    const output = outputById();
    expect(output[REGISTRATION_LAYER_ID]).toBe(false);
    expect(output[ART_COLOR]).toBe(true);
  });

  it('is a no-op when there is no registration jig', () => {
    resetStore();
    const before = useStore.getState().project;
    useStore.getState().setRegistrationOutput('box');
    expect(useStore.getState().project).toBe(before);
  });
});
