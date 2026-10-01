import { expect, type KerfDeskFixture, type Page } from './kerfdesk-test';

type Events = readonly Readonly<Record<string, unknown>>[];
const acknowledgedPrefixes = new WeakMap<KerfDeskFixture, Set<number>>();
const observedDocuments = new WeakSet<KerfDeskFixture>();

/** A control ACK issued here cannot later be counted as a program ACK. */
export function acknowledgedStartControlLinesSince(
  fixture: KerfDeskFixture,
  baselineLines: number,
): number {
  return acknowledgedStartControlLineNumbersSince(fixture, baselineLines).length;
}

export function acknowledgedStartControlLineNumbersSince(
  fixture: KerfDeskFixture,
  baselineLines: number,
): readonly number[] {
  return [...(acknowledgedPrefixes.get(fixture) ?? [])].filter((line) => line > baselineLines);
}

export async function reviewStartBoundary(page: Page): Promise<{
  streamerEpoch: number;
  awaitingFreshReport: boolean;
  awaitingOverrideFence: boolean;
}> {
  return page.evaluate(async () => {
    const moduleUrl = '/src/ui/state/laser-store.ts';
    const { useLaserStore } = (await import(moduleUrl)) as {
      useLaserStore: {
        getState: () => {
          streamerEpoch: number;
          controllerOperation: { kind: string; phase?: string } | null;
          pendingTransportWrites?: number;
          pendingUntrackedAcks: number;
        };
      };
    };
    const state = useLaserStore.getState();
    const arming = state.controllerOperation?.kind === 'start-arming';
    const transportSettled = (state.pendingTransportWrites ?? 0) === 0;
    return {
      streamerEpoch: state.streamerEpoch,
      awaitingFreshReport:
        arming && state.controllerOperation?.phase === 'live-status' && transportSettled,
      awaitingOverrideFence:
        arming &&
        state.controllerOperation?.phase === 'queue-fence' &&
        transportSettled &&
        state.pendingUntrackedAcks === 1,
    };
  });
}

/** Model only the newly written, held control fence. Program replies remain
 * held for the caller's motion/settlement scenario. Auto-ACK fixtures have no
 * held event, so this never duplicates their controller response. */
export async function acknowledgeStartOverrideFence(
  page: Page,
  fixture: KerfDeskFixture,
  before: Awaited<ReturnType<typeof reviewStartBoundary>>,
  fromEventIndex: number,
): Promise<void> {
  if (!observedDocuments.has(fixture)) {
    observedDocuments.add(fixture);
    // Reload creates a new fake port/event log. Its line ordinals cannot
    // inherit acknowledgements from the previous browser document.
    page.on('domcontentloaded', () => acknowledgedPrefixes.delete(fixture));
  }
  await expect
    .poll(async () => {
      const state = await reviewStartBoundary(page);
      if (state.streamerEpoch !== before.streamerEpoch || state.awaitingFreshReport) return true;
      if (!state.awaitingOverrideFence) return false;
      const line = heldFenceLine(await fixture.events(), fromEventIndex);
      if (line === null) return false;
      const prefixes = acknowledgedPrefixes.get(fixture) ?? new Set<number>();
      if (prefixes.has(line)) return false;
      prefixes.add(line);
      acknowledgedPrefixes.set(fixture, prefixes);
      await fixture.acknowledgeSerial(1);
      return false;
    })
    .toBe(true);
}

function heldFenceLine(events: Events, fromEventIndex: number): number | null {
  let lineCount = 0;
  let candidate: number | null = null;
  for (const [index, event] of events.entries()) {
    if (event['kind'] === 'serial-write') {
      const text = String(event['text']);
      lineCount += [...text].filter((character) => character === '\n').length;
      candidate = index >= fromEventIndex && text === 'G4 P0.01\n' ? lineCount : null;
    }
    if (candidate !== null && event['kind'] === 'serial-acks-held' && event['count'] === 1) {
      return candidate;
    }
  }
  return null;
}
