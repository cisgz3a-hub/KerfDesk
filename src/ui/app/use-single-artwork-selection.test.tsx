import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  createRegistrationLayer,
  type Layer,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { createRegistrationBox } from '../../core/shapes';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { useSingleArtworkSelection } from './use-single-artwork-selection';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const RED = '#ff0000';
const BLUE = '#0000ff';

let host: HTMLDivElement | undefined;
let root: Root | undefined;

function SingleArtworkSelectionHarness(): null {
  useSingleArtworkSelection();
  return null;
}

function mountHarness(): void {
  host = document.createElement('div');
  document.body.append(host);
  act(() => {
    root = createRoot(host as HTMLDivElement);
    root.render(<SingleArtworkSelectionHarness />);
  });
}

function projectWith(objects: ReadonlyArray<SceneObject>, layers: ReadonlyArray<Layer>): Project {
  const project = createProject();
  return { ...project, scene: { objects, layers } };
}

async function settle(mutate?: () => void): Promise<void> {
  await act(async () => {
    mutate?.();
    await Promise.resolve();
  });
}

describe('useSingleArtworkSelection (ADR-222)', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
  });

  it('marks a one-artwork project already in memory when the app mounts', async () => {
    useStore.setState({
      project: projectWith([svgObj('A', [RED])], [createLayer({ id: RED, color: RED })]),
    });
    mountHarness();
    await settle();
    expect(useStore.getState().selectedObjectId).toBe('A');
  });

  it('marks the only artwork after a project opens', async () => {
    mountHarness();
    await settle(() => {
      useStore
        .getState()
        .setProject(projectWith([svgObj('A', [RED])], [createLayer({ id: RED, color: RED })]));
    });
    expect(useStore.getState().selectedObjectId).toBe('A');
  });

  it('allows the lone artwork to stay deselected after Escape / empty-canvas click', async () => {
    mountHarness();
    await settle(() => {
      useStore.getState().importSvgObject(svgObj('A', [RED]));
    });
    expect(useStore.getState().selectedObjectId).toBe('A');

    await settle(() => {
      useStore.getState().selectObject(null);
    });
    expect(useStore.getState().selectedObjectId).toBeNull();
  });

  it('keeps manual deselection through unrelated project edits', async () => {
    mountHarness();
    await settle(() => {
      useStore.getState().importSvgObject(svgObj('A', [RED]));
    });
    await settle(() => {
      useStore.getState().selectObject(null);
    });

    await settle(() => {
      useStore.setState((state) => ({ project: { ...state.project, notes: 'Operator note' } }));
    });
    expect(useStore.getState().selectedObjectId).toBeNull();
  });

  it('marks a newly opened project even when its lone artwork reuses the same id', async () => {
    mountHarness();
    const project = () => projectWith([svgObj('A', [RED])], [createLayer({ id: RED, color: RED })]);
    await settle(() => {
      useStore.getState().setProject(project());
    });
    await settle(() => {
      useStore.getState().selectObject(null);
    });
    expect(useStore.getState().selectedObjectId).toBeNull();

    await settle(() => {
      useStore.getState().setProject(project());
    });
    expect(useStore.getState().selectedObjectId).toBe('A');
  });

  it('leaves multi-artwork scenes deselected', async () => {
    mountHarness();
    await settle(() => {
      useStore.getState().importSvgObject(svgObj('A', [RED]));
      useStore.getState().importSvgObject(svgObj('B', [BLUE]));
      useStore.getState().selectObject(null);
    });
    expect(useStore.getState().selectedObjectId).toBeNull();
    expect(useStore.getState().additionalSelectedIds.size).toBe(0);
  });

  it('marks the survivor after deleting down to one artwork', async () => {
    mountHarness();
    await settle(() => {
      useStore.getState().importSvgObject(svgObj('A', [RED]));
      useStore.getState().importSvgObject(svgObj('B', [BLUE]));
      useStore.getState().removeSceneObject('B');
    });
    expect(useStore.getState().selectedObjectId).toBe('A');
  });

  it('does not mark a locked lone artwork', async () => {
    mountHarness();
    await settle(() => {
      useStore.getState().importSvgObject(svgObj('A', [RED]));
      useStore.getState().lockSelection();
    });
    expect(useStore.getState().selectedObjectId).toBeNull();
  });

  it('marks the artwork, not the registration jig, and never the jig alone', async () => {
    mountHarness();
    await settle(() => {
      useStore
        .getState()
        .setProject(
          projectWith(
            [createRegistrationBox({ widthMm: 100, heightMm: 50 }), svgObj('A', [RED])],
            [createRegistrationLayer(), createLayer({ id: RED, color: RED })],
          ),
        );
    });
    expect(useStore.getState().selectedObjectId).toBe('A');

    await settle(() => {
      useStore
        .getState()
        .setProject(
          projectWith(
            [createRegistrationBox({ widthMm: 100, heightMm: 50 })],
            [createRegistrationLayer()],
          ),
        );
    });
    expect(useStore.getState().selectedObjectId).toBeNull();
  });

  it('does not mark artwork on a hidden layer', async () => {
    mountHarness();
    await settle(() => {
      useStore
        .getState()
        .setProject(
          projectWith(
            [svgObj('A', [RED])],
            [{ ...createLayer({ id: RED, color: RED }), visible: false }],
          ),
        );
    });
    expect(useStore.getState().selectedObjectId).toBeNull();
  });
});
