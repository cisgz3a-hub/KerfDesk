import { describe, expect, it, vi } from 'vitest';
import { installWindowReadinessPolicy } from './window-readiness-policy';

describe('desktop window readiness policy', () => {
  it('attaches the one-shot ready-to-show listener before renderer loading starts', () => {
    const actions: string[] = [];
    const show = vi.fn(() => actions.push('show'));
    const once = vi.fn((_event: 'ready-to-show', _listener: () => void) => {
      actions.push('listen');
    });

    installWindowReadinessPolicy({ once, show });
    actions.push('load');

    expect(once).toHaveBeenCalledOnce();
    expect(once).toHaveBeenCalledWith('ready-to-show', expect.any(Function));
    expect(actions).toEqual(['listen', 'load']);

    const listener = once.mock.calls[0]?.[1];
    expect(listener).toBeDefined();
    listener?.();
    expect(show).toHaveBeenCalledOnce();
  });
});
