import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDesignStudioStore } from '../design-studio';
import { setActiveEdition, UNRESTRICTED_EDITION } from '../licensing/edition';
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
    setActiveEdition({ ...UNRESTRICTED_EDITION, pro: allowed, requestPro });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <>
          <Toolbar commands={[]} machineKind="laser" />
          <ToolStrip />
        </>,
      );
    });
    const entries = host.querySelectorAll<HTMLButtonElement>('[aria-label="Open Design Studio"]');
    expect(entries).toHaveLength(1);
    const button = entries[0];
    expect(button?.closest('[aria-label="Toolbar"]')).not.toBeNull();
    expect(button?.textContent).toContain('Pro');
    await act(async () => button?.click());
    expect(requestPro).toHaveBeenCalledWith('design-studio', expect.any(Function));
    expect(open).toHaveBeenCalledTimes(allowed ? 1 : 0);
  });
});
