import { beforeEach, describe, expect, it } from 'vitest';
import type { VariableTextRenderer } from '../../io/gcode';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { fixtureState, NOW, renderFixture, textValues } from '../state/variable-array-test-fixture';
import { bakeSelectedVariableText } from './bake-variable-text';

describe('bakeSelectedVariableText', () => {
  beforeEach(() => {
    resetStore();
    useStore.setState(fixtureState());
  });

  it('fixes the current values as plain text in one undo step', async () => {
    await bakeSelectedVariableText({ render: renderFixture, now: () => NOW });

    const objects = useStore.getState().project.scene.objects;
    expect(textValues(useStore.getState().project)).toEqual(['A-010', 'D110', 'Fixed']);
    expect(
      objects.every((object) => object.kind !== 'text' || object.variableTemplate === undefined),
    ).toBe(true);
    expect(useStore.getState().project.variables?.serialValue).toBe(10);
    expect(useStore.getState().undoStack).toHaveLength(1);

    useStore.getState().undo();
    expect(textValues(useStore.getState().project)).toEqual(['old', 'old', 'Fixed']);
  });

  it('bakes 1000 selected variable objects atomically and restores every template on undo', async () => {
    const initial = useStore.getState();
    const template = initial.project.scene.objects[0];
    if (template?.kind !== 'text') throw new Error('missing variable text fixture');
    const objects = Array.from({ length: 1000 }, (_, index) => ({
      ...template,
      id: `variable-${index}`,
    }));
    useStore.setState({
      project: { ...initial.project, scene: { ...initial.project.scene, objects } },
      selectedObjectId: 'variable-0',
      additionalSelectedIds: new Set(objects.slice(1).map((object) => object.id)),
    });
    await bakeSelectedVariableText({ render: renderFixture, now: () => NOW });
    expect(textValues(useStore.getState().project)).toEqual(Array<string>(1000).fill('A-010'));
    expect(useStore.getState().undoStack).toHaveLength(1);
    useStore.getState().undo();
    expect(useStore.getState().project.scene.objects).toEqual(objects);
  });

  it('changes nothing when one field fails or the project changes while rendering', async () => {
    const failing: VariableTextRenderer = async () => {
      throw new Error('font missing');
    };
    await bakeSelectedVariableText({ render: failing, now: () => NOW });
    expect(textValues(useStore.getState().project)).toEqual(['old', 'old', 'Fixed']);
    expect(useToastStore.getState().toasts.at(-1)?.message).toContain('Nothing was baked');

    const racing: VariableTextRenderer = async (input) => {
      useStore.setState((state) => ({ project: { ...state.project } }));
      return renderFixture(input);
    };
    await bakeSelectedVariableText({ render: racing, now: () => NOW });
    expect(textValues(useStore.getState().project)).toEqual(['old', 'old', 'Fixed']);
    expect(useStore.getState().undoStack).toHaveLength(0);
  });
});
