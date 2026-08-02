import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutofocusEditor } from './AutofocusEditor';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('AutofocusEditor', () => {
  it('offers only presets that the single-line autofocus runner can execute', async () => {
    const onChange = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => root.render(<AutofocusEditor value="" onChange={onChange} />));

    const presetLabels = [...host.querySelectorAll('button')].map((button) => button.textContent);
    expect(presetLabels).not.toContain('Use GRBL probe (Z-axis machines)');
    expect(host.textContent).toContain('Only one controller line is supported');

    const falconPreset = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Use Creality Falcon A1 Pro',
    );
    expect(falconPreset).toBeDefined();
    await act(async () => falconPreset?.click());
    expect(onChange).toHaveBeenCalledWith('$HZ1');
  });
});
