// Typed Move-to and saved head positions (LightBurn gap LBG-M02, ADR-493),
// driven through the rendered section: what the store's machine-position jog
// is asked for, and what the machine profile keeps.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { useJogControlPreferences } from './jog-control-preferences';
import { MoveToPositionSection } from './MoveToPositionSection';
import { savedPositionsAfterDelete, savedPositionsAfterSave } from './saved-head-positions';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const initialLaser = useLaserStore.getState();
let host: HTMLDivElement;
let root: Root | null = null;

function connect(): ReturnType<typeof vi.fn> {
  const jogToMachinePosition = vi.fn(async () => undefined);
  useLaserStore.setState({
    connection: { kind: 'connected' },
    streamer: null,
    motionOperation: null,
    statusReport: {
      state: 'Idle',
      subState: null,
      mPos: { x: 57.25, y: 33, z: 0 },
      wPos: null,
      feed: null,
      spindle: null,
      wco: null,
    },
    wcoCache: { x: 50, y: 30, z: 0 },
    jogToMachinePosition,
  });
  return jogToMachinePosition;
}

async function render(disabled = false): Promise<void> {
  await act(async () => {
    root = createRoot(host);
    root.render(<MoveToPositionSection disabled={disabled} />);
  });
}

function field(label: string): HTMLInputElement | HTMLSelectElement {
  const element = host.querySelector(`[aria-label="${label}"]`);
  if (element === null) throw new Error(`missing ${label}`);
  return element as HTMLInputElement | HTMLSelectElement;
}

async function type(label: string, value: string): Promise<void> {
  const input = field(label);
  const prototype =
    input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(
      new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }),
    );
  });
}

async function click(name: string): Promise<void> {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.getAttribute('aria-label') === name || candidate.textContent === name,
  );
  if (button === undefined) throw new Error(`missing button ${name}`);
  await act(async () => button.click());
}

beforeEach(() => {
  resetStore();
  useStore.setState({
    project: { ...createProject(), device: { ...DEFAULT_DEVICE_PROFILE, maxFeed: 6000 } },
    jobPlacement: { ...useStore.getState().jobPlacement, startFrom: 'user-origin' },
  });
  useToastStore.setState({ toasts: [] });
  useJogControlPreferences.setState({ requestedFeedMmPerMin: 3000 });
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host.remove();
  useLaserStore.setState(initialLaser, true);
});

describe('MoveToPositionSection', () => {
  it('moves to a typed position measured from the work origin', async () => {
    const jog = connect();
    await render();
    expect(field('Move-to coordinates').value).toBe('origin');

    await type('Move-to X', '12.5');
    await type('Move-to Y', '-4');
    await click('Go');

    expect(jog).toHaveBeenCalledWith(62.5, 26, 3000);
  });

  it('starts untouched fields on machine zero, which is the front corner on the canvas', async () => {
    connect();
    await render();
    expect([field('Move-to X').value, field('Move-to Y').value]).toEqual(['0', '0']);

    await type('Move-to coordinates', 'bed');

    // Default front-left 400 x 400 bed: machine X0 Y0 is canvas (0, 400).
    expect([field('Move-to X').value, field('Move-to Y').value]).toEqual(['0', '400']);
  });

  it('fills X and Y with the head position in the chosen frame', async () => {
    connect();
    await render();

    await click('Use current');

    expect(field('Move-to X').value).toBe('7.25');
    expect(field('Move-to Y').value).toBe('3');
  });

  it('saves, goes to and deletes a named position in the machine profile', async () => {
    const jog = connect();
    await render();
    await type('Move-to X', '100');
    await type('Move-to Y', '20');
    await type('Saved position name', 'Corner stop');
    await click('Save');

    expect(useStore.getState().project.device.savedPositions).toEqual([
      { name: 'Corner stop', frame: 'origin', xMm: 100, yMm: 20 },
    ]);
    expect(useStore.getState().dirty).toBe(true);

    await click('Go to Corner stop');
    expect(jog).toHaveBeenCalledWith(150, 50, 3000);

    await click('Delete Corner stop');
    expect(useStore.getState().project.device.savedPositions).toEqual([]);
  });

  it('sets the laser finish position from a canvas position only', async () => {
    connect();
    await render();
    const finish = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Finish jobs here',
    );
    expect(finish?.disabled).toBe(true);

    await type('Move-to coordinates', 'bed');
    await type('Move-to X', '380');
    await type('Move-to Y', '10');
    await click('Finish jobs here');

    expect(useStore.getState().project.device.laserFinishPosition).toEqual({
      kind: 'bed',
      xMm: 380,
      yMm: 10,
    });
  });

  it('keeps Go off while the jog pad is disabled', async () => {
    const jog = connect();
    await render(true);

    await click('Go');

    expect(jog).not.toHaveBeenCalled();
  });
});

describe('saved head position edits', () => {
  const draft = { frame: 'bed' as const, xMm: 1, yMm: 2 };

  it('names a blank save with the next free Position number', () => {
    const one = savedPositionsAfterSave([], '  ', draft);
    const two = savedPositionsAfterSave(
      savedPositionsAfterDelete([...one, { ...draft, name: 'Position 2' }], 'x'),
      '',
      draft,
    );
    expect(one.map((position) => position.name)).toEqual(['Position 1']);
    expect(two.map((position) => position.name)).toEqual([
      'Position 1',
      'Position 2',
      'Position 3',
    ]);
  });

  it('replaces a position saved under the same name in place', () => {
    const saved = [
      { name: 'A', frame: 'origin' as const, xMm: 0, yMm: 0 },
      { name: 'B', frame: 'origin' as const, xMm: 5, yMm: 5 },
    ];
    expect(savedPositionsAfterSave(saved, ' A ', draft)).toEqual([
      { name: 'A', ...draft },
      saved[1],
    ]);
  });
});
