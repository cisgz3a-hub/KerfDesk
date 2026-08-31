import { describe, expect, it, vi } from 'vitest';
import { installWindowReadinessPolicy } from './window-readiness-policy';

describe('desktop window readiness policy', () => {
  it('attaches the one-shot ready-to-show listener before renderer loading starts', () => {
    const actions: string[] = [];
    const show = vi.fn(() => actions.push('show'));
    const once = vi.fn((_event: 'ready-to-show', _listener: () => void) => {
      actions.push('listen');
    });
    const webOnce = vi.fn();
    const on = vi.fn();

    installWindowReadinessPolicy({ once, show, webContents: { once: webOnce, on } });
    actions.push('load');

    expect(once).toHaveBeenCalledOnce();
    expect(once).toHaveBeenCalledWith('ready-to-show', expect.any(Function));
    expect(webOnce).toHaveBeenCalledWith('did-finish-load', expect.any(Function));
    expect(on).toHaveBeenCalledWith('did-fail-load', expect.any(Function));
    expect(on).toHaveBeenCalledWith('render-process-gone', expect.any(Function));
    expect(actions).toEqual(['listen', 'load']);

    const listener = once.mock.calls[0]?.[1];
    expect(listener).toBeDefined();
    listener?.();
    expect(show).toHaveBeenCalledOnce();
    webOnce.mock.calls[0]?.[1]?.();
    expect(show).toHaveBeenCalledOnce();
  });

  it('shows and reports renderer failures instead of leaving a hidden process', () => {
    const show = vi.fn();
    const reportFailure = vi.fn();
    const listeners = new Map<string, (...args: ReadonlyArray<unknown>) => void>();
    installWindowReadinessPolicy(
      {
        once: vi.fn(),
        show,
        webContents: {
          once: vi.fn(),
          on: vi.fn((event, listener) => listeners.set(event, listener)),
        },
      },
      { reportFailure },
    );

    listeners.get('did-fail-load')?.();

    expect(show).toHaveBeenCalledOnce();
    expect(reportFailure).toHaveBeenCalledWith('KerfDesk could not load its application window.');
  });
});
