import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { ReliefHeightfieldMapping } from '../../core/scene/relief';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { ReliefResolvedAspectDisclosure } from './ReliefResolvedAspectDisclosure';

// React exposes no narrower typed test seam for this documented act-environment flag.
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  resetStore();
  document.body.replaceChildren();
});

async function render(aspect: ReliefHeightfieldMapping['aspect']): Promise<{
  readonly host: HTMLDivElement;
  readonly root: Root;
}> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<ReliefResolvedAspectDisclosure aspect={aspect} />));
  return { host, root };
}

describe('ReliefResolvedAspectDisclosure', () => {
  const cases: ReadonlyArray<readonly [ReliefHeightfieldMapping['aspect'], string, string]> = [
    [
      'preserve',
      'Preserve',
      'Width edits preserve the current canonical physical aspect when the derived Height rounds to a positive finite value.',
    ],
    [
      'stretch',
      'Stretch',
      'Width and Height are resolved independently; Width edits retain the current canonical Height.',
    ],
  ];

  it.each(cases)('renders exact read-only %s policy copy', async (aspect, label, description) => {
    const beforeProject = useStore.getState().project;
    const beforeUndo = useStore.getState().undoStack;
    const beforeDirty = useStore.getState().dirty;
    const { host, root } = await render(aspect);
    try {
      const policy = host.querySelector('[aria-label="Resolved aspect policy"]');
      if (!(policy instanceof HTMLElement)) throw new Error('resolved aspect policy missing');
      expect(policy.querySelector('h4')?.textContent).toBe('Resolved aspect policy');
      expect(policy.querySelector('dt')?.textContent).toBe(label);
      expect(policy.querySelector('dd')?.textContent).toBe(description);
      expect(policy.querySelector('p')?.textContent).toBe(
        'This is recorded/resolved editor policy, not another CAM transform.',
      );
      expect(policy.querySelector('input, select, button')).toBeNull();
      expect(useStore.getState().project).toBe(beforeProject);
      expect(useStore.getState().undoStack).toBe(beforeUndo);
      expect(useStore.getState().dirty).toBe(beforeDirty);
    } finally {
      await act(async () => root.unmount());
    }
  });
});
