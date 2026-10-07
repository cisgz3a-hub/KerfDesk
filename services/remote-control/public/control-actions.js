import { $, continueToMcp } from './control-model.js';
import { routeSetupHint } from './control-workspace.js';
import { pairingDeadline } from './pairing.js';

/** Session UI only. The owner retains API admission, pending receipts and pairing generations. */
export function bindSessionActions(options) {
  const { action, notice, touch, scanner } = options;
  for (const tab of document.querySelectorAll('button[data-view]'))
    tab.addEventListener('click', () => {
      if (!['artwork', 'edit'].includes(tab.dataset.view)) touch.reset();
    });
  for (const button of document.querySelectorAll('#retry-edit,#editor-retry'))
    button.addEventListener('click', () => {
      void action(options.performPendingEdit);
    });
  $('#refresh').addEventListener('click', () => {
    touch.reset();
    void action(async () => {
      if (await options.refresh())
        notice(
          options.hasPendingEdit()
            ? 'Workspace refreshed. Retry the last request to resolve its result.'
            : 'Workspace refreshed.',
        );
    });
  });
  $('#disconnect').addEventListener('click', () => {
    scanner.stop();
    touch.reset();
    void action(async () => {
      await options.disconnect();
      notice('This phone is disconnected.');
    });
  });
  routeSetupHint();
  if (document.documentElement.dataset.pairingBlocked) {
    notice(
      'Open a clean phone control page using the KerfDesk link above, then paste a new code.',
      true,
    );
    options.syncControls();
  }
  void action(async () => {
    const generation = options.generation();
    let admitted = false;
    try {
      const value = await options.api('/api/session', undefined, generation);
      if (value.status === 'approved') {
        admitted = true;
        options.setSession(value);
        if (!continueToMcp()) await options.refresh(generation);
      } else if (value.status === 'pending') {
        $('#pair-status').textContent = 'Waiting for approval on the PC…';
        await options.pairStatus(pairingDeadline(value.expiresInMs), options.generation());
      }
    } catch (error) {
      if (!options.session()) options.setSession(null);
      if (admitted) notice(error.message, true);
    }
  });
}
