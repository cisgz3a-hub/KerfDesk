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

export type LinkMachineSource = 'moshi-usb' | 'ruida-network';

export type LinkMachineWork = {
  /** The controller, as the bar names it ("Moshiboard", "Ruida"). */
  readonly controller: string;
  readonly activity: 'framing' | 'running' | 'homing' | 'paused' | 'stopping';
  /** Warnings the compiled job carries; shown while it runs. */
  readonly advisories: ReadonlyArray<string>;
  /** The link's own stop: the Moshi estop, the Ruida Stop Process. */
  readonly abort: () => Promise<void>;
};

type LinkMachineWorkState = {
  readonly works: Readonly<Partial<Record<LinkMachineSource, LinkMachineWork>>>;
};

export const useLinkMachineWorkStore = create<LinkMachineWorkState>()(() => ({ works: {} }));

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
  return state.works['moshi-usb'] ?? state.works['ruida-network'] ?? null;
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
  useLinkMachineWorkStore.setState({ works: {} });
}
