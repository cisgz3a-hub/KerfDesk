// How a controller-link store joins the app (ADR-705 Amendment 7, C2
// verification E2-P3-2). Every link store calls connectLinkStore once, which
// reports its connection, Frame and active work to the boot-side registry
// (link-machine-work.ts) on every change. The store's type must fit
// LinkStoreShape: its Frame and Start take a job built on LinkJobOutcome, so
// the job carries the shared request's completion and the shared job
// warnings. A store that skips any of these does not compile;
// link-machine-work-sources.test.ts fails for a store that never connects.

import type { LinkJobOutcome } from './link-job-outcome';
import {
  reportLinkMachineStatus,
  reportLinkMachineWork,
  type LinkMachineSource,
  type LinkMachineWork,
} from './link-machine-work';

/** What every link store's state offers. */
export type LinkStoreShape = {
  readonly phase: string;
  /** The last completed Frame on this connection, or null. */
  readonly framed: unknown;
  /** The job's warnings, shown from its Frame on. */
  readonly advisories: ReadonlyArray<string>;
  readonly abort: () => Promise<void>;
  readonly frame: (job: never) => Promise<void>;
  readonly start: (job: never) => Promise<void>;
};

type JobOf<F> = F extends (job: infer J) => unknown ? J : never;

/** A store whose Frame or Start takes a job without the link outcome gets an
 *  impossible member here, so connecting it does not compile. */
type LinkJobRequirement<S extends LinkStoreShape> = [JobOf<S['frame']>] extends [LinkJobOutcome]
  ? [JobOf<S['start']>] extends [LinkJobOutcome]
    ? unknown
    : { readonly startJobMustSpreadLinkJobOutcome: never }
  : { readonly frameJobMustSpreadLinkJobOutcome: never };

type SubscribableStore<S> = {
  getState(): S;
  subscribe(listener: (state: S) => void): () => void;
};

export type LinkStoreLink<S extends LinkStoreShape> = {
  /** The controller, as the job bar names it. */
  readonly controller: string;
  /** The phases that are machine work, and what the bar calls them. */
  readonly activeWork: Partial<Record<S['phase'], LinkMachineWork['activity']>>;
};

export function connectLinkStore<S extends LinkStoreShape>(
  source: LinkMachineSource,
  store: SubscribableStore<S> & LinkJobRequirement<S>,
  link: LinkStoreLink<S>,
): void {
  store.subscribe((state) => {
    const phase: S['phase'] = state.phase;
    const activity = link.activeWork[phase];
    reportLinkMachineStatus(source, {
      connected: phase !== 'disconnected' && phase !== 'connecting',
      framed: state.framed !== null,
    });
    reportLinkMachineWork(
      source,
      activity === undefined
        ? null
        : {
            controller: link.controller,
            activity,
            advisories: state.advisories,
            abort: () => store.getState().abort(),
          },
    );
  });
}
