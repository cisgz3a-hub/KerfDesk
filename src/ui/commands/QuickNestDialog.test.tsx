import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QuickNestDialog } from './QuickNestDialog';
import { layoutNest, type NestingInput } from '../../core/nesting/layout-nest';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('QuickNestDialog', () => {
  it('defaults to outline nesting and submits an explicit method choice', async () => {
    const onApply = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () =>
      root?.render(<QuickNestDialog boardAvailable onCancel={vi.fn()} onApply={onApply} />),
    );

    expect(button('Outline').getAttribute('aria-pressed')).toBe('true');
    await act(async () => Simulate.click(button('Fast')));
    expect(button('Fast').getAttribute('aria-pressed')).toBe('true');
    const form = host.querySelector('form');
    if (!(form instanceof HTMLFormElement)) throw new Error('Quick Nest form missing');
    await act(async () => Simulate.submit(form));

    expect(onApply).toHaveBeenCalledWith({
      bin: 'workspace',
      padding: 2,
      allowRotation: true,
      method: 'fast',
    });
  });

  it('submits the chosen grid goal and explicit grain restriction', async () => {
    const onApply = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () =>
      root?.render(<QuickNestDialog boardAvailable onCancel={vi.fn()} onApply={onApply} />),
    );
    const goal = Array.from(host.querySelectorAll('select')).find(
      (select) => select.value === 'compact',
    )!;
    await act(async () => {
      goal.value = 'grid';
      Simulate.change(goal);
    });
    const grain = Array.from(host.querySelectorAll('label'))
      .find((label) => label.textContent?.includes('grain axis'))!
      .querySelector('input')!;
    await act(async () => {
      grain.checked = true;
      Simulate.change(grain);
    });
    await act(async () => Simulate.submit(host!.querySelector('form')!));
    expect(onApply).toHaveBeenCalledWith({
      bin: 'workspace',
      padding: 2,
      allowRotation: true,
      method: 'outline',
      goal: 'grid',
      keepGrain: true,
    });
  });

  it('shows the best valid preview while searching and keeps accept inert after document drift', async () => {
    const onAcceptBest = vi.fn();
    const onStop = vi.fn();
    const input: NestingInput = {
      bin: { minX: 0, minY: 0, maxX: 50, maxY: 50 },
      items: [{ id: 'a', width: 10, height: 10, canRotate: false }],
      padding: 2,
      goal: 'compact',
      method: 'fast',
      optimise: true,
    };
    const props = {
      boardAvailable: true,
      onCancel: vi.fn(),
      onApply: vi.fn(),
      running: true,
      input,
      progress: { attempted: 1, total: 24, best: layoutNest(input)! },
      onAcceptBest,
      onStop,
    };
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(<QuickNestDialog {...props} />));
    expect(host.querySelector('svg')?.getAttribute('aria-label')).toContain('Nesting draft');
    await act(async () => Simulate.click(button('Stop search')));
    expect(onStop).toHaveBeenCalledOnce();
    await act(async () => Simulate.click(button('Accept best valid layout')));
    expect(onAcceptBest).toHaveBeenCalledOnce();
    await act(async () => root?.render(<QuickNestDialog {...props} stale />));
    expect(button('Accept best valid layout').disabled).toBe(true);
    expect(host.textContent).toContain('Artwork changed');
  });
});

function button(label: string): HTMLButtonElement {
  const candidate = Array.from(host?.querySelectorAll('button') ?? []).find(
    (element) => element.textContent === label,
  );
  if (!(candidate instanceof HTMLButtonElement)) throw new Error(`${label} button missing`);
  return candidate;
}
