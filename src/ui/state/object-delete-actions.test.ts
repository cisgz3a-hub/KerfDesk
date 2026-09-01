import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { textDependencyChain } from './testing/scene-clipboard-fixtures';
import { useToastStore } from './toast-store';

describe('object delete actions', () => {
  beforeEach(() => {
    resetStore();
    for (const toast of useToastStore.getState().toasts) {
      useToastStore.getState().dismissToast(toast.id);
    }
  });

  it('keeps materialized text and removes its stale path link when the guide is deleted', () => {
    const fixture = textDependencyChain();
    const before = fixture.project.scene.objects.find((object) => object.id === 'text-b');
    useStore.setState({ project: fixture.project });

    useStore.getState().removeSceneObject('guide-c');

    const after = useStore
      .getState()
      .project.scene.objects.find((object) => object.id === 'text-b');
    expect(after?.kind).toBe('text');
    if (before?.kind !== 'text' || after?.kind !== 'text') throw new Error('path text missing');
    expect(after.pathText).toBeUndefined();
    expect(after.paths).toEqual(before.paths);
    expect(useToastStore.getState().toasts.at(-1)).toMatchObject({ variant: 'warning' });
  });
});
