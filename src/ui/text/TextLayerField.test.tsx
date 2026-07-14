import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../state';
import { resetStore, svgObj } from '../state/test-helpers';
import { TextLayerField } from './TextLayerField';
import { textLayerOptions } from './text-layer-options';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  resetStore();
  useStore.getState().importSvgObject(svgObj('O1', ['#ff0000']));
});

afterEach(() => resetStore());

describe('TextLayerField', () => {
  it('keeps the selector compact and moves the long operation summary below it', async () => {
    const { host, root } = await renderField();
    try {
      const select = requireSelect(host, 'Text output layer');
      expect(select.style.minWidth).toBe('0');
      expect(select.style.maxWidth).toBe('100%');
      expect(select.selectedOptions[0]?.textContent).toBe('Layer 1 (#ff0000)');
      expect(host.textContent).toContain('Line');
      expect(host.textContent).toContain('30% power');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('edits the canonical layer color and operation used by the main panel', async () => {
    const { host, root } = await renderField();
    try {
      await act(async () => requireButton(host, 'Edit').click());
      await act(async () => {
        const color = requireInput(host, 'Layer color');
        color.value = '#00ff00';
        Simulate.change(color);
      });
      await act(async () => {
        const mode = requireSelect(host, 'Mode for #00ff00');
        mode.value = 'fill';
        Simulate.change(mode);
      });
      expect(requireSelect(host, 'Mode for #00ff00').value).toBe('fill');
      expect(useStore.getState().project.scene.layers[0]).toMatchObject({
        color: '#ff0000',
        mode: 'line',
      });
      await act(async () => requireButton(host, 'Save').click());

      const state = useStore.getState();
      expect(state.project.scene.layers[0]).toMatchObject({ color: '#00ff00', mode: 'fill' });
      const object = state.project.scene.objects[0];
      expect(object?.kind).toBe('imported-svg');
      if (object?.kind !== 'imported-svg') throw new Error('expected imported svg');
      expect(object.paths[0]?.color).toBe('#00ff00');
      expect(requireSelect(host, 'Text output layer').value).toBe('#00ff00');
      expect(host.textContent).not.toContain('Layer settings');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('exposes the shared CNC cut type, including V-carve', async () => {
    useStore.getState().setMachineKind('cnc');
    const { host, root } = await renderField();
    try {
      await act(async () => requireButton(host, 'Edit').click());
      await act(async () => {
        const cutType = requireSelect(host, 'Cut type for #ff0000');
        cutType.value = 'v-carve';
        Simulate.change(cutType);
      });
      await act(async () => requireButton(host, 'Save').click());

      expect(useStore.getState().project.scene.layers[0]?.cnc?.cutType).toBe('v-carve');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('saves a new output layer before any text is added to the canvas', async () => {
    const { host, root } = await renderField('#000000');
    try {
      const edit = requireButton(host, 'Edit');
      expect(edit.disabled).toBe(false);
      await act(async () => edit.click());
      expect(host.textContent).toContain('New layer settings');
      expect(useStore.getState().project.scene.layers).toHaveLength(1);

      await act(async () => {
        const mode = requireSelect(host, 'Mode for #000000');
        mode.value = 'fill';
        Simulate.change(mode);
      });
      const power = requireInput(host, 'Power for #000000');
      await act(async () => {
        power.value = '55';
        Simulate.change(power);
      });
      await act(async () => {
        Simulate.blur(power);
      });
      await act(async () => requireButton(host, 'Save').click());

      const saved = useStore
        .getState()
        .project.scene.layers.find((layer) => layer.color === '#000000');
      expect(saved).toMatchObject({ mode: 'fill', power: 55 });
      expect(useStore.getState().project.scene.objects).toHaveLength(1);
      expect(requireSelect(host, 'Text output layer').value).toBe('#000000');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('discards a new output draft when Cancel is pressed', async () => {
    const { host, root } = await renderField('#000000');
    try {
      await act(async () => requireButton(host, 'Edit').click());
      await act(async () => {
        const mode = requireSelect(host, 'Mode for #000000');
        mode.value = 'fill';
        Simulate.change(mode);
      });
      await act(async () => requireButton(host, 'Cancel').click());

      expect(useStore.getState().project.scene.layers).toHaveLength(1);
      expect(useStore.getState().project.scene.layers[0]?.color).toBe('#ff0000');
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});

function Harness(props: { readonly initialColor: string }): JSX.Element {
  const project = useStore((s) => s.project);
  const [color, setColor] = useState(props.initialColor);
  return (
    <TextLayerField
      value={color}
      options={textLayerOptions(project, 'roboto-regular', color)}
      onChange={setColor}
    />
  );
}

async function renderField(initialColor = '#ff0000') {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<Harness initialColor={initialColor} />));
  return { host, root };
}

function requireSelect(host: HTMLElement, ariaLabel: string): HTMLSelectElement {
  const select = host.querySelector(`select[aria-label="${ariaLabel}"]`);
  if (!(select instanceof HTMLSelectElement)) throw new Error(`${ariaLabel} select missing`);
  return select;
}

function requireInput(host: HTMLElement, ariaLabel: string): HTMLInputElement {
  const input = host.querySelector(`input[aria-label="${ariaLabel}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`${ariaLabel} input missing`);
  return input;
}

function requireButton(host: HTMLElement, label: string): HTMLButtonElement {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${label} button missing`);
  return button;
}
