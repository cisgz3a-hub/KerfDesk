import { describe, expect, it, vi } from 'vitest';

import { AUTOSAVE_FAILURE_MESSAGE, createAutosaveFailureReporter } from './use-autosave';

describe('createAutosaveFailureReporter', () => {
  it('shows one manual-save warning when autosave writes fail', () => {
    const pushToast = vi.fn();
    const reportFailure = createAutosaveFailureReporter(pushToast);

    reportFailure();
    reportFailure();

    expect(pushToast).toHaveBeenCalledTimes(1);
    expect(pushToast).toHaveBeenCalledWith(AUTOSAVE_FAILURE_MESSAGE, 'warning');
    expect(AUTOSAVE_FAILURE_MESSAGE).toContain('Save the .lf2 file manually');
  });
});
