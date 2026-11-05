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

  // UX audit U5-P3-12: the screen leads with what to do; the message and stack
  // are folded under Details for a problem report.
  it('leads with the next step and folds the stack under Details', () => {
    act(() => {
      root.render(
        <ErrorBoundary crashSave={{ isNeeded: () => true, run: vi.fn() }}>
          <Boom shouldThrow={true} />
        </ErrorBoundary>,
      );
    });
    const lead = container.querySelector('h2 + p');
    expect(lead?.textContent).toBe(
      'KerfDesk hit a problem and closed this view. Your design is still here: press Save project to keep it, then Try again.',
    );
    const details = container.querySelector('details');
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toBe('Details for a problem report');
    expect(details?.querySelector('pre')).not.toBeNull();
    expect(details?.textContent).toContain('test-boom');
    expect(container.textContent).toContain('support@kerfdesk.com');
  });

  it('says the design is saved when there is nothing to save', () => {
    act(() => {
      root.render(
        <ErrorBoundary crashSave={{ isNeeded: () => false, run: vi.fn() }}>
          <Boom shouldThrow={true} />
        </ErrorBoundary>,
      );
    });
    expect(container.querySelector('h2 + p')?.textContent).toBe(
      'KerfDesk hit a problem and closed this view. Your design is saved: press Try again.',
    );
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

  it('shows a working ABORT in the crash screen when motion was live (F60/F65)', () => {
    const trigger = vi.fn();
    act(() => {
      root.render(
        <ErrorBoundary softwareAbort={{ isMotionLive: () => true, trigger }}>
          <Boom shouldThrow={true} />
        </ErrorBoundary>,
      );
    });
    const estop = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'ABORT',
    );
    expect(estop).toBeDefined();
    act(() => {
      estop?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(trigger).toHaveBeenCalledOnce();
  });

  it('omits the crash-screen ABORT when nothing was moving', () => {
    act(() => {
      root.render(
        <ErrorBoundary softwareAbort={{ isMotionLive: () => false, trigger: vi.fn() }}>
          <Boom shouldThrow={true} />
        </ErrorBoundary>,
      );
    });
    const buttons = Array.from(container.querySelectorAll('button')).map(
      (b) => b.textContent ?? '',
    );
    expect(buttons).not.toContain('ABORT');
    expect(buttons).toContain('Try again');
  });

  // Rolling audit v5 J2-P2-3: a refusal thrown before any write is a failure too.
  it('shows a crash-screen ABORT that throws, and clears it when a retry succeeds', async () => {
    const trigger = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => {
        throw new Error('Connect to the laser first');
      })
      .mockResolvedValueOnce(undefined);
    act(() => {
      root.render(
        <ErrorBoundary softwareAbort={{ isMotionLive: () => true, trigger }}>
          <Boom shouldThrow={true} />
        </ErrorBoundary>,
      );
    });
    const abort = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'ABORT',
    );
    act(() => {
      abort?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('p[role="alert"]')?.textContent).toBe(
      'ABORT failed: Connect to the laser first. Use the physical E-stop or power cutoff now if ' +
        'the machine may still be moving or the laser on.',
    );
    await act(async () => abort?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(trigger).toHaveBeenCalledTimes(2);
    expect(container.querySelector('p[role="alert"]')).toBeNull();
  });

  // A host that throws must not take the crash screen with it (v4 H2-P3-1).
  it('keeps the crash screen when a crash host throws', () => {
    act(() => {
      root.render(
        <ErrorBoundary crashHosts={<Boom shouldThrow={true} />}>
          <Boom shouldThrow={true} />
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toContain('Something broke');
    expect(container.textContent).toContain('Try again');
  });

  // Audit 27-P2-2: the project lives in a store, so the crash screen can save it.
  it('offers Save for unsaved work and reports how it went', async () => {
    let finish: (result: 'saved' | 'cancelled' | 'failed') => void = () => undefined;
    const run = vi.fn(
      () =>
        new Promise<'saved' | 'cancelled' | 'failed'>((resolve) => {
          finish = resolve;
        }),
    );
    act(() => {
      root.render(
        <ErrorBoundary
          crashSave={{ isNeeded: () => true, run }}
          crashHosts={<p data-testid="host">close notice</p>}
        >
          <Boom shouldThrow={true} />
        </ErrorBoundary>,
      );
    });
    expect(container.querySelector('[data-testid="host"]')).not.toBeNull();
    const save = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Save project',
    );
    expect(save).toBeDefined();
    for (const [result, label] of [
      ['cancelled', 'Save project'],
      ['failed', 'Save failed. Try again'],
      ['saved', 'Saved'],
    ] as const) {
      act(() => {
        save?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      expect(save?.textContent).toBe('Saving…');
      expect(save?.disabled).toBe(true);
      await act(async () => finish(result));
      expect(save?.textContent).toBe(label);
    }
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('omits Save when there is no unsaved work', () => {
    act(() => {
      root.render(
        <ErrorBoundary crashSave={{ isNeeded: () => false, run: vi.fn() }}>
          <Boom shouldThrow={true} />
        </ErrorBoundary>,
      );
    });
    const buttons = Array.from(container.querySelectorAll('button')).map(
      (b) => b.textContent ?? '',
    );
    expect(buttons).not.toContain('Save project');
  });

  it('falls back to a manual-copy textarea instead of a blocking prompt (H13)', () => {
    // jsdom has no Clipboard API — exactly the insecure-context fallback
    // path. A native prompt here would suspend the renderer: if the crash
    // happened mid-job it freezes the ack pump, the Abort button, and the
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
