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

  it('reflects the open state through the active flag and fallback title', () => {
    const open = cameraCommand(baseCtx({ cameraPanelOpen: true }));
    const closed = cameraCommand(baseCtx({ cameraPanelOpen: false }));
    expect(open.active).toBe(true);
    expect(closed.active).toBe(false);
    // Camera is intentionally not registered while the feature is hidden. Until
    // it is restored to the command registry and help map, the dormant command
    // uses its local fallback title.
    expect(open.title).toBe('Close the camera panel');
    expect(closed.title).toContain('Open the camera panel');
    expect(open.title).toContain('camera panel');
  });
});
