import { beforeEach, describe, expect, it } from 'vitest';
import { createLayer, createProject } from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { cutShapesInBackground, offsetOutlinesInBackground } from './vector-background-commands';
import { parityObjects } from './vector-op-worker.test-fixture';

function load(): void {
  resetStore();
  useToastStore.setState({ toasts: [] });
  useStore.setState({
    project: {
      ...createProject(),
      scene: {
        objects: parityObjects(),
        layers: [createLayer({ id: 'cut', color: '#000000' })],
        groups: [],
      },
    },
    selectedObjectId: 'dense',
    additionalSelectedIds: new Set(['plate', 'square']),
    dirty: false,
  });
}

async function committed(run: () => unknown): Promise<string> {
  load();
  await run();
  return JSON.stringify(useStore.getState().project);
}

describe('one-click vector commands in the background (ADR-606)', () => {
  beforeEach(load);

  it.each([1, -0.6])('Offset outlines %s mm commits the in-thread document', async (deltaMm) => {
    const inThread = await committed(() => useStore.getState().offsetSelection(deltaMm));
    const background = await committed(() => offsetOutlinesInBackground(deltaMm));
    expect(background).toBe(inThread);
    expect(useStore.getState().project.scene.objects).toHaveLength(4);
  });

  it('Cut Shapes commits the in-thread document', async () => {
    const inThread = await committed(() => useStore.getState().cutSelectedShapes());
    const background = await committed(() => cutShapesInBackground());
    expect(background).toBe(inThread);
    expect(useStore.getState().undoStack).toHaveLength(1);
  });

  it('applies nothing when the selection changes while the work runs', async () => {
    const before = useStore.getState().project;
    const running = offsetOutlinesInBackground(1);
    useStore.setState({ additionalSelectedIds: new Set(['plate']) });
    await expect(running).resolves.toBe(false);
    expect(useStore.getState().project).toBe(before);
    expect(useToastStore.getState().toasts.map((toast) => toast.message)).toContain(
      'Offset outlines was not applied: the project or selection changed while it was worked out.',
    );
  });

  it('sends a refused selection straight to the action', async () => {
    useStore.setState({ selectedObjectId: 'dense', additionalSelectedIds: new Set() });
    const before = useStore.getState().project;
    await expect(cutShapesInBackground()).resolves.toBe(true);
    expect(useStore.getState().project).toBe(before);
    expect(useToastStore.getState().toasts.at(-1)?.variant).toBe('warning');
  });
});
