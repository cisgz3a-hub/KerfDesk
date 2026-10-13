import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useShowNotesOnOpen } from './use-show-notes-on-open';

let host: HTMLDivElement;
let root: Root;

function Probe(props: { readonly open: () => void }): null {
  useShowNotesOnOpen(props.open);
  return null;
}

describe('Show notes on open', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    resetStore();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it('saves the choice with the notes as one undo step and keeps it through save and open', () => {
    useStore.getState().setProjectNotes('Use 3 mm birch', true);
    const project = useStore.getState().project;
    expect(project.showNotesOnOpen).toBe(true);
    expect(useStore.getState().undoStack).toHaveLength(1);

    const reopened = deserializeProject(serializeProject(project));
    expect(reopened.kind === 'ok' && reopened.project.showNotesOnOpen).toBe(true);

    useStore.getState().setProjectNotes('Use 3 mm birch', false);
    expect('showNotesOnOpen' in useStore.getState().project).toBe(false);
  });

  it('opens the notes when a project that asks for them is opened, not otherwise', async () => {
    const open = vi.fn();
    await act(async () => root.render(<Probe open={open} />));
    expect(open).not.toHaveBeenCalled();

    act(() => {
      useStore.setState((state) => ({
        project: { ...createProject(), notes: 'Check focus', showNotesOnOpen: true },
        projectDocumentEpoch: state.projectDocumentEpoch + 1,
      }));
    });
    expect(open).toHaveBeenCalledTimes(1);

    act(() => useStore.getState().setProjectNotes('Check focus first'));
    expect(open).toHaveBeenCalledTimes(1);
  });
});
