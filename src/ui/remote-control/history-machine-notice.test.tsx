// Rolling audit v5 J7-P2-1 (ADR-584 Amendment 1): a phone or MCP Undo runs
// the PC's own step, so it can undo Keep current machine. The file's machine
// and the PC's notice come back, as a desktop Undo brings them (ADR-440
// Amendment 6), and the remote receipt now says so in `notices`. Real store,
// persistence hook and banner, the file round-tripped through Save and Open,
// the remote write through the real adapter, output from emitGcode.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLayer, createProject, IDENTITY_TRANSFORM, type Project } from '../../core/scene';
import { emitGcode } from '../../io/gcode';
import { deserializeProject, serializeProject } from '../../io/project';
import { openedMachineNoticeWords } from '../app/opened-machine-notice-words';
import { ProjectBedReconciliationBanner } from '../app/ProjectBedReconciliationBanner';
import { useMachineProfilePersistence } from '../app/use-machine-profile-persistence';
import { useStore } from '../state';
import { sameMachineSetup } from '../state/job-machine-lock';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import { createRemoteControlAdapter } from './adapter';
import type { RemoteCommandResult, RemoteControlAdapter } from './types';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const CLAMP = { id: 'clamp', name: 'Clamp', enabled: true, x: 0, y: 0, width: 60, height: 60 };

let host: HTMLDivElement;
let root: Root;
let adapter: RemoteControlAdapter;
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
  adapter = createRemoteControlAdapter({
    getAppStatus: () => ({
      app: { name: 'KerfDesk', version: '1.0.3', platform: 'desktop' },
      edition: { mode: 'free' },
      updates: { available: false },
    }),
    canWrite: () => true,
  });
});
afterEach(async () => {
  adapter.dispose();
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
// corrects the same machine to rear-right, 400 × 410, with a clamp zone, opens
// the file and keeps the corrected machine.
async function openFileAndKeepCurrentMachine(): Promise<void> {
  useStore.getState().updateDeviceProfile({ origin: 'front-left', noGoZones: [] });
  const saved = serializeProject(withLine(createProject(useStore.getState().project.device)));
  useStore
    .getState()
    .updateDeviceProfile({ origin: 'rear-right', bedHeight: 410, noGoZones: [CLAMP] });
  const parsed = deserializeProject(saved);
  if (parsed.kind !== 'ok') throw new Error(`parse ${parsed.kind}`);
  await act(async () => {
    expect(useStore.getState().setProject(parsed.project).kind).toBe('loaded');
  });
  await act(async () => button('Keep current machine').click());
  expect(useStore.getState().projectBedReconciliation).toBeNull();
}

async function remote(command: 'undo' | 'redo'): Promise<Record<string, unknown>> {
  let result: RemoteCommandResult | undefined;
  await act(async () => {
    result = await adapter.execute(command, {
      expectedRevision: adapter.getRevision(),
      requestId: crypto.randomUUID(),
    });
  });
  if (result === undefined || !result.ok) throw new Error(`remote ${command} refused`);
  return result.data;
}

describe('J7-P2-1: a remote Undo or Redo of a machine step says so', () => {
  it('Undo of Keep current machine brings back the file machine with the PC notice in the receipt', async () => {
    await openFileAndKeepCurrentMachine();
    const kept = burn(useStore.getState().project);
    expect(kept.noGo).toBeGreaterThan(0);

    const receipt = await remote('undo');

    // The same step a desktop Undo runs: the file's machine and the PC banner are back.
    const state = useStore.getState();
    expect(state.project.device).toMatchObject({ origin: 'front-left', bedHeight: 400 });
    expect(state.project.device.noGoZones).toEqual([]);
    expect(burn(state.project).line).not.toBe(kept.line);
    const notice = state.projectBedReconciliation;
    expect(notice).not.toBeNull();
    expect(host.textContent).toContain('Opened project machine:');
    // The receipt carries it, in the banner's own words.
    expect(receipt.notices).toEqual([
      {
        level: 'warning',
        message:
          "Undo brought back the opened file's machine, and the PC asks again which machine to use. " +
          "Until that is answered on the PC, Frame and Start use the file's machine. The PC says:" +
          openedMachineNoticeWords(notice!),
      },
    ]);
    expect(String((receipt.notices as { message: string }[])[0]!.message)).toContain(
      'origin and no-go zones',
    );
  });

  it('Redo of Keep says the current machine is back and the PC question is closed', async () => {
    await openFileAndKeepCurrentMachine();
    await remote('undo');

    const receipt = await remote('redo');

    const state = useStore.getState();
    expect(state.project.device).toMatchObject({ origin: 'rear-right', bedHeight: 410 });
    expect(state.projectBedReconciliation).toBeNull();
    const [notice] = receipt.notices as { level: string; message: string }[];
    expect(notice?.level).toBe('warning');
    expect(notice?.message).toMatch(
      /^Redo changed the machine setup that Frame and Start use, to “.*”, Laser with a 400 × 410 mm bed and closed the PC's question about the opened file's machine\. Check it on the PC before you Frame\.$/,
    );
  });

  it('an Undo of an artwork edit carries no notice', async () => {
    const added = await adapter.execute('add_rectangle', {
      expectedRevision: adapter.getRevision(),
      requestId: crypto.randomUUID(),
      xMm: 5,
      yMm: 5,
      widthMm: 10,
      heightMm: 10,
    });
    expect(added.ok).toBe(true);

    const receipt = await remote('undo');

    expect(receipt.changedArtworkIds).toHaveLength(1);
    expect(receipt).not.toHaveProperty('notices');
  });
});

describe('sameMachineSetup', () => {
  it('compares values, so a rebuilt machine with the same settings is the same', () => {
    const project = useStore.getState().project;
    const rebuilt: Project = { ...project, device: structuredClone(project.device) };
    expect(sameMachineSetup(project, rebuilt)).toBe(true);
    expect(sameMachineSetup(project, { ...project, machine: { kind: 'laser' } })).toBe(true);
  });

  it('counts every machine setting, not only the motion fields', () => {
    const project = useStore.getState().project;
    const other: Project = {
      ...project,
      device: { ...project.device, maxPowerS: project.device.maxPowerS + 1 },
    };
    expect(sameMachineSetup(project, other)).toBe(false);
  });
});
