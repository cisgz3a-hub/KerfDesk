import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jogAxisSignsForOrigin } from '../../core/devices/jog-direction';
import { useLaserStore } from '../state/laser-store';
import { useUiStore } from '../state/ui-store';
import { useStore } from '../state';
import { CompactConnectionControls } from './CompactConnectionControls';
import { runStartJobFlow } from './start-job-flow';
import { installJobShortcuts } from './use-job-shortcuts';
import { installJogShortcuts } from './use-jog-shortcuts';

vi.mock('./start-job-flow', () => ({ runStartJobFlow: vi.fn(async () => undefined) }));

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let uninstall: (() => void)[];
const initialLaser = useLaserStore.getState();
const initialUi = useUiStore.getState();
const initialApp = useStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useUiStore.setState({ modalDepth: 0, textDialog: null, imageDialog: null });
  useLaserStore.setState({
    connection: { kind: 'connected' },
    streamer: null,
    statusReport: null,
    motionOperation: null,
    controllerOperation: null,
    fireActive: false,
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  uninstall = [];
});

afterEach(async () => {
  uninstall.forEach((remove) => remove());
  await act(async () => root.unmount());
  host.remove();
  useLaserStore.setState(initialLaser, true);
  useUiStore.setState(initialUi, true);
  useStore.setState(initialApp, true);
});

describe('machine details owns its keyboard', () => {
  it.each<KeyboardEventInit>([
    { key: 'PageUp' },
    { key: 'PageDown' },
    { key: '8', code: 'Numpad8' },
    { key: '[', code: 'BracketLeft', ctrlKey: true, altKey: true },
  ])('keeps $key from requesting jog while the details close button is focused', async (init) => {
    const onFocusJog = vi.fn();
    const onXyJog = vi.fn();
    uninstall.push(
      installJogShortcuts(window, {
        focusDisabled: () => false,
        onFocusJog,
        xyDisabled: () => false,
        xyStep: () => ({ stepMm: 1, feed: 3000, signs: jogAxisSignsForOrigin('front-left') }),
        onXyJog,
      }),
    );
    await openDetails();
    const event = press(document.activeElement, init);
    expect(onFocusJog).not.toHaveBeenCalled();
    expect(onXyJog).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('does not start a job from Ctrl+Enter while the details dialog is focused', async () => {
    uninstall.push(installJobShortcuts(window));
    await openDetails();
    press(document.activeElement, { key: 'Enter', ctrlKey: true });
    expect(runStartJobFlow).not.toHaveBeenCalled();
  });

  it.each(['ctrlKey', 'metaKey'] as const)(
    'preserves %s+. Abort inside the details dialog',
    async (modifier) => {
      const setFireActive = vi.fn(async () => undefined);
      useLaserStore.setState({ fireActive: true, setFireActive });
      uninstall.push(installJobShortcuts(window));
      await openDetails();
      press(document.activeElement, { key: '.', [modifier]: true });
      expect(setFireActive).toHaveBeenCalledExactlyOnceWith(false);
    },
  );

  it('leaves native module select key defaults and changes intact', async () => {
    const onModuleChange = vi.fn();
    await openDetails({
      details: (
        <select aria-label="Laser module" defaultValue="20" onChange={onModuleChange}>
          <option value="20">20 W blue</option>
          <option value="2">2 W infrared</option>
        </select>
      ),
    });
    const module = document.querySelector<HTMLSelectElement>('[aria-label="Laser module"]');
    expect(document.activeElement).toBe(module);
    expect(press(module, { key: 'ArrowDown' }).defaultPrevented).toBe(false);
    expect(press(module, { key: 'PageDown' }).defaultPrevented).toBe(false);
    await act(async () => {
      if (module !== null) module.value = '2';
      module?.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onModuleChange).toHaveBeenCalledOnce();
  });

  it('keeps focus inside open details when a profile change removes the focused module', async () => {
    await openDetails({
      details: (
        <select aria-label="Laser module">
          <option>20 W blue</option>
        </select>
      ),
    });
    const module = document.querySelector('[aria-label="Laser module"]');
    expect(document.activeElement).toBe(module);
    await renderDetails({ machineName: 'Router', machine: <strong>Router profile</strong> });
    const dialog = document.querySelector('[aria-label="Machine details"]');
    expect(dialog?.textContent).toContain('Router profile');
    expect(document.querySelector('[aria-label="Laser module"]')).toBeNull();
    expect(dialog?.contains(document.activeElement)).toBe(true);
  });

  it('retains focus when a same-name machine mode change removes the module in its own subscriber', async () => {
    useStore.getState().setMachineKind('laser');
    await openDetails({ machineName: 'Hybrid machine', details: <ModeDependentModule /> });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Laser module');
    await act(async () => {
      useStore.getState().setMachineKind('cnc');
    });
    expect(document.querySelector('[aria-label="Laser module"]')).toBeNull();
    expect(
      document.querySelector('[aria-label="Machine details"]')?.contains(document.activeElement),
    ).toBe(true);
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Close machine details');
  });

  it('dismisses when focus leaves without taking focus from an outside control', async () => {
    await openDetails({
      details: (
        <select aria-label="Laser module">
          <option>20 W blue</option>
        </select>
      ),
    });
    const outside = document.createElement('button');
    outside.textContent = 'Outside';
    host.appendChild(outside);
    await act(async () => outside.focus());
    await renderDetails({ machineName: 'Router' });
    expect(document.activeElement).toBe(outside);
    expect(document.querySelector('[aria-label="Machine details"]')).toBeNull();
    outside.remove();
  });

  it('keeps native Tab navigation between form controls inside the details dialog', async () => {
    await openDetails({
      details: (
        <>
          <input aria-label="Machine address" />
          <input aria-label="Machine port" />
        </>
      ),
    });
    const address = document.querySelector<HTMLInputElement>('[aria-label="Machine address"]');
    const port = document.querySelector<HTMLInputElement>('[aria-label="Machine port"]');
    await act(async () => {
      address?.focus();
      const event = press(address, { key: 'Tab' });
      expect(event.defaultPrevented).toBe(false);
      port?.focus();
    });
    expect(document.querySelector('[aria-label="Machine details"]')).not.toBeNull();
    expect(document.activeElement).toBe(port);
  });
});

function ModeDependentModule(): JSX.Element | null {
  const kind = useStore((state) => state.project.machine?.kind ?? 'laser');
  return kind === 'laser' ? (
    <select aria-label="Laser module">
      <option>20 W blue</option>
    </select>
  ) : null;
}

async function renderDetails(
  overrides: Partial<ComponentProps<typeof CompactConnectionControls>> = {},
): Promise<void> {
  await act(async () => {
    root.render(
      <CompactConnectionControls
        machineName="Laser"
        status="Connected"
        statusDot={<span />}
        {...overrides}
      >
        <button type="button">Disconnect</button>
      </CompactConnectionControls>,
    );
  });
}

async function openDetails(
  overrides: Partial<ComponentProps<typeof CompactConnectionControls>> = {},
): Promise<void> {
  await renderDetails(overrides);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')?.click());
}

function press(target: Element | null, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target?.dispatchEvent(event);
  return event;
}
