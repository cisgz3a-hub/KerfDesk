// Machine work running over a controller link outside the line-based laser
// store (ADR-697 Ruida over UDP, ADR-705 Moshiboard over USB; ADR-705
// Amendment 3). Those stores load lazily, so the app's always-mounted guards
// cannot import them without pulling them into the boot bundle. Each one
// reports its active work here instead, and Ctrl+., the Live Motion bar, the
// close and update handoff, project replacement and Machine Setup Save read
// this registry beside the laser store (code quality audit C2 D1-P2-3,
// D1-P2-5; PROJECT.md non-negotiable 9).

import { create } from 'zustand';
import { useLaserStore } from './laser-store';
import { isActiveJob } from './laser-store-helpers';

/** Every controller-link store, in the order the bar picks one. Each must
 *  report its work here (link-machine-work.test.ts checks the stores); the
 *  K40 link was missed once (code quality audit C2 D4-P1-1). */
export const LINK_MACHINE_SOURCES = ['moshi-usb', 'lihuiyu-usb', 'ruida-network'] as const;

export type LinkMachineSource = (typeof LINK_MACHINE_SOURCES)[number];

export type LinkMachineWork = {
  /** The controller, as the bar names it ("Moshiboard", "K40", "Ruida"). */
  readonly controller: string;
  readonly activity: 'framing' | 'running' | 'homing' | 'jogging' | 'paused' | 'stopping';
  /** Warnings the compiled job carries; shown while it runs. */
  readonly advisories: ReadonlyArray<string>;
  /** The link's own stop: the Moshi estop, the K40 reset, the Ruida Stop Process. */
  readonly abort: () => Promise<void>;
};

/** Whether a link is connected and holds a completed Frame, for route-neutral
 *  signals such as the guided first job (C2 D6-P2-3). */
export type LinkMachineStatus = { readonly connected: boolean; readonly framed: boolean };

type LinkMachineWorkState = {
  readonly works: Readonly<Partial<Record<LinkMachineSource, LinkMachineWork>>>;
  readonly statuses: Readonly<Partial<Record<LinkMachineSource, LinkMachineStatus>>>;
};

export const useLinkMachineWorkStore = create<LinkMachineWorkState>()(() => ({
  works: {},
  statuses: {},
}));

/** A link store reports whether it is connected and framed. */
export function reportLinkMachineStatus(
  source: LinkMachineSource,
  status: LinkMachineStatus,
): void {
  const current = useLinkMachineWorkStore.getState().statuses[source];
  if (current?.connected === status.connected && current.framed === status.framed) return;
  useLinkMachineWorkStore.setState((state) => ({
    statuses: { ...state.statuses, [source]: status },
  }));
}

/** Some link is connected. */
export function anyLinkConnected(
  state: LinkMachineWorkState = useLinkMachineWorkStore.getState(),
): boolean {
  return LINK_MACHINE_SOURCES.some((source) => state.statuses[source]?.connected === true);
}

/** Some link holds a completed Frame of its current job. */
export function anyLinkFramed(
  state: LinkMachineWorkState = useLinkMachineWorkStore.getState(),
): boolean {
  return LINK_MACHINE_SOURCES.some((source) => state.statuses[source]?.framed === true);
}

/** A link store reports its work, or null once it is idle or gone. */
export function reportLinkMachineWork(
  source: LinkMachineSource,
  work: LinkMachineWork | null,
): void {
  const current = useLinkMachineWorkStore.getState().works;
  if (work === null && current[source] === undefined) return;
  const others = Object.entries(current).filter(([key]) => key !== source);
  const next = Object.fromEntries(work === null ? others : [...others, [source, work]]);
  useLinkMachineWorkStore.setState({ works: next });
}

/** The first link's active work, or null. */
export function activeLinkMachineWork(
  state: LinkMachineWorkState = useLinkMachineWorkStore.getState(),
): LinkMachineWork | null {
  for (const source of LINK_MACHINE_SOURCES) {
    const work = state.works[source];
    if (work !== undefined) return work;
  }
  return null;
}

/** A streamed laser job, or work on any controller link. */
export function anyMachineJobActive(): boolean {
  return isActiveJob(useLaserStore.getState().streamer) || activeLinkMachineWork() !== null;
}

/** Stops every link's work, as the close handoff must before the window goes. */
export async function abortAllLinkMachineWork(): Promise<void> {
  const works = Object.values(useLinkMachineWorkStore.getState().works);
  await Promise.all(works.map((work) => work?.abort()));
}

/** Test support. */
export function resetLinkMachineWorkForTests(): void {
  useLinkMachineWorkStore.setState({ works: {}, statuses: {} });
}
