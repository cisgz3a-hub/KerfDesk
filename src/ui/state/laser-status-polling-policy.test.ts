import { describe, expect, it } from 'vitest';
import { interactiveControllerOperation } from './laser-controller-operation';
import { controllerOperationOwnsPolling } from './laser-status-polling-policy';
import { useLaserStore } from './laser-store';

describe('controllerOperationOwnsPolling', () => {
  it('keeps realtime polling available to a Set Origin interactive operation', () => {
    const state = {
      ...useLaserStore.getState(),
      controllerOperation: interactiveControllerOperation('Set work origin'),
    };

    expect(controllerOperationOwnsPolling(state)).toBe(false);
  });

  it('pauses polling only for an explicit terminal settings exchange', () => {
    const state = {
      ...useLaserStore.getState(),
      controllerOperation: interactiveControllerOperation(
        'Reading controller settings',
        'terminal-exchange',
      ),
    };

    expect(controllerOperationOwnsPolling(state)).toBe(true);
  });
});
