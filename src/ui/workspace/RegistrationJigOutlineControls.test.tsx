import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { createProject } from '../../core/scene';
import { useStore } from '../state/store';
import { RegistrationJigOutlineControls } from './RegistrationJigOutlineControls';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const initial = useStore.getState();
afterEach(() => useStore.setState(initial, true));

describe('jig construction draft validation', () => {
  it.each(['', '0', '1.5', '10000'])(
    'keeps invalid or oversized grid %s out of the scene',
    async (rows) => {
      useStore.setState({ project: createProject(), undoStack: [] });
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = createRoot(host);
      try {
        await act(async () => root.render(<RegistrationJigOutlineControls />));
        const setField = async (label: string, value: string): Promise<void> => {
          const input = host.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
          if (input === null) throw new Error(`Missing ${label}`);
          await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
              input,
              value,
            );
            input.dispatchEvent(new Event('input', { bubbles: true }));
          });
        };
        await setField('Jig rows', rows);
        await setField('Jig columns', '10000');
        const create = [...host.querySelectorAll('button')].find((button) =>
          button.textContent?.startsWith('Create'),
        );
        expect(create?.disabled).toBe(true);
        expect(host.textContent).toContain(rows === '10000' ? 'at most 10000' : 'Rows must');
        const before = useStore.getState();
        await act(async () => create?.click());
        expect(useStore.getState()).toBe(before);
        expect(before.undoStack).toHaveLength(0);
      } finally {
        await act(async () => root.unmount());
        host.remove();
      }
    },
  );
});
