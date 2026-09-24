// feed-ceiling — says when a speed is capped by the machine's Output max feed
// instead of snapping it silently (WORKFLOW.md F-A7 "speed input out of range").
//
// device.maxFeed is the profile's compile ceiling, not a firmware fact: GRBL
// and grblHAL already slow every move to their own $110/$111 max rates
// (https://github.com/gnea/grbl/wiki/Grbl-v1.1-Configuration). A Speed field
// that stops at the ceiling without a word reads as a machine whose speed is
// stuck, which is exactly how it was reported (controller audit 2026-09-23,
// speed-3). The note names the ceiling, keeps what the operator asked for, and
// offers to raise the ceiling to it. It is advisory only: it never blocks an
// edit, Frame or Start (ADR-228).

import { useState } from 'react';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';

/** Upper bound of Machine Setup's Output max feed field. */
export const OUTPUT_MAX_FEED_LIMIT_MM_PER_MIN = 100_000;

const feedFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function formatFeed(mmPerMin: number): string {
  return feedFormat.format(mmPerMin);
}

export function feedCeilingMessage(maxFeed: number): string {
  return `Capped to Output max feed ${formatFeed(maxFeed)} mm/min. Change it in Machine Setup > Output max feed.`;
}

/** The requested feed when the ceiling will cap it, else null. */
export function cappedFeedRequest(requested: number | null, maxFeed: number): number | null {
  return requested !== null && Number.isFinite(requested) && requested > maxFeed ? requested : null;
}

/** Status-bar style warning for surfaces with no room for an inline note. */
export function pushFeedCeilingToast(maxFeed: number): void {
  useToastStore.getState().pushToast(feedCeilingMessage(maxFeed), 'warning');
}

export type FeedCeiling = {
  readonly maxFeed: number;
  /** What the operator asked for when it is above the ceiling, else null. */
  readonly request: number | null;
  /** Feed the raw text of each keystroke so the note appears while typing. */
  readonly observe: (raw: string) => void;
};

/**
 * Tracks a Speed field against the ceiling. `storedFeed` covers a value that is
 * already above it (a material preset, or a ceiling lowered later), which
 * compile caps just as silently; pass null when the field shows mixed values.
 * `resetKey` identifies what the field edits, so a request typed for one
 * artwork is not reported against the next selection.
 */
export function useFeedCeiling(storedFeed: number | null, resetKey: unknown): FeedCeiling {
  const maxFeed = useStore((state) => state.project.device.maxFeed);
  const [typed, setTyped] = useState<{ readonly key: unknown; readonly value: number } | null>(
    null,
  );
  const typedValue = typed !== null && Object.is(typed.key, resetKey) ? typed.value : null;
  const request =
    typedValue !== null
      ? cappedFeedRequest(typedValue, maxFeed)
      : cappedFeedRequest(storedFeed, maxFeed);
  return {
    maxFeed,
    request,
    observe: (raw) => {
      const value = Number.parseFloat(raw);
      setTyped(Number.isFinite(value) ? { key: resetKey, value } : null);
    },
  };
}

export function FeedCeilingNotice(props: {
  readonly ceiling: FeedCeiling;
  /** Re-applies the request once the ceiling allows it. */
  readonly onRaise: (feed: number) => void;
}): JSX.Element | null {
  const updateDeviceProfile = useStore((state) => state.updateDeviceProfile);
  const { request, maxFeed } = props.ceiling;
  if (request === null) return null;
  const target = Math.min(Math.round(request), OUTPUT_MAX_FEED_LIMIT_MM_PER_MIN);
  return (
    <p className="lf-artwork-hint lf-feed-ceiling-note" role="status">
      {`${formatFeed(request)} mm/min is above this machine's Output max feed, so it runs at ${formatFeed(maxFeed)} mm/min. `}
      {'The controller still applies its own maximum rate. '}
      {target > maxFeed ? (
        <button
          type="button"
          className="lf-feed-ceiling-note__raise"
          title={`Set this machine's Output max feed to ${formatFeed(target)} mm/min so this speed runs as entered. Only raise it as far as the machine can really move.`}
          onClick={() => {
            updateDeviceProfile({ maxFeed: target });
            props.onRaise(target);
          }}
        >
          {`Raise Output max feed to ${formatFeed(target)} mm/min`}
        </button>
      ) : (
        'Machine Setup > Output max feed sets this limit.'
      )}
    </p>
  );
}
