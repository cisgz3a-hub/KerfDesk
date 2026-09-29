import { act, lazy, Suspense, useState, type ComponentType } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUiStore } from '../state/ui-store';
import { ErrorBoundary } from './ErrorBoundary';
import { LAZY_LOAD_FAILURE_ADVICE, rejectAsLoadFailure } from './lazy-load-failure';
import { LazyOverlayBoundary } from './LazyOverlayBoundary';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Chrome's wording when a window on the previous build asks for a hashed chunk
// that the deploy removed.
const staleChunk = (): Promise<{ default: ComponentType }> =>
  Promise.reject(
    new TypeError(
      'Failed to fetch dynamically imported module: https://kerfdesk.test/assets/Tool-0ld.js',
    ),
  );

let root: Root | null = null;

beforeEach(() => {
  // React logs every error a boundary catches.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  useUiStore.setState({ modalDepth: 0 });
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  root = null;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function Workspace(props: {
  readonly Tool: ComponentType;
  readonly presentation?: 'dialog' | 'inline';
  readonly onClose?: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <>
      <main data-testid="workspace">The operator&apos;s design</main>
      <button type="button" onClick={() => setOpen(true)}>
        Open tool
      </button>
      {open && (
        <LazyOverlayBoundary
          toolName="Test Studio"
          presentation={props.presentation ?? 'dialog'}
          onClose={() => {
            props.onClose?.();
            setOpen(false);
          }}
        >
          <Suspense fallback={<p role="status">Opening…</p>}>
            <props.Tool />
          </Suspense>
        </LazyOverlayBoundary>
      )}
    </>
  );
}

async function renderApp(node: JSX.Element): Promise<void> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host);
    root.render(<ErrorBoundary>{node}</ErrorBoundary>);
  });
  await settle();
}

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  }
}

function button(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll('button')].find((b) => b.textContent === label);
  if (match === undefined) throw new Error(`Missing button: ${label}`);
  return match;
}

const workspace = (): Element | null => document.querySelector('[data-testid="workspace"]');
const crashScreen = (): boolean => document.body.textContent?.includes('Something broke') === true;

describe('LazyOverlayBoundary', () => {
  it('shows a notice in place of a tool whose code cannot be fetched and keeps the app running', async () => {
    await renderApp(<Workspace Tool={lazy(() => staleChunk().catch(rejectAsLoadFailure))} />);

    const notice = document.querySelector('[role="dialog"][aria-modal="true"]');
    expect(notice?.textContent).toContain('Test Studio could not load');
    expect(notice?.textContent).toContain(LAZY_LOAD_FAILURE_ADVICE);
    expect(workspace()).not.toBeNull();
    expect(crashScreen()).toBe(false);
    // The tool it stands in for was modal, so app shortcuts still yield.
    expect(useUiStore.getState().modalDepth).toBe(1);
    expect(document.activeElement).toBe(button('Close'));
  });

  it('closes the tool on Close, and a reopen shows the notice again instead of crashing', async () => {
    const onClose = vi.fn();
    await renderApp(
      <Workspace Tool={lazy(() => staleChunk().catch(rejectAsLoadFailure))} onClose={onClose} />,
    );

    await act(async () => button('Close').click());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(useUiStore.getState().modalDepth).toBe(0);
    expect(workspace()).not.toBeNull();

    // React.lazy keeps the rejection, so the same window cannot load the tool;
    // it must say so again, never loop through the crash screen.
    await act(async () => button('Open tool').click());
    await settle();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('could not load');
    expect(crashScreen()).toBe(false);
  });

  it('closes on Escape like any other dialog', async () => {
    const onClose = vi.fn();
    await renderApp(
      <Workspace Tool={lazy(() => staleChunk().catch(rejectAsLoadFailure))} onClose={onClose} />,
    );

    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('sits inline inside a dialog frame the host already provides', async () => {
    await renderApp(
      <Workspace
        Tool={lazy(() => staleChunk().catch(rejectAsLoadFailure))}
        presentation="inline"
      />,
    );

    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      'Test Studio could not load',
    );
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(useUiStore.getState().modalDepth).toBe(0);
    expect(workspace()).not.toBeNull();
  });

  it('leaves a bug inside a loaded tool to the root crash screen', async () => {
    function BrokenTool(): JSX.Element {
      throw new Error('tool bug');
    }
    await renderApp(<Workspace Tool={BrokenTool} />);

    expect(crashScreen()).toBe(true);
    expect(document.body.textContent).toContain('tool bug');
    expect(document.body.textContent).not.toContain('could not load');
  });
});
