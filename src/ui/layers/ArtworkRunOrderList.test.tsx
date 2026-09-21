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

  it('shows matching rows when a scrolled list becomes shorter', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const renderRows = (rows: ReadonlyArray<ArtworkRunOrderRowModel>) => (
      <ArtworkRunOrderList
        rows={rows}
        total={1000}
        activeKey={null}
        machineKind="laser"
        reveal={null}
        onFocus={() => undefined}
        onMove={() => undefined}
        onEditSettings={() => undefined}
      />
    );
    try {
      await act(async () =>
        root.render(renderRows(Array.from({ length: 1000 }, (_, i) => row(i + 1)))),
      );
      const list = host.querySelector<HTMLDivElement>('[aria-label="Artwork run order list"]');
      if (list === null) throw new Error('Run order list missing');
      await act(async () => {
        list.scrollTop = 150000;
        Simulate.scroll(list);
      });
      await act(async () => root.render(renderRows([row(900)])));
      expect(host.querySelector('article[aria-label="Run 900: Job 900"]')).not.toBeNull();
      expect(host.querySelectorAll('article')).toHaveLength(1);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
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

  it('keeps actual CNC steps visible and distinguishes unavailable steps from output off', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const renderRow = (model: ArtworkRunOrderRowModel) => (
      <ArtworkRunOrderRow
        row={model}
        active={false}
        machineKind="cnc"
        onFocus={() => undefined}
        onMove={() => undefined}
        onEditSettings={() => undefined}
      />
    );
    try {
      await act(async () =>
        root.render(renderRow({ ...row(1), effectiveSteps: [2, 3, 4, 7, 9, 10] })),
      );
      expect(host.textContent).toContain('Actual CNC steps: 2–4, 7, 9–10');
      await act(async () => root.render(renderRow({ ...row(1), effectiveSteps: [] })));
      expect(host.textContent).toContain('Output on · Output steps are unavailable');
      await act(async () => root.render(renderRow({ ...row(1), output: false })));
      expect(host.textContent).toContain('Output off · This artwork will not run');
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('focuses artwork through its button without moving its run position', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    const onFocus = vi.fn();
    const onMove = vi.fn();
    try {
      await act(async () =>
        root.render(
          <ArtworkRunOrderRow
            row={row(3)}
            active={false}
            machineKind="laser"
            onFocus={onFocus}
            onMove={onMove}
            onEditSettings={() => undefined}
          />,
        ),
      );
      const show = host.querySelector<HTMLButtonElement>(
        'button[aria-label="Show Job 3 on canvas"]',
      );
      if (show === null) throw new Error('Show artwork button missing');
      await act(async () => show.click());
      expect(onFocus).toHaveBeenCalledTimes(1);
      expect(onMove).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
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
