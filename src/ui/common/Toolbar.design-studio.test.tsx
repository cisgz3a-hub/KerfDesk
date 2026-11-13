import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDesignStudioStore } from '../design-studio/design-studio-store';
import { EditionContext, setActiveEdition, UNRESTRICTED_EDITION } from '../licensing/edition';
import { ToolStrip } from '../workspace/ToolStrip';
import { Toolbar } from './Toolbar';

let host: HTMLDivElement | undefined;
let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  setActiveEdition(null);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Design Studio toolbar entry', () => {
  it.each([false, true])('opens only when the Pro gate allows it (%s)', async (allowed) => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const open = vi
      .spyOn(useDesignStudioStore.getState(), 'openStudio')
      .mockImplementation(() => undefined);
    const requestPro = vi.fn((_feature, onAllowed?: () => void) => {
      if (allowed) onAllowed?.();
      return allowed;
    });
    const edition = { ...UNRESTRICTED_EDITION, pro: allowed, requestPro };
    setActiveEdition(edition);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <EditionContext.Provider value={edition}>
          <Toolbar commands={[]} machineKind="laser" />
          <ToolStrip />
        </EditionContext.Provider>,
      );
    });
    const entries = host.querySelectorAll<HTMLButtonElement>('[aria-label="Open Design Studio"]');
    expect(entries).toHaveLength(1);
    const button = entries[0];
    expect(button?.closest('[aria-label="Toolbar"]')).not.toBeNull();
    // Labelled Pro only while Pro is locked.
    expect(button?.querySelector('.lf-toolbar-pro-badge') !== null).toBe(!allowed);
    expect(button?.title.includes('(Pro)')).toBe(!allowed);
    await act(async () => button?.click());
    expect(requestPro).toHaveBeenCalledWith('design-studio', expect.any(Function));
    expect(open).toHaveBeenCalledTimes(allowed ? 1 : 0);
  });
});
