// The status bar's lasting sign that a background save is not protecting the
// work (annoyance audit A5-P2-1, ADR-305 Amendment 1). It shows from a failed
// write until the next good one, or while an autosave waits for a job to end,
// in the bar's fixed action rail so a long telemetry line cannot scroll it out
// of view. The matching toast still says a failure once.

import {
  useBackgroundSaveHealth,
  type BackgroundSaveKind,
  type BackgroundSaveSign,
} from '../state/background-save-health';

const KINDS: ReadonlyArray<BackgroundSaveKind> = ['autosave', 'machine-settings'];

function signLabel(kind: BackgroundSaveKind, sign: BackgroundSaveSign): string {
  if (kind === 'machine-settings') return 'Machine settings not saved';
  return sign.state === 'waiting' ? 'Autosave waiting for job' : 'Autosave failed';
}

// When the sign goes, so nobody has to wonder whether it is stale.
function signClears(kind: BackgroundSaveKind, sign: BackgroundSaveSign): string {
  if (kind === 'machine-settings') {
    return 'They stay in use until KerfDesk closes, and saving the project keeps them in its file. This sign stays until a machine change is saved.';
  }
  return sign.state === 'waiting'
    ? 'This sign stays until the job ends or the project is saved.'
    : 'This sign stays until an autosave succeeds or the project is saved.';
}

export function BackgroundSaveStatus(): JSX.Element | null {
  const signs = useBackgroundSaveHealth((state) => state.signs);
  const shown = KINDS.flatMap((kind) => {
    const sign = signs[kind];
    return sign === undefined ? [] : [{ kind, sign }];
  });
  if (shown.length === 0) return null;
  return (
    <>
      {shown.map(({ kind, sign }) => {
        const label = signLabel(kind, sign);
        const detail = `${sign.message} ${signClears(kind, sign)}`;
        return (
          // Focusable so the advice in the tooltip is reachable from the keyboard
          // and read by a screen reader, not only shown on hover.
          <span
            key={kind}
            role="status"
            tabIndex={0}
            className="lf-status-bar__alert"
            data-state={sign.state}
            title={detail}
            aria-label={`${label}. ${detail}`}
          >
            <span aria-hidden="true">⚠ </span>
            {label}
          </span>
        );
      })}
    </>
  );
}
