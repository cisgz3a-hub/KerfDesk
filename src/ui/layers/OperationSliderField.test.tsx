import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { OperationSliderField } from './OperationSliderField';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const commit = vi.fn();
let host: HTMLDivElement;
let root: Root;

async function renderField({
  value = 30,
  mixed = false,
  reconcileKey = 'initial',
}: { value?: number; mixed?: boolean; reconcileKey?: string } = {}): Promise<void> {
  await act(async () =>
    root.render(
      <OperationSliderField
        label="Power"
        unit="%"
        ariaContext="selected objects"
        title="Laser power percentage"
        value={value}
        min={0}
        max={100}
        mixed={mixed}
        reconcileKey={reconcileKey}
        parse={(text) => Math.max(0, Math.min(100, Number(text)))}
        commit={commit}
      />,
    ),
  );
}

function input(type: 'number' | 'range'): HTMLInputElement {
  const element = host.querySelector(`input[type="${type}"]`);
  if (!(element instanceof HTMLInputElement)) throw new Error(`Missing ${type} input`);
  return element;
}

async function change(type: 'number' | 'range', value: string): Promise<void> {
  await act(async () => {
    const element = input(type);
    element.value = value;
    Simulate.change(element);
  });
}

async function startDrag(focusFirst = true): Promise<void> {
  const range = input('range');
  range.setPointerCapture = vi.fn();
  if (focusFirst) await act(async () => range.focus());
  await act(async () => Simulate.pointerDown(range));
}

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
  commit.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  resetStore();
});

describe('OperationSliderField', () => {
  it('keeps exact entry and the range in sync while batching keyboard edits', async () => {
    await renderField();
    expect(input('number').value).toBe('30');
    expect(input('range').value).toBe('30');

    await change('number', '46');
    expect(input('range').value).toBe('46');
    expect(commit).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(300));
    expect(commit).toHaveBeenCalledExactlyOnceWith(46);

    await change('range', '52');
    expect(input('number').value).toBe('52');
    await act(async () => Simulate.blur(input('range')));
    expect(commit).toHaveBeenNthCalledWith(2, 52);
    await act(async () => vi.advanceTimersByTime(500));
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it('keeps a long pointer drag local and commits its final value only once on release', async () => {
    await renderField();
    await startDrag();
    await change('range', '45');
    await act(async () => vi.advanceTimersByTime(700));
    expect(input('number').value).toBe('45');
    expect(commit).not.toHaveBeenCalled();

    await change('range', '70');
    await act(async () => vi.advanceTimersByTime(700));
    expect(commit).not.toHaveBeenCalled();
    await act(async () => Simulate.pointerUp(input('range')));
    expect(commit).toHaveBeenCalledExactlyOnceWith(70);
    await act(async () => {
      Simulate.lostPointerCapture(input('range'));
      Simulate.blur(input('range'));
      vi.advanceTimersByTime(500);
    });
    expect(commit).toHaveBeenCalledExactlyOnceWith(70);
  });

  it('accepts a drag that starts while the number input still has a pending edit', async () => {
    await renderField();
    await change('number', '45');
    // Native pointerdown precedes the focus transfer and the number's blur.
    await startDrag(false);
    await act(async () => Simulate.blur(input('number')));
    expect(commit).toHaveBeenCalledExactlyOnceWith(45);
    // The inspector includes the just-committed value in its reconcile key.
    await renderField({ value: 45, reconcileKey: 'own-number-commit' });
    await act(async () => Simulate.focus(input('range')));
    await change('range', '70');
    await act(async () => Simulate.pointerUp(input('range')));
    expect(commit).toHaveBeenNthCalledWith(2, 70);
  });

  it('applies an explicit mixed value even when it equals the first artwork value', async () => {
    await renderField({ mixed: true });
    expect(input('number').value).toBe('');
    expect(input('number').placeholder).toBe('Mixed');
    expect(input('range').disabled).toBe(true);

    await change('number', '30');
    await act(async () => Simulate.blur(input('number')));
    expect(commit).toHaveBeenCalledExactlyOnceWith(30);
    expect(input('number').value).toBe('30');
    expect(input('range').disabled).toBe(false);
    expect(input('range').value).toBe('30');
  });

  it('cancels a queued keyboard draft when an external undo restores the canonical value', async () => {
    await renderField();
    await change('number', '75');
    await renderField({ value: 20, reconcileKey: 'undo' });
    expect(input('number').value).toBe('20');
    expect(input('range').value).toBe('20');
    await act(async () => {
      vi.advanceTimersByTime(500);
      Simulate.blur(input('number'));
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it('retires a drag when the selection reconciles even if its baseline number is unchanged', async () => {
    await renderField();
    await startDrag();
    await change('range', '70');
    await renderField({ reconcileKey: 'selection-changed' });
    expect(input('number').value).toBe('30');
    await act(async () => {
      Simulate.pointerUp(input('range'));
      vi.advanceTimersByTime(500);
    });
    expect(commit).not.toHaveBeenCalled();
  });

  it.each(['document', 'selection'] as const)(
    'ignores continued pointer movement after the %s changes during a gesture',
    async (replacement) => {
      await renderField();
      await startDrag();
      await change('range', '70');
      if (replacement === 'document') {
        await act(async () => useStore.getState().newProject());
      } else {
        await renderField({ reconcileKey: 'replacement-selection' });
      }
      expect(input('number').value).toBe('30');

      // The old pointer can keep moving after React renders the replacement.
      await change('range', '85');
      expect(input('number').value).toBe('30');
      await act(async () => {
        Simulate.pointerUp(input('range'));
        Simulate.lostPointerCapture(input('range'));
        vi.advanceTimersByTime(500);
      });
      expect(commit).not.toHaveBeenCalled();

      await startDrag();
      await change('range', '45');
      await act(async () => Simulate.pointerUp(input('range')));
      expect(commit).toHaveBeenCalledExactlyOnceWith(45);
    },
  );

  it.each(['new', 'open'] as const)(
    '%s prevents a stale release from committing into a replacement document',
    async (replacement) => {
      await renderField();
      await startDrag();
      await change('range', '80');
      const range = input('range');
      await act(async () => {
        if (replacement === 'new') useStore.getState().newProject();
        else useStore.getState().setProject(createProject());
        // A release may arrive before React renders the new document epoch.
        Simulate.pointerUp(range);
        vi.advanceTimersByTime(500);
      });
      expect(commit).not.toHaveBeenCalled();
      expect(input('number').value).toBe('30');
      expect(input('range').value).toBe('30');

      await change('number', '40');
      await act(async () => vi.advanceTimersByTime(300));
      expect(commit).toHaveBeenCalledExactlyOnceWith(40);
    },
  );
});
