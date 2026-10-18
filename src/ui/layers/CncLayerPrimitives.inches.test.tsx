import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayer } from '../../core/scene';
import { useDisplayUnitsStore } from '../state/display-units';
import { NumberField } from './CncLayerPrimitives';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;
const layer = createLayer({ id: 'layer-1', name: 'Cut', color: '#ff0000' });

beforeEach(() => useDisplayUnitsStore.setState({ lengthUnit: 'in' }));

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
  useDisplayUnitsStore.setState({ lengthUnit: 'mm' });
});

async function render(node: JSX.Element): Promise<HTMLInputElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root?.render(node));
  const input = host.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error('input missing');
  return input;
}

async function typeAndBlur(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}

describe('CNC depth and feed fields in inches (ADR-629)', () => {
  it('shows a depth in inches and commits a typed inch depth in millimetres', async () => {
    const onCommit = vi.fn();
    const input = await render(
      <NumberField
        layer={layer}
        label="Cut depth"
        unit="mm"
        dimension="length"
        value={6.35}
        min={0.05}
        max={200}
        step={0.5}
        title="depth"
        onCommit={onCommit}
      />,
    );
    expect(input.value).toBe('0.25');
    expect(host?.textContent).toContain('in');
    await typeAndBlur(input, '0.5');
    expect(onCommit).toHaveBeenLastCalledWith(12.7);
  });

  it('shows a feed in in/min and commits nothing when left unedited', async () => {
    const onCommit = vi.fn();
    const input = await render(
      <NumberField
        layer={layer}
        label="Feed"
        unit="mm/min"
        dimension="feed"
        value={1000}
        min={1}
        max={20000}
        step={50}
        title="feed"
        onCommit={onCommit}
      />,
    );
    expect(input.value).toBe('39.4');
    expect(host?.textContent).toContain('in/min');
    await act(async () => input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('keeps fields without a dimension, such as RPM, unchanged', async () => {
    const input = await render(
      <NumberField
        layer={layer}
        label="Spindle"
        unit="RPM"
        value={18000}
        min={0}
        max={30000}
        step={500}
        title="rpm"
        onCommit={vi.fn()}
      />,
    );
    expect(input.value).toBe('18000');
    expect(host?.textContent).toContain('RPM');
  });
});
