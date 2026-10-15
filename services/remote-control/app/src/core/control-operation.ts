import { store } from './store';
import { TERMINAL_STATES, type ControlOperation } from './types';
import type { RemoteTransport } from './transport';

/** Reads the receipt until it settles. Never re-sends the action or crosses connections. */
export async function followControlOperation(
  transport: RemoteTransport,
  operationId: string,
  current: () => boolean,
  refreshMachine: () => Promise<void>,
): Promise<void> {
  for (let attempt = 0; attempt < 150 && current(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, attempt < 5 ? 600 : 1200));
    if (!current()) return;
    const result = await transport
      .call<{ operation: ControlOperation }>('get_control_operation', { operationId })
      .catch(() => null);
    if (!current()) return;
    if (result === null) continue;
    if (store.get().operation?.operationId === operationId || store.get().operation === null)
      store.set({ operation: result.operation });
    const state = result.operation.state;
    if (state === 'awaiting_review' && result.operation.review !== undefined) {
      store.set({ sheet: { kind: 'review' } });
      return;
    }
    if (TERMINAL_STATES.has(state)) {
      if (state === 'failed' || state === 'unknown')
        store.toast(result.operation.message ?? 'Check the machine on the PC.', 'warning');
      void refreshMachine();
      return;
    }
  }
}
