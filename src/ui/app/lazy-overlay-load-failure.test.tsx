// A window left on the previous build asks for an overlay chunk that the new
// deploy removed. Each lazy overlay must fail on its own, with a notice and a
// Close that shuts it through its own store, while the workspace keeps running
// under the root ErrorBoundary that main.tsx mounts.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Vitest wraps a throwing mock factory in its own error, so each dynamic
// import below rejects the way a failed chunk fetch does in the browser.
vi.mock('../tutorials/TutorialCentre', () => {
  throw new TypeError('Failed to fetch dynamically imported module: TutorialCentre-0ld.js');
});
vi.mock('../image-editor/ImageEditorOverlay', () => {
  throw new TypeError('Failed to fetch dynamically imported module: ImageEditorOverlay-0ld.js');
});
vi.mock('../design-studio/DesignStudioOverlay', () => {
  throw new TypeError('Failed to fetch dynamically imported module: DesignStudioOverlay-0ld.js');
});

import { ErrorBoundary } from '../common/ErrorBoundary';
import { DesignStudioHost } from '../design-studio/DesignStudioHost';
import { useDesignStudioStore } from '../design-studio/design-studio-store';
import { createEditorTestBuffer } from '../image-editor/create-editor-test-buffer';
import { createSession } from '../image-editor/editor-session';
import { ImageEditorHost } from '../image-editor/ImageEditorHost';
import { useImageEditorStore } from '../image-editor/image-editor-store';
import { useUiStore } from '../state/ui-store';
import { TutorialHost } from '../tutorials/TutorialHost';
import { useTutorialStore } from '../tutorials/tutorial-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type OverlayCase = {
  readonly tool: string;
  readonly open: () => void;
  readonly isOpen: () => boolean;
  /** What closing through the tool's own store keeps for the next open. */
  readonly kept: () => boolean;
};

const CASES: ReadonlyArray<OverlayCase> = [
  {
    tool: 'The visual tutorials',
    open: () => useTutorialStore.getState().openTutorial(),
    isOpen: () => useTutorialStore.getState().isOpen,
    kept: () => true,
  },
  {
    tool: 'Image Studio',
    open: () =>
      useImageEditorStore.setState({
        session: createSession('photo-1', 'photo.png', createEditorTestBuffer(2, 2), {
          minX: 0,
          minY: 0,
          maxX: 2,
          maxY: 2,
        }),
        sessionOwner: null,
      }),
    isOpen: () => useImageEditorStore.getState().session !== null,
    kept: () => useImageEditorStore.getState().stash['photo-1'] !== undefined,
  },
  {
    tool: 'Design Studio',
    open: () => useDesignStudioStore.getState().openStudio(),
    isOpen: () => useDesignStudioStore.getState().session !== null,
    kept: () => useDesignStudioStore.getState().stash !== null,
  },
];

let root: Root | null = null;

function resetOverlays(): void {
  useTutorialStore.getState().closeTutorial();
  useImageEditorStore.setState({ session: null, sessionOwner: null, stash: {} });
  useDesignStudioStore.setState({ session: null, stash: null });
  useUiStore.setState({ modalDepth: 0 });
}

beforeEach(() => {
  // React logs every error a boundary catches.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  resetOverlays();
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  resetOverlays();
  localStorage.clear();
  vi.restoreAllMocks();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  }
}

async function renderApp(): Promise<void> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(
      <ErrorBoundary>
        <main data-testid="workspace">The operator&apos;s design</main>
        <ImageEditorHost />
        <DesignStudioHost />
        <TutorialHost />
      </ErrorBoundary>,
    );
  });
}

function closeButton(): HTMLButtonElement {
  const match = document.querySelector<HTMLButtonElement>(
    'button[title="Close this tool and return to your work"]',
  );
  if (match === null) throw new Error('The load-failure notice has no Close button');
  return match;
}

describe('an overlay whose chunk is gone after an update in another window', () => {
  it.each(CASES)('$tool fails on its own and Close shuts it', async (overlay) => {
    await renderApp();
    await act(async () => overlay.open());
    await settle();

    expect(document.body.textContent).toContain(`${overlay.tool} could not load`);
    expect(document.body.textContent).not.toContain('Something broke');
    expect(document.querySelector('[data-testid="workspace"]')).not.toBeNull();

    await act(async () => closeButton().click());
    expect(overlay.isOpen()).toBe(false);
    expect(overlay.kept()).toBe(true);
    expect(document.body.textContent).not.toContain('could not load');
    expect(document.querySelector('[data-testid="workspace"]')).not.toBeNull();
    expect(useUiStore.getState().modalDepth).toBe(0);
  });
});
