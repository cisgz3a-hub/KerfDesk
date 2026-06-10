import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ErrorBoundary } from './ErrorBoundary';

function Boom({ shouldThrow }: { readonly shouldThrow: boolean }): JSX.Element {
  if (shouldThrow) throw new Error('test-boom');
  return <div data-testid="ok">ok</div>;
}

describe('ErrorBoundary', () => {
  let container: HTMLDivElement;
  let root: Root;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    // React intentionally logs caught errors via console.error — silence
    // for the duration of the test so the suite output stays clean.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {
      /* silence */
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    consoleError.mockRestore();
  });

  it('renders children when no error is thrown', () => {
    act(() => {
      root.render(
        <ErrorBoundary>
          <Boom shouldThrow={false} />
        </ErrorBoundary>,
      );
    });
    expect(container.querySelector('[data-testid="ok"]')).not.toBeNull();
  });

  it('swaps in the CrashScreen when a child throws', () => {
    act(() => {
      root.render(
        <ErrorBoundary>
          <Boom shouldThrow={true} />
        </ErrorBoundary>,
      );
    });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).toContain('Something broke');
    expect(container.textContent).toContain('test-boom');
  });

  it('crash screen includes a Try again button and a Copy diagnostic button', () => {
    act(() => {
      root.render(
        <ErrorBoundary>
          <Boom shouldThrow={true} />
        </ErrorBoundary>,
      );
    });
    const buttons = Array.from(container.querySelectorAll('button')).map(
      (b) => b.textContent ?? '',
    );
    expect(buttons).toContain('Try again');
    expect(buttons).toContain('Copy diagnostic');
  });

  it('reassures the user no data leaves the machine', () => {
    act(() => {
      root.render(
        <ErrorBoundary>
          <Boom shouldThrow={true} />
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toMatch(/no data leaves your machine/i);
  });

  it('falls back to a manual-copy textarea instead of a blocking prompt (H13)', () => {
    // jsdom has no Clipboard API — exactly the insecure-context fallback
    // path. A native prompt here would suspend the renderer: if the crash
    // happened mid-job it freezes the ack pump, the Stop button, and the
    // M22 keyboard stop. The fallback must be non-blocking.
    const promptSpy = vi.spyOn(window, 'prompt').mockImplementation(() => null);
    act(() => {
      root.render(
        <ErrorBoundary>
          <Boom shouldThrow={true} />
        </ErrorBoundary>,
      );
    });
    const copy = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Copy diagnostic',
    );
    expect(copy).toBeDefined();
    act(() => {
      copy?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(promptSpy).not.toHaveBeenCalled();
    const textarea = container.querySelector('textarea');
    expect(textarea).not.toBeNull();
    expect(textarea?.value).toContain('test-boom');
    promptSpy.mockRestore();
  });
});
