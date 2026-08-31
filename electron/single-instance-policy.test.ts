import { describe, expect, it, vi } from 'vitest';
import { revealPrimaryWindow } from './single-instance-policy';

describe('desktop single-instance policy', () => {
  it('restores, shows, and focuses a minimized primary window', () => {
    const target = {
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
    };

    revealPrimaryWindow(target);

    expect(target.restore).toHaveBeenCalledOnce();
    expect(target.show).toHaveBeenCalledOnce();
    expect(target.focus).toHaveBeenCalledOnce();
  });
});
