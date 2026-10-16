import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { useStore, currentOutputScope } from '../state';
import { prepareOutput } from '../../io/gcode/prepare-output';
import { FocusTestDialog } from './FocusTestDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('Focus Test dialog', () => {
  it('rejects empty/duplicate samples and creates one undoable normal scene without motion', async () => {
    useStore.setState({ project: createProject(), undoStack: [], redoStack: [], dirty: false });
    useStore.getState().setOutputScopeSettings({ cutSelectedGraphics: true });
    const before = useStore.getState().project;
    const onClose = vi.fn();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(<FocusTestDialog onClose={onClose} />);
      });
      const samples = host.querySelector('input');
      if (!(samples instanceof HTMLInputElement)) throw new Error('Samples input missing');
      const generate = (): HTMLButtonElement => {
        const button = [...host.querySelectorAll('button')].find(
          (element) => element.textContent === 'Generate',
        );
        if (button === undefined) throw new Error('Generate missing');
        return button;
      };
      await act(async () => {
        samples.value = '';
        Simulate.change(samples);
      });
      expect(generate().disabled).toBe(true);
      expect(useStore.getState().project).toBe(before);
      await act(async () => {
        samples.value = '101';
        Simulate.change(samples);
      });
      expect(generate().disabled).toBe(false);
      await act(async () => {
        const form = host.querySelector('form');
        if (form === null) throw new Error('Form missing');
        Simulate.submit(form);
      });
      expect(useStore.getState().project.scene.layers).toHaveLength(101);
      expect(useStore.getState().undoStack).toHaveLength(1);
      expect(onClose).toHaveBeenCalledOnce();
      const state = useStore.getState();
      const prepared = prepareOutput(state.project, { outputScope: currentOutputScope(state) });
      if (!prepared.ok) throw new Error('Generated samples must compile');
      expect(prepared.job.groups).toHaveLength(101);
      await act(async () => {
        useStore.getState().undo();
      });
      expect(useStore.getState().project.scene).toEqual(before.scene);
    } finally {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    }
  });
});
