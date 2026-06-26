import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from './store';
import { resetStore } from './test-helpers';

describe('saved libraries actions', () => {
  beforeEach(() => {
    resetStore();
  });

  it('createLibrary activates a new empty library and lists it', () => {
    const id = useStore.getState().createLibrary('Birch Plywood');

    expect(id).not.toBeNull();
    const state = useStore.getState();
    expect(state.materialLibrary?.name).toBe('Birch Plywood');
    expect(state.materialLibrary?.entries).toEqual([]);
    expect(state.savedLibraries.activeLibraryId).toBe(id);
    const list = state.listSavedLibraries();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('Birch Plywood');
    expect(list[0]?.isActive).toBe(true);
  });

  it('createLibrary rejects a blank name and gives colliding names unique ids', () => {
    expect(useStore.getState().createLibrary('   ')).toBeNull();
    const first = useStore.getState().createLibrary('Acrylic');
    const second = useStore.getState().createLibrary('Acrylic');
    expect(first).toBe('acrylic');
    expect(second).toBe('acrylic-2');
    expect(useStore.getState().listSavedLibraries()).toHaveLength(2);
  });

  it('openSavedLibrary switches the active library and no-ops for a missing id', () => {
    const first = useStore.getState().createLibrary('First');
    useStore.getState().createLibrary('Second'); // Second is now active.

    expect(first).not.toBeNull();
    expect(useStore.getState().openSavedLibrary(first as string)).toBe(true);
    expect(useStore.getState().materialLibrary?.name).toBe('First');
    expect(useStore.getState().savedLibraries.activeLibraryId).toBe(first);

    expect(useStore.getState().openSavedLibrary('missing')).toBe(false);
    expect(useStore.getState().materialLibrary?.name).toBe('First');
  });

  it('renameLibrary renames the active library and rejects blank / missing / unchanged', () => {
    const id = useStore.getState().createLibrary('Old Name') as string;

    expect(useStore.getState().renameLibrary(id, 'New Name')).toBe(true);
    expect(useStore.getState().materialLibrary?.name).toBe('New Name');
    expect(useStore.getState().listSavedLibraries()[0]?.name).toBe('New Name');

    expect(useStore.getState().renameLibrary(id, '  ')).toBe(false);
    expect(useStore.getState().renameLibrary('missing', 'x')).toBe(false);
    expect(useStore.getState().renameLibrary(id, 'New Name')).toBe(false);
  });

  it('duplicateLibrary copies into the list without changing the active library', () => {
    const id = useStore.getState().createLibrary('Source') as string;

    const copyId = useStore.getState().duplicateLibrary(id);

    expect(copyId).not.toBeNull();
    expect(copyId).not.toBe(id);
    const state = useStore.getState();
    expect(state.savedLibraries.activeLibraryId).toBe(id); // still the original
    const names = state.listSavedLibraries().map((s) => s.name);
    expect(names).toContain('Source');
    expect(names).toContain('Source copy');
    expect(useStore.getState().duplicateLibrary('missing')).toBeNull();
  });

  it('deleteLibrary removes an entry; deleting the active one clears the loaded library', () => {
    const first = useStore.getState().createLibrary('First') as string;
    useStore.getState().createLibrary('Second'); // active

    // Delete the inactive one: active library is untouched.
    expect(useStore.getState().deleteLibrary(first)).toBe(true);
    expect(useStore.getState().materialLibrary?.name).toBe('Second');
    expect(useStore.getState().listSavedLibraries()).toHaveLength(1);

    // Delete the active one: nothing loaded, list empty.
    const second = useStore.getState().savedLibraries.activeLibraryId as string;
    expect(useStore.getState().deleteLibrary(second)).toBe(true);
    expect(useStore.getState().materialLibrary).toBeNull();
    expect(useStore.getState().listSavedLibraries()).toHaveLength(0);

    expect(useStore.getState().deleteLibrary('missing')).toBe(false);
  });
});
