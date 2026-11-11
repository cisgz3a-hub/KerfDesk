// User annoyance audit A1, A3-P2-1 (ADR-367 Amendment 3). While KerfDesk
// withholds the head position after an Unlock or Release motors, Move to
// position said "Wait for a status report", the origin row read "not reported
// yet" and Fire was disabled with its ordinary tooltip. No report ends that
// wait, so each now names what does: Home (only on a machine that homes), or
// moving the head to the start and Set origin here. Which controls are
// disabled is unchanged.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver } from '../../core/controllers';
import type { StatusReport } from '../../core/controllers/grbl';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { positionWithheldMessage, positionWithheldOriginLabel } from './frame-position-withheld';
import { HEAD_MOVE_NEEDS_WORK_OFFSET } from './head-move-dispatch';
import { MomentaryFireControl } from './MomentaryFireControl';
import { MoveToPositionSection } from './MoveToPositionSection';
import { StatusDisplay } from './StatusDisplay';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const WITH_HOMING =
  'Position is unknown after Unlock or Release motors. Home the machine, or move the head to where the job should start and use Set origin here.';
const WITHOUT_HOMING =
  'Position is unknown after Unlock or Release motors. Move the head to where the job should start and use Set origin here.';
const CASES = [
  ['with homing', true, WITH_HOMING],
  ['without homing', false, WITHOUT_HOMING],
] as const;

// What the status pipeline leaves while the position is withheld: an Idle
// report with its position blanked and no cached work offset.
const WITHHELD_REPORT: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: null,
  wPos: null,
  wco: null,
  feed: 0,
  spindle: 0,
};
const REPORTED: StatusReport = { ...WITHHELD_REPORT, mPos: { x: 57.25, y: 33, z: 0 } };

let host: HTMLDivElement;
let root: Root;
const makeJog = () => vi.fn(async () => undefined);
let jog = makeJog();

function setProject(homingEnabled: boolean): void {
  const project = createProject();
  useStore.setState({
    project: {
      ...project,
      machine: { kind: 'laser' },
      device: {
        ...DEFAULT_DEVICE_PROFILE,
        homing: { ...DEFAULT_DEVICE_PROFILE.homing, enabled: homingEnabled },
        capabilities: [...(DEFAULT_DEVICE_PROFILE.capabilities ?? []), 'low-power-fire'],
        fireControl: { enabled: true, maxPowerPercent: 1 },
      },
    },
    jobPlacement: { ...useStore.getState().jobPlacement, startFrom: 'user-origin' },
  });
}

function connect(withheld: boolean): void {
  jog = makeJog();
  useLaserStore.setState({
    ...initialLaserState(),
    capabilities: grblDriver.capabilities,
    connection: { kind: 'connected' },
    statusReport: withheld ? WITHHELD_REPORT : REPORTED,
    wcoCache: withheld ? null : { x: 50, y: 30, z: 0 },
    positionEvidenceSuppressed: withheld,
    jogToMachinePosition: jog,
  });
}

async function render(element: JSX.Element): Promise<void> {
  await act(async () => root.render(element));
}

async function click(name: string): Promise<void> {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent === name,
  );
  if (button === undefined) throw new Error(`missing button ${name}`);
  await act(async () => button.click());
}

async function choose(label: string, value: string): Promise<void> {
  const select = host.querySelector(`[aria-label="${label}"]`) as HTMLSelectElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function toasts(): ReadonlyArray<string> {
  return useToastStore.getState().toasts.map((toast) => toast.message);
}

beforeEach(() => {
  resetStore();
  useToastStore.setState({ toasts: [] });
  useExperimentalLaserFeatures.getState().resetFeatures();
  useExperimentalLaserFeatures.getState().setFeature('lowPowerFire', true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useExperimentalLaserFeatures.getState().resetFeatures();
  useLaserStore.setState(initialLaserState());
  resetStore();
});

describe('the remedy sentence', () => {
  it.each(CASES)('%s', (_name, homingEnabled, sentence) => {
    expect(positionWithheldMessage({ positionEvidenceSuppressed: true }, homingEnabled)).toBe(
      sentence,
    );
  });

  it('is not said while the position is reported', () => {
    expect(positionWithheldMessage({ positionEvidenceSuppressed: false }, true)).toBeNull();
  });

  // A `$$` read, not Home, brings that position back.
  it('is not said while report units are unconfirmed', () => {
    expect(
      positionWithheldMessage(
        { positionEvidenceSuppressed: true, reportUnitsUnconfirmed: true },
        true,
      ),
    ).toBeNull();
  });
});

describe('Move to position while the position is withheld', () => {
  it.each(CASES)('Go from the work origin names the way out, %s', async (_name, homing, text) => {
    setProject(homing);
    connect(true);
    await render(<MoveToPositionSection disabled={false} />);

    await click('Go');

    expect(toasts()).toEqual([text]);
    expect(toasts().join(' ')).not.toMatch(/wait for/i);
    expect(jog).not.toHaveBeenCalled();
  });

  // A canvas target needs no work offset; the store refused it with "Wait for
  // an Idle status report".
  it.each(CASES)('Go to a canvas position names it too, %s', async (_name, homing, text) => {
    setProject(homing);
    connect(true);
    await render(<MoveToPositionSection disabled={false} />);
    await choose('Move-to coordinates', 'bed');

    await click('Go');

    expect(toasts()).toEqual([text]);
    expect(jog).not.toHaveBeenCalled();
  });

  it.each(CASES)('Use current names the way out, %s', async (_name, homing, text) => {
    setProject(homing);
    connect(true);
    await render(<MoveToPositionSection disabled={false} />);

    await click('Use current');

    expect(toasts()).toEqual([text]);
  });

  it('leaves Go enabled, as before', async () => {
    setProject(false);
    connect(true);
    await render(<MoveToPositionSection disabled={false} />);
    const go = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Go');
    expect(go?.disabled).toBe(false);
  });

  it('still moves, and still asks to wait for a first offset, when nothing is withheld', async () => {
    setProject(false);
    connect(false);
    await render(<MoveToPositionSection disabled={false} />);
    await click('Go');
    expect(jog).toHaveBeenCalledWith(50, 30, expect.any(Number));

    // Connected moments ago: the first work offset really is on its way.
    useLaserStore.setState({ wcoCache: null });
    await click('Go');
    expect(toasts()).toEqual([HEAD_MOVE_NEEDS_WORK_OFFSET]);
  });
});

describe('the origin row while the position is withheld', () => {
  function originRow(): HTMLDivElement | undefined {
    return [...host.querySelectorAll('div')].find(
      (div) => div.textContent?.startsWith('Origin:') === true,
    );
  }

  it.each(CASES)('names the way out, %s', async (_name, homingEnabled, sentence) => {
    setProject(homingEnabled);
    connect(true);
    await render(<StatusDisplay />);

    expect(originRow()?.textContent).toBe(`Origin: ${positionWithheldOriginLabel(homingEnabled)}`);
    expect(originRow()?.textContent).toContain('Set origin here');
    expect(originRow()?.textContent?.includes('Home')).toBe(homingEnabled);
    expect(originRow()?.title).toBe(sentence);
  });

  it('still reads "not reported yet" before a first offset when nothing is withheld', async () => {
    setProject(true);
    connect(false);
    useLaserStore.setState({ wcoCache: null });
    await render(<StatusDisplay />);

    expect(originRow()?.textContent).toBe('Origin: not reported yet');
  });
});

describe('Fire while the position is withheld', () => {
  const ORDINARY = /^Hold to turn on the positioning beam/;

  it.each(CASES)('says why it is off, %s', async (_name, homingEnabled, sentence) => {
    setProject(homingEnabled);
    connect(true);
    await render(<MomentaryFireControl />);
    const button = host.querySelector('button');

    expect(button?.disabled).toBe(true);
    expect(button?.title).toBe(`Fire is off while the head position is unknown. ${sentence}`);
  });

  it('keeps its ordinary tooltip, and stays enabled, when the position is reported', async () => {
    setProject(true);
    connect(false);
    await render(<MomentaryFireControl />);
    const button = host.querySelector('button');

    expect(button?.disabled).toBe(false);
    expect(button?.title).toMatch(ORDINARY);
  });

  it('keeps its ordinary tooltip when it is off for another reason', async () => {
    setProject(true);
    connect(false);
    useLaserStore.setState({ alarmCode: 3 });
    await render(<MomentaryFireControl />);
    const button = host.querySelector('button');

    expect(button?.disabled).toBe(true);
    expect(button?.title).toMatch(ORDINARY);
  });
});
