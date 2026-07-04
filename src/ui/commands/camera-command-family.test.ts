import { describe, expect, it, vi } from 'vitest';
import { cameraCommand } from './camera-command-family';
import { baseCtx } from './command-registry-test-helpers';

describe('cameraCommand', () => {
  it('is an enabled tools command that toggles the camera panel', () => {
    const toggleCameraPanel = vi.fn();
    const command = cameraCommand(baseCtx({ cameraPanelOpen: false, toggleCameraPanel }));
    expect(command.id).toBe('tools.camera');
    expect(command.family).toBe('tools');
    expect(command.label).toBe('Camera');
    expect(command.enabled).toBe(true);
    expect(command.active).toBe(false);
    command.invoke();
    expect(toggleCameraPanel).toHaveBeenCalledTimes(1);
  });

  it('reflects the open state through the active flag (title is the static help tooltip)', () => {
    const open = cameraCommand(baseCtx({ cameraPanelOpen: true }));
    const closed = cameraCommand(baseCtx({ cameraPanelOpen: false }));
    expect(open.active).toBe(true);
    expect(closed.active).toBe(false);
    // The registry resolves the tooltip from COMMAND_HELP, so the title is the
    // same regardless of state (matching tools.registration-jig); surfaces show
    // the open/closed state via aria-pressed from `active`.
    expect(open.title).toBe(closed.title);
    expect(open.title).toContain('camera panel');
  });
});
