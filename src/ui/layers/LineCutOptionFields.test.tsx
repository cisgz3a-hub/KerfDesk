import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { createLayer, type Layer } from '../../core/scene';
import { CutSettingsDialog } from './CutSettingsDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function renderDialog(patch: Partial<Layer>, selectionCount?: number) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const onApply = vi.fn();
  const layer = { ...createLayer({ id: 'cut', color: '#ff0000' }), ...patch };
  await act(async () =>
    root.render(
      <CutSettingsDialog
        layer={layer}
        onApply={onApply}
        onCancel={vi.fn()}
        {...(selectionCount === undefined ? {} : { selectionCount })}
      />,
    ),
  );
  const form = host.querySelector('form');
  if (!form) throw new Error('form missing');
  return {
    host,
    submit: async () => {
      await act(async () =>
        form.querySelector<HTMLButtonElement>('button[type="submit"]')?.click(),
      );
      return onApply.mock.calls[0]?.[0] as Partial<Layer>;
    },
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

function control(host: HTMLElement, label: string): HTMLInputElement | HTMLSelectElement | null {
  return host.querySelector<HTMLInputElement | HTMLSelectElement>(
    `[aria-label="Cut settings ${label}"]`,
  );
}

async function change(field: HTMLInputElement | HTMLSelectElement | null, value: string) {
  if (field === null) throw new Error('field missing');
  await act(async () => {
    field.value = value;
    Simulate.change(field);
  });
}

describe('Line Overcut and tab placement fields', () => {
  it('show spacing limits only for spacing placement and submit what changed', async () => {
    const view = await renderDialog({ tabsEnabled: true });
    try {
      expect(control(view.host, 'overcut')?.value).toBe('0');
      expect(control(view.host, 'tab spacing')).toBeNull();
      await change(control(view.host, 'tab placement'), 'spacing');
      expect(control(view.host, 'tab spacing')?.value).toBe('50');
      await change(control(view.host, 'tab spacing'), '25');
      await change(control(view.host, 'overcut'), '1.2');
      const patch = await view.submit();
      expect(patch).toMatchObject({ overcutMm: 1.2, tabPlacement: 'spacing', tabSpacingMm: 25 });
      expect(patch.tabMinPerShape).toBeUndefined();
      expect(patch.tabMaxPerShape).toBeUndefined();
    } finally {
      await view.close();
    }
  });

  it('are Line-only', async () => {
    const view = await renderDialog({ mode: 'fill' });
    try {
      expect(control(view.host, 'overcut')).toBeNull();
      expect(control(view.host, 'tab placement')).toBeNull();
    } finally {
      await view.close();
    }
  });

  it('send only the edited option for selected artwork', async () => {
    const view = await renderDialog({ overcutMm: 2 }, 3);
    try {
      await change(control(view.host, 'overcut'), '0');
      expect(await view.submit()).toEqual({ overcutMm: 0 });
    } finally {
      await view.close();
    }
  });
});
