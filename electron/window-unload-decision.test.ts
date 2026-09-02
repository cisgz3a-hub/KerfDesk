import { describe, expect, it, vi } from 'vitest';
import { installWindowUnloadDecision } from './window-unload-decision';

describe('desktop window unload decision', () => {
  it('keeps the renderer unload blocked when the operator chooses Stay', () => {
    const listeners = new Map<string, (event: { preventDefault(): void }) => void>();
    const decide = vi.fn(() => 'stay' as const);
    installWindowUnloadDecision(
      {
        webContents: {
          on: vi.fn((event, listener) => listeners.set(event, listener)),
        },
      },
      decide,
    );

    const event = { preventDefault: vi.fn() };
    listeners.get('will-prevent-unload')?.(event);

    expect(decide).toHaveBeenCalledOnce();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('allows the exact renderer-requested unload when the operator chooses Leave', () => {
    const listeners = new Map<string, (event: { preventDefault(): void }) => void>();
    installWindowUnloadDecision(
      {
        webContents: {
          on: vi.fn((event, listener) => listeners.set(event, listener)),
        },
      },
      () => 'leave',
    );

    const event = { preventDefault: vi.fn() };
    listeners.get('will-prevent-unload')?.(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
  });
});
