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
});
