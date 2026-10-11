import { describe, expect, it, vi } from 'vitest';
import { trackConsoleWcs } from './frame-wcs-selection';

describe('Console WCS tracking', () => {
  it.each(['G55', 'G055', 'G 55', 'G+55.000', 'G55X0', 'G55 (G54)', 'G55 ; G54', 'G55 (G54'])(
    'tracks the actual WCS word in %s',
    async (command) => {
      const set = vi.fn();
      await track(set, command);
      expect(set).toHaveBeenCalledWith({ activeWcs: 'G55' });
    },
  );

  it.each(['G1 X0 (G55)', 'G1 X0 ; G55', 'G92 X0'])(
    'does not invent a WCS selection from %s',
    async (command) => {
      const set = vi.fn();
      await track(set, command);
      expect(set).not.toHaveBeenCalled();
    },
  );

  it.each(['G55.0001', 'G59.1'])(
    'requires readback for dialect-specific WCS spelling %s',
    async (command) => {
      const set = vi.fn();
      await track(set, command);
      expect(set).toHaveBeenCalledWith({ activeWcs: null });
    },
  );
});

async function track(set: Parameters<typeof trackConsoleWcs>[0], command: string): Promise<void> {
  // Non-reference commands do not read or write transport state in this helper.
  await trackConsoleWcs(
    set,
    vi.fn(),
    {} as Parameters<typeof trackConsoleWcs>[2],
    { normalized: command, stateEffect: 'coordinates-all' },
    vi.fn(),
  );
}
