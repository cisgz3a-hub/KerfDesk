import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CNC_CONTEXT_TOOL } from '../../__fixtures__/cnc-cutting-preset';
import { DEFAULT_CNC_MACHINE_CONFIG, type CncTool } from '../../core/scene';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { DeviceSetupCncBitLibrary } from '../laser/device-setup/DeviceSetupCncBitLibrary';
import { CncToolAssemblyEditor } from './CncToolAssemblyEditor';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => resetStore());
async function view(
  element: JSX.Element,
): Promise<{ readonly host: HTMLDivElement; readonly root: Root }> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  return { host, root };
}
async function dispose(rendered: {
  readonly host: HTMLElement;
  readonly root: Root;
}): Promise<void> {
  await act(async () => rendered.root.unmount());
  rendered.host.remove();
}
function setInput(host: HTMLElement, label: string, value: string): void {
  const input = host.querySelector(`input[aria-label="${label}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`Missing ${label}`);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
function button(host: HTMLElement, text: string): HTMLButtonElement {
  const element = [...host.querySelectorAll('button')].find((b) => b.textContent === text);
  if (element === undefined) throw new Error(`Missing ${text}`);
  return element;
}

describe('advisory tool assemblies in canonical Machine Setup', () => {
  it('keeps unknown legacy dimensions optional and displays distinct envelope components', async () => {
    const tool: CncTool = { id: 'old', name: 'Legacy', kind: 'end-mill', diameterMm: 3 };
    const change = vi.fn();
    const rendered = await view(<CncToolAssemblyEditor tool={tool} onChange={change} />);
    try {
      expect(rendered.host.textContent).toContain('Flutes: unknown');
      expect(rendered.host.textContent).toContain('Shank: unknown');
      expect(rendered.host.textContent).toContain('Holder: unknown');
      expect(rendered.host.textContent).toContain('Cutter, shank and holder use separate colours');
      await act(async () => button(rendered.host, 'Save assembly geometry').click());
      expect(change).toHaveBeenCalledWith('old', {});
    } finally {
      await dispose(rendered);
    }
  });
  it('requires complete finite holder data before saving any assembly edit', async () => {
    const change = vi.fn();
    const rendered = await view(
      <CncToolAssemblyEditor tool={CNC_CONTEXT_TOOL} onChange={change} />,
    );
    try {
      await act(async () => setInput(rendered.host, 'Holder 1 Diameter (mm)', ''));
      await act(async () => button(rendered.host, 'Save assembly geometry').click());
      expect(rendered.host.querySelector('[role="alert"]')?.textContent).toContain(
        'Each holder needs',
      );
      expect(change).not.toHaveBeenCalled();
      await act(async () => setInput(rendered.host, 'Holder 1 Diameter (mm)', '14'));
      await act(async () => button(rendered.host, 'Save assembly geometry').click());
      expect(change).toHaveBeenCalledWith(
        CNC_CONTEXT_TOOL.id,
        expect.objectContaining({
          holderSegments: [{ name: 'Collet', startMm: 10, lengthMm: 12, diameterMm: 14 }],
        }),
      );
    } finally {
      await dispose(rendered);
    }
  });
  it('stages assembly changes in the machine and custom-tool drafts without mutating the committed project', async () => {
    resetStore();
    const before = useStore.getState().project;
    const changeMachine = vi.fn();
    const changeTools = vi.fn();
    const rendered = await view(
      <DeviceSetupCncBitLibrary
        machine={{
          ...DEFAULT_CNC_MACHINE_CONFIG,
          tools: [CNC_CONTEXT_TOOL],
          toolId: CNC_CONTEXT_TOOL.id,
        }}
        customTools={[CNC_CONTEXT_TOOL]}
        onChange={changeMachine}
        onChangeCustomTools={changeTools}
        onRemoveTool={vi.fn()}
      />,
    );
    try {
      await act(async () => setInput(rendered.host, 'Flute length (mm)', '6.25'));
      await act(async () => button(rendered.host, 'Save assembly geometry').click());
      expect(changeMachine.mock.calls[0]?.[0]?.tools[0]?.fluteLengthMm).toBe(6.25);
      expect(changeTools.mock.calls[0]?.[0]?.[0]?.fluteLengthMm).toBe(6.25);
      expect(useStore.getState().project).toBe(before);
      expect(CNC_CONTEXT_TOOL.fluteLengthMm).toBe(5);
    } finally {
      await dispose(rendered);
    }
  });
  it('allows withdrawing unknown dimensions while keeping cutter identity and other metadata', async () => {
    const changeMachine = vi.fn();
    const rendered = await view(
      <DeviceSetupCncBitLibrary
        machine={{
          ...DEFAULT_CNC_MACHINE_CONFIG,
          tools: [CNC_CONTEXT_TOOL],
          toolId: CNC_CONTEXT_TOOL.id,
        }}
        customTools={[CNC_CONTEXT_TOOL]}
        onChange={changeMachine}
        onChangeCustomTools={vi.fn()}
        onRemoveTool={vi.fn()}
      />,
    );
    try {
      await act(async () => setInput(rendered.host, 'Stickout (mm)', ''));
      await act(async () => button(rendered.host, 'Save assembly geometry').click());
      const changed = changeMachine.mock.calls[0]?.[0]?.tools[0];
      expect(changed).not.toHaveProperty('stickoutMm');
      expect(changed?.diameterMm).toBe(3);
      expect(changed?.fluteCount).toBe(2);
      expect(changed?.holderSegments).toEqual(CNC_CONTEXT_TOOL.holderSegments);
    } finally {
      await dispose(rendered);
    }
  });
});
