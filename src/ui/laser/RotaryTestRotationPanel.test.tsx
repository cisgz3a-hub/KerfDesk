import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { grblDriver } from '../../core/controllers';
import type { JogParams } from '../../core/controllers/grbl';
import type { RotarySetup } from '../../core/devices';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { resetStore } from '../state/test-helpers';
import { RotarySetupDialog } from './RotarySetupDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const MEASURED_ROLLER: RotarySetup = {
  enabled: true,
  type: 'roller',
  mmPerRotation: 40,
  objectDiameterMm: 60,
  rollerDiameterMm: 25,
};

let host: HTMLDivElement;
let root: Root;
let jogCalls: JogParams[];
let cancelJog: Mock<() => Promise<void>>;

beforeEach(() => {
  resetStore();
  jogCalls = [];
  cancelJog = vi.fn<() => Promise<void>>(async () => undefined);
  useLaserStore.setState({
    ...initialLaserState(),
    connection: { kind: 'connected' },
    capabilities: grblDriver.capabilities,
    statusReport: {
      state: 'Idle',
      subState: null,
      mPos: { x: 0, y: 0, z: 0 },
      wPos: null,
      wco: null,
      feed: 0,
      spindle: 0,
    },
    // A jog double that owns motion until the test releases it.
    jog: vi.fn(async (params: JogParams) => {
      jogCalls.push(params);
      useLaserStore.setState({
        motionOperation: {
          kind: 'jog',
          operationId: Symbol('jog'),
          sawControllerBusy: false,
          idleStatusReports: 0,
          dispatchComplete: true,
          pendingLines: [],
        },
      });
    }),
    cancelJog,
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useLaserStore.setState(initialLaserState());
});

function renderDialog(setup: RotarySetup): void {
  act(() =>
    root.render(
      <RotarySetupDialog
        setup={setup}
        onCancel={vi.fn()}
        onApply={vi.fn()}
        onGenerateCalibration={vi.fn()}
      />,
    ),
  );
}

function buttonTexts(): string[] {
  return [...host.querySelectorAll('button')].map((node) => node.textContent?.trim() ?? '');
}

function button(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(
    (node) => node.textContent?.trim() === text,
  );
  if (found === undefined) throw new Error(`Missing button: ${text}`);
  return found;
}

function status(): string {
  return host.querySelector('[aria-label="Test rotation"] [role="status"]')?.textContent ?? '';
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
  });
}

describe('Rotary Setup Test rotation', () => {
  it('offers the revolutions each rotary type can be tested by', () => {
    renderDialog(MEASURED_ROLLER);
    expect(buttonTexts()).toEqual(expect.arrayContaining(['Turn roller once', 'Turn object once']));
    act(() => button('Chuck').click());
    expect(buttonTexts()).toContain('Turn chuck once');
    expect(buttonTexts()).not.toContain('Turn object once');
  });

  it('turns the draft roller once with the laser-off jog and can be stopped', async () => {
    renderDialog(MEASURED_ROLLER);
    act(() => button('Turn roller once').click());
    await settle();
    expect(jogCalls).toEqual([{ dy: 40, feed: 240 }]);
    expect(status()).toContain('Turning one revolution: 40 machine mm at 240 mm/min, about 10 s.');
    expect(button('Apply').disabled).toBe(true);
    expect(button('Generate test pattern').disabled).toBe(true);

    act(() => button('Stop rotation').click());
    await settle();
    expect(cancelJog).toHaveBeenCalledTimes(1);
    expect(status()).toBe('Stopped. Nothing more is sent.');
    expect(button('Apply').disabled).toBe(false);
    act(() => useLaserStore.setState({ motionOperation: null }));
    await settle();
    expect(jogCalls).toHaveLength(1);
  });

  it('stops the rotation when the dialog closes mid-turn', async () => {
    renderDialog(MEASURED_ROLLER);
    act(() => button('Turn object once').click());
    await settle();
    expect(jogCalls).toHaveLength(1);
    expect(jogCalls[0]?.dy).toBeCloseTo(96, 9);
    act(() => root.render(<></>));
    await settle();
    expect(cancelJog).toHaveBeenCalledTimes(1);
  });

  it('explains why the test cannot run on a disconnected controller', () => {
    useLaserStore.setState({ connection: { kind: 'disconnected' } });
    renderDialog(MEASURED_ROLLER);
    expect(button('Turn roller once').disabled).toBe(true);
    expect(host.textContent).toContain('Connect the controller to test the rotation.');
  });
});
