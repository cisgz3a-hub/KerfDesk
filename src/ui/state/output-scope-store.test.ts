import { beforeEach, describe, expect, it } from 'vitest';
import { currentOutputScope, useStore } from './store';
import { resetStore as reset } from './test-helpers';

describe('useStore output scope settings', () => {
  beforeEach(() => {
    reset();
  });

  it('defaults to full-project output', () => {
    expect(useStore.getState().outputScopeSettings).toEqual({
      cutSelectedGraphics: false,
      useSelectionOrigin: false,
    });
  });

  it('updates Cut Selected Graphics and Use Selection Origin independently', () => {
    useStore.getState().setOutputScopeSettings({
      cutSelectedGraphics: true,
      useSelectionOrigin: true,
    });

    expect(useStore.getState().outputScopeSettings).toEqual({
      cutSelectedGraphics: true,
      useSelectionOrigin: true,
    });
  });

  it('turns off Use Selection Origin when Cut Selected Graphics is disabled', () => {
    useStore.getState().setOutputScopeSettings({
      cutSelectedGraphics: true,
      useSelectionOrigin: true,
    });
    useStore.getState().setOutputScopeSettings({ cutSelectedGraphics: false });

    expect(useStore.getState().outputScopeSettings).toEqual({
      cutSelectedGraphics: false,
      useSelectionOrigin: false,
    });
  });

  it('builds runtime output scope from the current selection', () => {
    useStore.setState({
      selectedObjectId: 'A',
      additionalSelectedIds: new Set(['B']),
    });
    useStore.getState().setOutputScopeSettings({ cutSelectedGraphics: true });

    expect(currentOutputScope(useStore.getState())).toEqual({
      cutSelectedGraphics: true,
      useSelectionOrigin: false,
      selectedObjectIds: ['A', 'B'],
    });
  });
});
