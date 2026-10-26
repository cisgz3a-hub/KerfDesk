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

    await act(async () =>
      root.render(
        <AutofocusEditor
          value=""
          onChange={onChange}
          controllerCommandSet="creality-falcon-a1-pro"
        />,
      ),
    );

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

  // Controller audit 2026-09-25 CG-9: `$HZ1` is a Falcon vendor macro;
  // Smoothieware runs it as a full `$H` homing cycle.
  it('offers the Falcon macro only for the Falcon command set', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => root.render(<AutofocusEditor value="" onChange={vi.fn()} />));

    const labels = [...host.querySelectorAll('button')].map((button) => button.textContent);
    expect(labels).not.toContain('Use Creality Falcon A1 Pro');
    expect(host.textContent).not.toContain('Known machine presets');
  });

  // Controller audit v3 D2-P3-1 and D2-P3-3.
  it('names what error:9 means and refuses a probe with no feed of its own', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () =>
      root.render(
        <AutofocusEditor value="G38.2 Z-10" onChange={vi.fn()} controllerKind="grblhal" />,
      ),
    );

    expect(host.textContent).toContain('error:9 (the controller was in Alarm or Jog)');
    expect(host.textContent).not.toContain('no probe pin');
    expect(host.textContent).toContain('at most 150 mm/min');
    expect(host.querySelector('[role="alert"]')?.textContent).toMatch(/needs its own feed/);
  });
});
