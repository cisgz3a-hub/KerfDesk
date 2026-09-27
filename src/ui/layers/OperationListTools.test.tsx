import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import { useStore } from '../state';
import type { OperationListActions } from '../state/operation-list-actions';
import { CutsLayersPanel } from './CutsLayersPanel';
import { arrangeTwo, button, click, layer, mount } from './control-audit-test-support';

let originalActions: OperationListActions;

beforeEach(() => {
  const state = useStore.getState();
  originalActions = {
    setAllLayersOutput: state.setAllLayersOutput,
    setAllLayersVisible: state.setAllLayersVisible,
    showOnlyLayer: state.showOnlyLayer,
    sortCutsLast: state.sortCutsLast,
  };
});
afterEach(() => useStore.setState(originalActions));

describe('operations list tools', () => {
  it('calls the bulk output, visibility and sort actions from the list header menu', async () => {
    arrangeTwo();
    const actions = stubActions();
    const host = await mount(<CutsLayersPanel />);
    await openDisclosure(host, 'All operations');
    await openDisclosure(host, 'Operation list tools');

    await click(button(host, 'Turn output on for all'));
    await click(button(host, 'Turn output off for all'));
    await click(button(host, 'Invert output'));
    await click(button(host, 'Show all'));
    await click(button(host, 'Hide all'));
    await click(button(host, 'Invert visibility'));
    const sort = button(host, 'Sort cuts last');
    expect(sort.disabled).toBe(false);
    await click(sort);

    expect(actions.setAllLayersOutput.mock.calls).toEqual([[true], [false], ['invert']]);
    expect(actions.setAllLayersVisible.mock.calls).toEqual([[true], [false], ['invert']]);
    expect(actions.sortCutsLast).toHaveBeenCalledTimes(1);
  });

  it('disables Sort cuts last in CNC mode and says why', async () => {
    arrangeTwo();
    const actions = stubActions();
    useStore.setState({
      project: { ...useStore.getState().project, machine: DEFAULT_CNC_MACHINE_CONFIG },
    });
    const host = await mount(<CutsLayersPanel />);
    await openDisclosure(host, 'All operations');
    await openDisclosure(host, 'Operation list tools');

    const sort = button(host, 'Sort cuts last');
    expect(sort.disabled).toBe(true);
    expect(sort.title).toBe('CNC already runs profiles last');
    await act(async () => sort.click());
    expect(actions.sortCutsLast).not.toHaveBeenCalled();
    expect(button(host, 'Hide all').disabled).toBe(false);
  });

  it('offers Show only this in each operation row menu', async () => {
    arrangeTwo();
    const actions = stubActions();
    const target = layer(1);
    const host = await mount(<CutsLayersPanel />);
    await openDisclosure(host, 'All operations');
    await openDisclosure(host, `More controls for ${target.name}`);

    await click(button(host, `Show only ${target.name}`));

    expect(actions.showOnlyLayer).toHaveBeenCalledWith(target.id);
  });

  it('hides every other operation through the real store action', async () => {
    arrangeTwo();
    const target = layer(0);
    const host = await mount(<CutsLayersPanel />);
    await openDisclosure(host, 'All operations');
    await openDisclosure(host, `More controls for ${target.name}`);

    await click(button(host, `Show only ${target.name}`));

    expect(useStore.getState().project.scene.layers.map((entry) => entry.visible)).toEqual([
      true,
      false,
    ]);
  });
});

function stubActions(): {
  readonly setAllLayersOutput: ReturnType<typeof vi.fn>;
  readonly setAllLayersVisible: ReturnType<typeof vi.fn>;
  readonly showOnlyLayer: ReturnType<typeof vi.fn>;
  readonly sortCutsLast: ReturnType<typeof vi.fn>;
} {
  const stubs = {
    setAllLayersOutput: vi.fn(),
    setAllLayersVisible: vi.fn(),
    showOnlyLayer: vi.fn(),
    sortCutsLast: vi.fn(),
  };
  useStore.setState(stubs);
  return stubs;
}

async function openDisclosure(host: HTMLElement, label: string): Promise<void> {
  const summary = [...host.querySelectorAll('summary')].find(
    (element) =>
      element.getAttribute('aria-label') === label || element.textContent?.trim().startsWith(label),
  );
  const details = summary?.closest('details');
  if (summary === undefined || details === null || details === undefined)
    throw new Error(`Missing disclosure: ${label}`);
  if (!details.open) await click(summary);
  expect(details.open).toBe(true);
}
