import { describe, expect, it, vi } from 'vitest';
import { placeBoardCommand } from './board-capture-command-family';
import { baseCtx } from './command-registry-test-helpers';

describe('placeBoardCommand', () => {
  it('is an enabled tools command that toggles the board-capture panel', () => {
    const toggleBoardCapturePanel = vi.fn();
    const command = placeBoardCommand(
      baseCtx({ boardCapturePanelOpen: false, toggleBoardCapturePanel }),
    );
    expect(command.id).toBe('tools.place-board');
    expect(command.family).toBe('tools');
    expect(command.label).toBe('Place Board');
    expect(command.enabled).toBe(true);
    expect(command.active).toBe(false);
    command.invoke();
    expect(toggleBoardCapturePanel).toHaveBeenCalledTimes(1);
  });

  it('reflects the open state through the active flag', () => {
    expect(placeBoardCommand(baseCtx({ boardCapturePanelOpen: true })).active).toBe(true);
    expect(placeBoardCommand(baseCtx({ boardCapturePanelOpen: false })).active).toBe(false);
  });
});
