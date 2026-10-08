import { expect, it, vi } from 'vitest';

const entries = [
  ['hierarchy actions', () => import('./design-hierarchy-actions')],
  ['group actions', () => import('./scene-group-actions')],
  ['hierarchy session store', () => import('./design-hierarchy-store')],
  ['scene mutations', () => import('./scene-mutations')],
] as const;

// Different consumers enter this graph through actions, geometry and format
// modules. None may pull the composed store back into its own action factory.
it.each(entries)(
  'initializes from %s and clears focus synchronously on document replacement',
  async (_label, load) => {
    vi.resetModules();
    await load();
    const { useStore } = await import('./store');
    const { focusDesignHierarchy, useDesignHierarchyStore } =
      await import('./design-hierarchy-store');
    expect(useStore.getState().renameArtwork).toBeTypeOf('function');
    focusDesignHierarchy('focused-group', useStore.getState().projectDocumentEpoch);
    expect(useDesignHierarchyStore.getState().focusId).toBe('focused-group');
    useStore.getState().newProject();
    expect(useDesignHierarchyStore.getState().focusId).toBeNull();
    focusDesignHierarchy('next-focused-group', useStore.getState().projectDocumentEpoch);
    useStore.getState().setProject(useStore.getState().project);
    expect(useDesignHierarchyStore.getState().focusId).toBeNull();
  },
  // Cold transformation of the complete app graph is outside the behaviour under test.
  20_000,
);
