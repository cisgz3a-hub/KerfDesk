import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { grblDriver } from '../../core/controllers';
import type { JogParams } from '../../core/controllers/grbl';
import type { RotarySetup } from '../../core/devices';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { resetStore } from '../state/test-helpers';
import { ROTARY_TEST_PAUSE_MS } from './rotary-test-rotation';
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
    expect(status()).toContain(
      'Turning one revolution on Y: 40 machine mm at 240 mm/min, about 10 s.',
    );
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

// Audit controller-v3 D3-P2-1, ADR-373 Amendment 1: after a turn the note
// names the value that turn can correct, never the object diameter of a
// roller, whose Y scale does not read it.
describe('Rotary Setup Test rotation miss advice', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Out, the pause, back: each turn ends when the jog double releases motion.
  async function completeTest(label: string): Promise<void> {
    act(() => button(label).click());
    await settle();
    act(() => useLaserStore.setState({ motionOperation: null }));
    await settle();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ROTARY_TEST_PAUSE_MS);
    });
    await settle();
    act(() => useLaserStore.setState({ motionOperation: null }));
    await settle();
  }

  it('sends an unscaled roller whose diameter was tuned to land to roller scaling', async () => {
    // A stock roller (40 machine mm per turn of a Ø25 roller) under an 80 mm
    // tumbler: tuning Ø to 128/π makes the object turn travel 128 mm, exactly
    // one tumbler turn, while every job still burns at scale 1 (×1.96 tall).
    renderDialog({
      enabled: true,
      type: 'roller',
      mmPerRotation: 40,
      objectDiameterMm: 128 / Math.PI,
    });
    await completeTest('Turn object once');
    expect(jogCalls).toHaveLength(2);
    expect(jogCalls[0]?.dy).toBeCloseTo(128, 9);
    expect(jogCalls[1]?.dy).toBeCloseTo(-128, 9);
    const note = status();
    expect(note).toContain("the controller is not moving the part's surface in millimetres");
    expect(note).toContain(
      'Turn on Scale Y from the roller diameter and enter the roller diameter and Motion per turn',
    );
    expect(note).toContain("or set the controller's Y steps/mm to the part's surface");
    expect(note).toContain('Changing the object diameter can make the mark land, but it does not');
    expect(note).not.toContain('adjust the measurements');

    // Once roller scaling is on, the note names the next check: the roller turn.
    const scale = [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
      (node) => node.title === 'Scale Y from the roller diameter',
    );
    act(() => scale?.click());
    expect(buttonTexts()).toContain('Turn roller once');
    expect(status()).toContain('check Motion per turn with Turn roller once first');
    expect(status()).toContain('The roller diameter sets the burn size');
  });

  it('corrects Motion per turn after a roller or chuck turn', async () => {
    renderDialog(MEASURED_ROLLER);
    await completeTest('Turn roller once');
    expect(jogCalls).toEqual([
      { dy: 40, feed: 240 },
      { dy: -40, feed: 240 },
    ]);
    expect(status()).toBe(
      'Done. If the roller did not turn exactly once, change Motion per turn: lower it if the ' +
        'roller turned too far, raise it if it stopped short.',
    );

    act(() => button('Chuck').click());
    await completeTest('Turn chuck once');
    expect(status()).toContain('If the chuck did not turn exactly once, change Motion per turn');
  });
});
