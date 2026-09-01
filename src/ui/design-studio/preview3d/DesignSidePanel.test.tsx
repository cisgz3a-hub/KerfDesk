import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NO_MODIFIERS } from '../design-draft';
import { handleDesignStudioKey } from '../design-shortcuts';
import { useDesignStudioStore } from '../design-studio-store';
import { DesignSidePanel } from './DesignSidePanel';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  localStorage.clear();
  useDesignStudioStore.setState({ session: null, stash: null });
  const store = useDesignStudioStore.getState();
  store.openStudio();
  store.setTool('rect');
  store.setDraft({
    tool: 'rect',
    anchorMm: { x: 0, y: 0 },
    pointerMm: { x: 20, y: 20 },
    modifiers: NO_MODIFIERS,
  });
  store.commitDraft('selected-rect');
  store.setTool('select');
  store.setSelection(['selected-rect']);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  localStorage.clear();
  useDesignStudioStore.setState({ session: null, stash: null });
});

describe('DesignSidePanel keyboard ownership', () => {
  it('resizes on a bubbled arrow without also moving selected geometry or history', () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        <div onKeyDown={(event) => handleDesignStudioKey(event, () => undefined)}>
          <DesignSidePanel />
        </div>,
      );
    });

    const separator = host.querySelector('[role="separator"]');
    const panel = host.querySelector('aside[aria-label="Carve layers panel"]');
    if (!(separator instanceof HTMLElement) || !(panel instanceof HTMLElement)) {
      throw new Error('Design Studio resize surface did not render');
    }
    const before = structuredClone(requiredSession().history.present.entities);
    const historyDepth = requiredSession().history.past.length;
    expect(panel.style.width).toBe('300px');

    const event = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      separator.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(panel.style.width).toBe('316px');
    expect(requiredSession().history.present.entities).toEqual(before);
    expect(requiredSession().history.past).toHaveLength(historyDepth);
  });
});

function requiredSession() {
  const session = useDesignStudioStore.getState().session;
  if (session === null) throw new Error('expected an open Design Studio session');
  return session;
}
