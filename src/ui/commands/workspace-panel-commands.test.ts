import { describe, expect, it, vi } from 'vitest';
import { handleViewShortcut } from '../app/shortcuts';
import { baseCtx } from './command-registry-test-helpers';
import { buildAppCommands, commandById, runCommand } from './command-registry';

describe('workspace panel commands', () => {
  it('provides familiar toggle-all and reset-layout commands', () => {
    const toggleSidePanels = vi.fn();
    const resetWorkspaceLayout = vi.fn();
    const commands = buildAppCommands(baseCtx({ toggleSidePanels, resetWorkspaceLayout }));

    const toggle = commandById(commands, 'window.toggle-side-panels');
    const reset = commandById(commands, 'window.reset-layout');
    expect(toggle.shortcut).toBe('F12');
    expect(runCommand(toggle)).toBe(true);
    expect(runCommand(reset)).toBe(true);
    expect(toggleSidePanels).toHaveBeenCalledTimes(1);
    expect(resetWorkspaceLayout).toHaveBeenCalledTimes(1);
  });

  it('blocks the toggle-all command during an active job', () => {
    const toggleSidePanels = vi.fn();
    const command = commandById(
      buildAppCommands(baseCtx({ jobActive: true, toggleSidePanels })),
      'window.toggle-side-panels',
    );

    expect(command.enabled).toBe(false);
    expect(command.disabledReason).toContain('Stop remains reachable');
    expect(runCommand(command)).toBe(false);
    expect(toggleSidePanels).not.toHaveBeenCalled();
  });

  it('dispatches F12 outside editable controls', () => {
    const div = document.createElement('div');
    document.body.appendChild(div);
    const toggleSidePanels = vi.fn();
    const event = new KeyboardEvent('keydown', { key: 'F12', cancelable: true });
    Object.defineProperty(event, 'target', { value: div });

    expect(
      handleViewShortcut(event, {
        togglePreview: vi.fn(),
        resetView: vi.fn(),
        zoomBy: vi.fn(),
        fitToSelection: vi.fn(),
        toggleSidePanels,
      }),
    ).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(toggleSidePanels).toHaveBeenCalledTimes(1);
    div.remove();
  });
});
