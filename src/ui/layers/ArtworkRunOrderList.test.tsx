import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { ArtworkRunOrderList } from './ArtworkRunOrderList';
import { ArtworkRunOrderRow } from './ArtworkRunOrderRow';
import type { ArtworkRunOrderRowModel } from './artwork-run-order-view-model';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe('ArtworkRunOrderList', () => {
  it('renders a bounded window for a 1000-job project', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () =>
      root.render(
        <ArtworkRunOrderList
          rows={Array.from({ length: 1000 }, (_unused, index) => row(index + 1))}
          activeKey={null}
          machineKind="laser"
          reveal={null}
          onFocus={() => undefined}
          onMove={() => undefined}
          onEditSettings={() => undefined}
        />,
      ),
    );

    expect(host.querySelectorAll('article[aria-label^="Run "]').length).toBeLessThan(30);
    await act(async () => root.unmount());
    host.remove();
  });
});

describe('ArtworkRunOrderRow position box', () => {
  // The box is uncontrolled and re-seeds from its key. A move the store refuses
  // (blank, 0, or a number that clamps to the order it already has) leaves the
  // position identical, so the typed text used to stand over a row that never
  // moved.
  it('snaps back to the real run position when the move is refused', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    try {
      // A store that refuses the move: the row keeps position 3.
      await act(async () =>
        root.render(
          <ArtworkRunOrderRow
            row={row(3)}
            active={false}
            machineKind="laser"
            onFocus={() => undefined}
            onMove={() => undefined}
            onEditSettings={() => undefined}
          />,
        ),
      );
      const position = (): HTMLInputElement => {
        const found = host.querySelector('input[aria-label="Run position for Job 3"]');
        if (!(found instanceof HTMLInputElement)) throw new Error('position input missing');
        return found;
      };
      expect(position().value).toBe('3');

      const input = position();
      await act(async () => {
        input.value = '99';
        Simulate.change(input);
      });
      await act(async () => Simulate.blur(input));

      expect(position().value).toBe('3');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});

it('offers a focusable run selection action without invoking settings or double-selecting', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const select = vi.fn();
  const edit = vi.fn();
  try {
    await act(async () =>
      root.render(
        <ArtworkRunOrderRow
          row={row(3)}
          active={false}
          machineKind="laser"
          onFocus={select}
          onMove={() => undefined}
          onEditSettings={edit}
        />,
      ),
    );
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="Select Job 3"]');
    if (button === null) throw new Error('Keyboard run selection control missing');
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-pressed')).toBe('false');
    await act(async () => button.click());
    expect(select).toHaveBeenCalledOnce();
    expect(edit).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

function row(position: number): ArtworkRunOrderRowModel {
  return {
    key: `job-${position}`,
    objectIds: [`job-${position}`],
    position,
    name: `Job ${position}`,
    kindLabel: 'Vector artwork',
    colors: ['#2563eb'],
    dimensions: '10 × 10 mm',
    operationSummary: `Job ${position}`,
    settingsSummary: 'Line · 30% · 1000 mm/min · 1×',
    effectiveSteps: [position],
    output: true,
    shared: false,
  };
}
