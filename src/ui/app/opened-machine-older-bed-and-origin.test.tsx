// Rolling audit v5 J5-P2-2 (P1, ADR-440 Amendment 8): a file saved before an
// origin and bed correction of the same machine opened behind the bed-size-only
// notice. That notice named the bed, while the file's origin and no-go zones
// moved the burn and dropped the clamp guard. Real store, real persistence
// hook and banner, the file round-tripped through Save and Open, output from
// emitGcode.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { emitGcode } from '../../io/gcode';
import { deserializeProject, serializeProject } from '../../io/project';
import { useStore } from '../state';
import { loadLastMachine } from '../state/last-machine-persistence';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { ProjectBedReconciliationBanner } from './ProjectBedReconciliationBanner';
import { useMachineProfilePersistence } from './use-machine-profile-persistence';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const CLAMP = { id: 'clamp', name: 'Clamp', enabled: true, x: 0, y: 0, width: 60, height: 60 };

let host: HTMLDivElement;
let root: Root;
function Probe(): JSX.Element {
  useMachineProfilePersistence();
  return <ProjectBedReconciliationBanner />;
}

beforeEach(async () => {
  localStorage.clear();
  resetStore();
  useToastStore.setState({ toasts: [] });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Probe />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  resetStore();
  useToastStore.setState({ toasts: [] });
});

// A 1 mm line ending at canvas (20, 20), inside the clamp.
function withLine(project: Project): Project {
  const color = '#ff0000';
  return {
    ...project,
    scene: {
      layers: [{ ...createLayer({ id: 'line', color }), power: 50 }],
      objects: [
        {
          kind: 'imported-svg',
          id: 'line-object',
          source: 'line.svg',
          transform: IDENTITY_TRANSFORM,
          bounds: { minX: 19, minY: 20, maxX: 20, maxY: 20 },
          paths: [
            {
              color,
              polylines: [
                {
                  points: [
                    { x: 19, y: 20 },
                    { x: 20, y: 20 },
                  ],
                  closed: false,
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

function burn(project: Project): { readonly line: string | undefined; readonly noGo: number } {
  const out = emitGcode(project);
  return {
    line: out.gcode.split('\n').find((line) => /^G1 X/.test(line)),
    noGo: out.preflight.issues.filter((issue) => issue.code === 'no-go-zone-collision').length,
  };
}

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((item) => item.textContent === label);
  if (found === undefined) throw new Error(`Missing ${label}`);
  return found;
}

// The file is saved front-left at 400 × 400 with no zones; the operator then
// corrects the same machine to rear-right, 400 × 410, with a clamp zone.
async function openFileSavedBeforeCorrections(): Promise<ReturnType<typeof burn>> {
  useStore.getState().updateDeviceProfile({ origin: 'front-left', noGoZones: [] });
  const saved = serializeProject(withLine(createProject(useStore.getState().project.device)));
  useStore
    .getState()
    .updateDeviceProfile({ origin: 'rear-right', bedHeight: 410, noGoZones: [CLAMP] });
  const corrected = burn(withLine(useStore.getState().project));
  expect(corrected.noGo).toBeGreaterThan(0);
  const parsed = deserializeProject(saved);
  if (parsed.kind !== 'ok') throw new Error(`parse ${parsed.kind}`);
  await act(async () => {
    expect(useStore.getState().setProject(parsed.project).kind).toBe('loaded');
  });
  return corrected;
}

describe('opening a same-machine file saved before an origin and bed correction (J5-P2-2)', () => {
  it('names the origin and no-go zones the file brings, not only the bed', async () => {
    const corrected = await openFileSavedBeforeCorrections();
    const state = useStore.getState();
    expect(state.projectBedReconciliation).toMatchObject({
      sameProfile: true,
      bedSizeOnly: false,
      differingSettings: ['origin', 'no-go zones'],
    });
    // What the notice must account for: the file's origin and zones are in use.
    expect(state.project.device.origin).toBe('front-left');
    expect(burn(state.project)).not.toEqual(corrected);
    expect(burn(state.project).noGo).toBe(0);

    const text = host.textContent ?? '';
    expect(text).toContain('with a 400 × 400 mm bed');
    expect(text).toContain('is set up with a 400 × 410 mm bed');
    expect(text).toContain("The file's copy also differs in origin and no-go zones.");
    expect(text).toContain('Its bed, origin and no-go zones are in use for now, not yours.');
    expect(text).toContain(
      'Keep current machine keeps your 400 × 410 mm bed, origin and no-go zones.',
    );
    expect(text).not.toContain("The project's 400 × 400 mm bed is in use for now.");
    const buttons = [...host.querySelectorAll('button')];
    expect(buttons.map((item) => item.textContent)).toEqual([
      'Keep current machine',
      'Use project machine',
    ]);
    expect(buttons[0]?.className).toContain('lf-btn--primary');
  });

  it('Keep current machine restores the corrected burn and its clamp guard', async () => {
    const corrected = await openFileSavedBeforeCorrections();
    await act(async () => button('Keep current machine').click());
    const { project } = useStore.getState();
    expect(project.device).toMatchObject({
      origin: 'rear-right',
      bedHeight: 410,
      noGoZones: [CLAMP],
    });
    expect(burn(project)).toEqual(corrected);
    expect(host.textContent).toBe('');
  });

  it('remembers nothing until the operator chooses, then the named choice', async () => {
    await openFileSavedBeforeCorrections();
    useStore.getState().updateDeviceProfile({ framingFeedMmPerMin: 2222 });
    expect(loadLastMachine(localStorage)).toMatchObject({
      origin: 'rear-right',
      bedHeight: 410,
      noGoZones: [CLAMP],
    });
    await act(async () => button('Use project machine').click());
    useStore.getState().updateDeviceProfile({ framingFeedMmPerMin: 3333 });
    expect(loadLastMachine(localStorage)).toMatchObject({
      origin: 'front-left',
      bedHeight: 400,
      noGoZones: [],
    });
  });

  it('keeps the bed-only words when only the bed differs', async () => {
    useStore.getState().updateDeviceProfile({ origin: 'rear-right', noGoZones: [CLAMP] });
    const saved = serializeProject(withLine(createProject(useStore.getState().project.device)));
    useStore.getState().updateDeviceProfile({ bedHeight: 410 });
    const parsed = deserializeProject(saved);
    if (parsed.kind !== 'ok') throw new Error(`parse ${parsed.kind}`);
    await act(async () => {
      useStore.getState().setProject(parsed.project);
    });
    expect(useStore.getState().projectBedReconciliation).toMatchObject({
      bedSizeOnly: true,
      differingSettings: [],
    });
    const text = host.textContent ?? '';
    expect(text).toContain("The project's 400 × 400 mm bed is in use for now.");
    expect(text).toContain('Keep current machine keeps your 400 × 410 mm bed.');
    expect(text).not.toContain('differs in');
  });
});

describe('opening a file for another machine (J5-P2-2)', () => {
  it('names the bed and origin that machine brings', async () => {
    useStore.getState().updateDeviceProfile({ origin: 'rear-right' });
    const file = createProject({
      ...useStore.getState().project.device,
      profileId: 'other-machine',
      name: 'Shop laser',
      bedWidth: 300,
      bedHeight: 300,
      origin: 'front-left',
    });
    await act(async () => {
      useStore.getState().setProject(file);
    });
    const text = host.textContent ?? '';
    expect(text).toContain('Opening it selected “Shop laser”');
    expect(text).toContain(
      "That machine's bed (300 × 300 mm) and origin are in use for now, not yours.",
    );
    expect(button('Use project machine').className).toContain('lf-btn--primary');
  });
});
