import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDENTITY_TRANSFORM } from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { resetStore } from '../state/test-helpers';
import { focusDesignHierarchy, useDesignHierarchyStore } from '../state/design-hierarchy-store';
import { createFramedRunPermit, type FramedRunCandidate } from '../state/framed-run';
import { JogPad } from './JogPad';
import { useJogControlPreferences } from './jog-control-preferences';
import { useMachineSetupDialogStore } from './device-setup/machine-setup-dialog-store';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalLaser = useLaserStore.getState();
const originalPreferences = useJogControlPreferences.getState();
const originalHierarchy = useDesignHierarchyStore.getState();
let host: HTMLDivElement;
let root: Root;
const jog = vi.fn(async (..._args: unknown[]) =>
  useLaserStore.setState({ positioningLightEnabled: true }),
);
const off = vi.fn(async (enabled: boolean) =>
  useLaserStore.setState({ positioningLightEnabled: enabled }),
);

beforeEach(() => {
  resetStore();
  focusDesignHierarchy(null, useStore.getState().projectDocumentEpoch);
  jog.mockClear();
  off.mockClear();
  const shape = createRectangle({
    id: 'shape',
    color: '#000000',
    spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
  });
  useStore.setState((state) => ({
    project: {
      ...state.project,
      device: {
        ...state.project.device,
        origin: 'rear-left',
        positioningLight: {
          onCommand: 'M64 P0',
          offCommand: 'M65 P0',
          offsetXmm: 0,
          offsetYmm: 0,
        },
      },
      scene: {
        ...state.project.scene,
        objects: [{ ...shape, transform: { ...IDENTITY_TRANSFORM, x: 30, y: 40 } }],
      },
    },
    selectedObjectId: 'shape',
    jobPlacement: { ...state.jobPlacement, startFrom: 'absolute' },
  }));
  useLaserStore.setState({
    connection: { kind: 'connected' },
    statusReport: {
      state: 'Idle',
      subState: null,
      mPos: { x: 0, y: 0, z: 0 },
      wPos: null,
      wco: null,
      feed: 0,
      spindle: 0,
    },
    streamer: null,
    motionOperation: null,
    controllerOperation: null,
    centrePositioningLight: jog,
    switchPositioningLightOn: () => off(true),
    switchPositioningLightOff: () => off(false),
    positioningLightEnabled: false,
    framedRun: null,
    completedFrame: null,
  });
  useJogControlPreferences.setState({ requestedFeedMmPerMin: 1200 });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useLaserStore.setState(originalLaser, true);
  useJogControlPreferences.setState(originalPreferences, true);
  useDesignHierarchyStore.setState(originalHierarchy, true);
  useMachineSetupDialogStore.getState().close();
});

function centreButton(): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>('button[aria-label="Artwork centre & LED"]');
  if (button === null) throw new Error('Centre selection button missing');
  return button;
}

describe('Centre selection in the jog pad', () => {
  it('dispatches the transformed centre through the separate-light action and hides in CNC', async () => {
    await act(async () => root.render(<JogPad disabled={false} />));
    expect(centreButton().title).toContain('beam off');
    await act(async () => centreButton().click());
    expect(jog).toHaveBeenCalledExactlyOnceWith(40, 45, 1200, expect.any(Function));
    await act(async () => useStore.getState().setMachineKind('cnc'));
    expect(host.querySelector('button[aria-label="Artwork centre & LED"]')).toBeNull();
  });

  it('explains unavailable selection, placement and machine states without sending movement', async () => {
    await act(async () => root.render(<JogPad disabled={false} />));
    await act(async () => useStore.getState().selectObject(null));
    expect(centreButton().disabled).toBe(true);
    expect(centreButton().title).toContain('Select artwork');
    await act(async () => centreButton().click());

    await act(async () => {
      useStore.getState().selectObject('shape');
      useStore.setState((state) => ({
        jobPlacement: { ...state.jobPlacement, startFrom: 'user-origin' },
      }));
    });
    expect(centreButton().disabled).toBe(true);
    expect(centreButton().title).toContain('Frame the job once');
    await act(async () => centreButton().click());

    await act(async () => {
      useStore.setState((state) => ({
        jobPlacement: { ...state.jobPlacement, startFrom: 'absolute' },
      }));
      useLaserStore.setState({ connection: { kind: 'disconnected' } });
    });
    expect(centreButton().disabled).toBe(true);
    expect(centreButton().title).toContain('Connect');
    await act(async () => centreButton().click());

    await act(async () => {
      useLaserStore.setState((state) => ({
        connection: { kind: 'connected' },
        statusReport: { ...state.statusReport!, state: 'Run' },
      }));
    });
    expect(centreButton().disabled).toBe(true);
    expect(centreButton().title).toContain('Idle');
    await act(async () => centreButton().click());
    expect(jog).not.toHaveBeenCalled();
  });

  it.each(['absolute', 'user-origin', 'verified-origin', 'current-position'] as const)(
    'requires an ordinary Frame instead of transient evidence in %s',
    async (startFrom) => {
      useStore.setState({ jobPlacement: { startFrom, anchor: 'front-left' } });
      await act(async () => root.render(<JogPad disabled={false} />));
      for (const authorizationContext of ['transient-camera', 'laser-second-pass'] as const) {
        const candidate = { authorizationContext } as FramedRunCandidate;
        const frame = createFramedRunPermit(candidate, useLaserStore.getState());
        for (const evidence of [
          { framedRun: frame, completedFrame: null },
          { framedRun: null, completedFrame: frame },
        ]) {
          await act(async () => useLaserStore.setState(evidence));
          expect(centreButton().disabled).toBe(true);
          expect(centreButton().title).toContain('ordinary artwork job');
          await act(async () => centreButton().click());
        }
      }
      const frame = createFramedRunPermit({} as FramedRunCandidate, useLaserStore.getState());
      await act(async () => useLaserStore.setState({ framedRun: null, completedFrame: frame }));
      expect(centreButton().disabled).toBe(false);
      expect(jog).not.toHaveBeenCalled();
    },
  );

  it('subtracts the pointer offset before converting bed axes to native coordinates', async () => {
    useStore.setState((state) => ({
      project: {
        ...state.project,
        device: {
          ...state.project.device,
          origin: 'front-left',
          bedHeight: 300,
          positioningLight: {
            onCommand: 'M64 P0',
            offCommand: 'M65 P0',
            offsetXmm: 10,
            offsetYmm: -5,
          },
        },
      },
    }));
    await act(async () => root.render(<JogPad disabled={false} />));
    await act(async () => centreButton().click());
    // Centre (40,45), head (30,50) in canvas bed axes, native Y=300-50.
    expect(jog).toHaveBeenCalledExactlyOnceWith(30, 250, 1200, expect.any(Function));
  });

  it('keeps light off available after deselection and switching to CNC', async () => {
    useLaserStore.setState({ positioningLightEnabled: true });
    useStore.getState().selectObject(null);
    useStore.getState().setMachineKind('cnc');
    await act(async () => root.render(<JogPad disabled={false} />));
    const button = host.querySelector<HTMLButtonElement>('button[aria-label="LED off"]');
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(false);
    await act(async () => button?.click());
    expect(off).toHaveBeenCalledExactlyOnceWith(false);
    expect(jog).not.toHaveBeenCalled();
  });

  it('opens light setup when unconfigured and explains Ruida file-only support', async () => {
    useStore.setState((state) => ({
      project: {
        ...state.project,
        device: {
          ...state.project.device,
          positioningLight: undefined,
        },
      },
    }));
    await act(async () => root.render(<JogPad disabled={false} />));
    expect(centreButton().disabled).toBe(true);
    const setup = Array.from(host.querySelectorAll('button')).find(
      (button) => button.textContent === 'Set up LED',
    );
    await act(async () => setup?.click());
    expect(useMachineSetupDialogStore.getState().state).toMatchObject({
      kind: 'open',
      target: { step: 'options', highlight: 'positioning-light' },
    });
    await act(async () =>
      useStore.setState((state) => ({
        project: {
          ...state.project,
          device: {
            ...state.project.device,
            controllerKind: 'ruida',
          },
        },
      })),
    );
    expect(centreButton().title).toContain('runs from files or its own USB link');
    expect(host.textContent).not.toContain('Set up LED');
    expect(jog).not.toHaveBeenCalled();
  });

  it('requires choosing one of several selected artworks and keeps the canvas selection', async () => {
    addSecondArtwork();
    await act(async () => root.render(<JogPad disabled={false} />));
    expect(centreButton().disabled).toBe(true);
    expect(centreButton().title).toContain('Choose which');
    const chooser = host.querySelector<HTMLSelectElement>(
      'select[aria-label="Artwork to centre"]',
    )!;
    expect(chooser.options).toHaveLength(3);
    expect(chooser.options[2]?.textContent).toContain('Second artwork');
    await act(async () => {
      chooser.value = chooser.options[2]!.value;
      chooser.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(jog).not.toHaveBeenCalled();
    expect(centreButton().disabled).toBe(false);
    await act(async () => centreButton().click());
    expect(jog).toHaveBeenCalledExactlyOnceWith(110, 85, 1200, expect.any(Function));
    expect(useStore.getState().selectedObjectId).toBe('shape');
    expect([...useStore.getState().additionalSelectedIds]).toEqual(['second']);
    const on = host.querySelector<HTMLButtonElement>('button[aria-label="LED on"]')!;
    expect(on.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps intact groups combined after deleting the focused group', async () => {
    addSecondArtwork();
    useStore.setState((state) => ({
      project: {
        ...state.project,
        scene: {
          ...state.project.scene,
          groups: [
            { id: 'logo', name: 'Complete logo', objectIds: ['shape', 'second'] },
            { id: 'deleted-group', name: 'Previous focus', objectIds: [] },
          ],
        },
      },
    }));
    await act(async () => root.render(<JogPad disabled={false} />));
    expect(host.querySelector('select[aria-label="Artwork to centre"]')).toBeNull();
    await act(async () => focusDesignHierarchy('logo', useStore.getState().projectDocumentEpoch));
    expect(centreButton().disabled).toBe(true);
    expect(host.querySelector('select[aria-label="Artwork to centre"]')).not.toBeNull();
    await act(async () =>
      focusDesignHierarchy('deleted-group', useStore.getState().projectDocumentEpoch),
    );
    await act(async () =>
      useStore.setState((state) => ({
        project: {
          ...state.project,
          scene: {
            ...state.project.scene,
            groups: (state.project.scene.groups ?? []).filter(
              (group) => group.id !== 'deleted-group',
            ),
          },
        },
      })),
    );
    expect(host.querySelector('select[aria-label="Artwork to centre"]')).toBeNull();
    expect(centreButton().disabled).toBe(false);
    await act(async () => centreButton().click());
    expect(jog).toHaveBeenCalledExactlyOnceWith(75, 65, 1200, expect.any(Function));
  });

  it('clears a multiple-artwork choice when the canvas selection changes', async () => {
    addSecondArtwork();
    await act(async () => root.render(<JogPad disabled={false} />));
    const chooser = host.querySelector<HTMLSelectElement>(
      'select[aria-label="Artwork to centre"]',
    )!;
    await act(async () => {
      chooser.value = chooser.options[2]!.value;
      chooser.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => useStore.getState().selectObject(null));
    await act(async () =>
      useStore.setState({
        selectedObjectId: 'shape',
        additionalSelectedIds: new Set(['second']),
      }),
    );
    expect(centreButton().disabled).toBe(true);
    expect(
      host.querySelector<HTMLSelectElement>('select[aria-label="Artwork to centre"]')?.value,
    ).toBe('');
    expect(jog).not.toHaveBeenCalled();
  });

  it('switches the LED on and off without a selection or a centre move', async () => {
    useStore.getState().selectObject(null);
    await act(async () => root.render(<JogPad disabled={false} />));
    const on = host.querySelector<HTMLButtonElement>('button[aria-label="LED on"]')!;
    const turnOff = host.querySelector<HTMLButtonElement>('button[aria-label="LED off"]')!;
    expect(on.disabled).toBe(false);
    await act(async () => on.click());
    expect(off).toHaveBeenLastCalledWith(true);
    expect(on.getAttribute('aria-pressed')).toBe('true');
    await act(async () => turnOff.click());
    expect(off).toHaveBeenLastCalledWith(false);
    expect(on.getAttribute('aria-pressed')).toBe('false');
    expect(jog).not.toHaveBeenCalled();
    expect(centreButton().disabled).toBe(true);
    // Off remains callable even when reset/no feedback makes the tracked state false.
    expect(turnOff.disabled).toBe(false);
  });
  it('shows no LED controls at all on a Marlin fan-mosfet laser, even while lit', async () => {
    useLaserStore.setState({ positioningLightEnabled: true });
    useStore.setState((state) => ({
      project: {
        ...state.project,
        device: {
          ...state.project.device,
          controllerKind: 'marlin',
          gcodeDialect: { dialectId: 'marlin-fan' },
        },
      },
    }));
    await act(async () => root.render(<JogPad disabled={false} />));
    expect(host.querySelector('button[aria-label="Artwork centre & LED"]')).toBeNull();
    expect(host.querySelector('button[aria-label="LED off"]')).toBeNull();
    expect(host.querySelector('button[aria-label="LED on"]')).toBeNull();
    expect(host.textContent).not.toContain('Set up LED');
    await act(async () =>
      useStore.setState((state) => ({
        project: {
          ...state.project,
          device: { ...state.project.device, gcodeDialect: { dialectId: 'marlin-inline' } },
        },
      })),
    );
    expect(host.querySelector('button[aria-label="Artwork centre & LED"]')).not.toBeNull();
    expect(jog).not.toHaveBeenCalled();
    expect(off).not.toHaveBeenCalled();
  });
});

function addSecondArtwork(): void {
  const second = createRectangle({
    id: 'second',
    color: '#000000',
    spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
  });
  useStore.setState((state) => ({
    project: {
      ...state.project,
      scene: {
        ...state.project.scene,
        objects: [
          ...state.project.scene.objects,
          {
            ...second,
            name: 'Second artwork',
            transform: { ...IDENTITY_TRANSFORM, x: 100, y: 80 },
          },
        ],
      },
    },
    additionalSelectedIds: new Set(['second']),
  }));
}
