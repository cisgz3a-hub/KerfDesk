// How a link store joins the app (ADR-705 Amendment 7, C2 verification
// E2-P3-2). connectLinkStore reports the store's connection, Frame and work to
// the registry, and it only accepts a store whose Frame and Start take a job
// built on LinkJobOutcome. The @ts-expect-error lines are checked by the
// typecheck: if a store without the outcome ever compiles, they fail it.
import { afterEach, describe, expect, it } from 'vitest';
import { create } from 'zustand';
import type { LinkJobOutcome } from './link-job-outcome';
import { testLinkJobOutcome } from './link-job-outcome-test-helpers';
import {
  activeLinkMachineWork,
  anyLinkConnected,
  anyLinkFramed,
  resetLinkMachineWorkForTests,
} from './link-machine-work';
import { connectLinkStore } from './link-store-connection';

type Phase = 'disconnected' | 'idle' | 'running';

type FakeState<J> = {
  readonly phase: Phase;
  readonly framed: string | null;
  readonly advisories: ReadonlyArray<string>;
  readonly abort: () => Promise<void>;
  readonly frame: (job: J) => Promise<void>;
  readonly start: (job: J) => Promise<void>;
};

function fakeStore<J>() {
  let aborts = 0;
  const store = create<FakeState<J>>()(() => ({
    phase: 'disconnected',
    framed: null,
    advisories: [],
    abort: () => {
      aborts += 1;
      return Promise.resolve();
    },
    frame: () => Promise.resolve(),
    start: () => Promise.resolve(),
  }));
  return { store, aborts: () => aborts };
}

const LINK = { controller: 'Test board', activeWork: { running: 'running' } } as const;

afterEach(() => resetLinkMachineWorkForTests());

describe('connectLinkStore', () => {
  it('reports the connection, the Frame and the work, with an abort that reaches the store', async () => {
    const { store, aborts } = fakeStore<LinkJobOutcome & { readonly bytes: Uint8Array }>();
    connectLinkStore('moshi-usb', store, LINK);
    store.setState({ phase: 'idle' });
    expect(anyLinkConnected()).toBe(true);
    expect(anyLinkFramed()).toBe(false);
    store.setState({ framed: 'traced', phase: 'running', advisories: ['A warning.'] });
    expect(anyLinkFramed()).toBe(true);
    expect(activeLinkMachineWork()).toMatchObject({
      controller: 'Test board',
      activity: 'running',
      advisories: ['A warning.'],
    });
    await activeLinkMachineWork()?.abort();
    expect(aborts()).toBe(1);
    store.setState({ phase: 'idle' });
    expect(activeLinkMachineWork()).toBeNull();
  });

  it('accepts a job only when it is built on the link outcome', () => {
    type BareJob = { readonly bytes: Uint8Array; readonly advisories: ReadonlyArray<string> };
    type LooseJob = { readonly advisories: ReadonlyArray<string>; readonly completed?: () => void };
    const typed = (): void => {
      // @ts-expect-error a job without the link outcome does not connect
      connectLinkStore('moshi-usb', fakeStore<BareJob>().store, LINK);
      // @ts-expect-error nor does a looser job the outcome would fit
      connectLinkStore('moshi-usb', fakeStore<LooseJob>().store, LINK);
    };
    expect(typeof typed).toBe('function');
    expect(testLinkJobOutcome(['x']).advisories).toEqual(['x']);
  });
});
