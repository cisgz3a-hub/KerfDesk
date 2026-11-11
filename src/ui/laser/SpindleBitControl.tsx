// SpindleBitControl — the Machine rail's "Bit in the spindle" selector, beside
// Zero Z (ADR-416 Amendment 4, annoyance audit A2 B4-P1-1). It names the bit
// the next Zero Z or probe records Work Z for. A bit-change hold chooses the
// bit the job asked for, so the operator only touches it off; choosing another
// here is their statement that a different bit is loaded, and Continue then
// stays off. Session state: the project and its Default bit are not changed.

import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import {
  pendingSpindleBit,
  SPINDLE_BIT_LABEL,
  spindleBitChoices,
  spindleBitOf,
  type SpindleBit,
} from '../state/spindle-bit';
import { declareSpindleBit } from '../state/spindle-bit-actions';

const SELECT_TITLE =
  'The bit Zero Z and the probe record Work Z for. Choose the bit you loaded. A bit change ' +
  'during a job chooses the bit that job asked for. The project and its Default bit do not change.';
const CUTTING_TITLE = 'The job is cutting with this bit. It can be changed at a bit change.';

export function SpindleBitControl(): JSX.Element | null {
  const machine = useStore((s) => s.project.machine);
  const declared = useLaserStore((s) => s.spindleBit ?? null);
  const pendingToolId = useLaserStore((s) => s.pendingToolId);
  const pendingToolLabel = useLaserStore((s) => s.pendingToolLabel);
  const inHold = useLaserStore((s) => s.streamer?.status === 'tool-change');
  const cutting = useLaserStore((s) => isActiveJob(s.streamer)) && !inHold;
  const state = { spindleBit: declared, pendingToolId, pendingToolLabel };
  const choices = spindleBitChoices(state, { machine });
  const current = spindleBitOf(state, { machine });
  if (current === null || choices.length === 0) return null;
  const awaited = inHold ? pendingSpindleBit(state) : null;
  return (
    <div style={panelStyle}>
      <label style={rowStyle}>
        <span style={labelStyle}>{SPINDLE_BIT_LABEL}</span>
        <select
          className="lf-select"
          style={selectStyle}
          value={current.toolId}
          disabled={cutting}
          aria-label={SPINDLE_BIT_LABEL}
          title={cutting ? CUTTING_TITLE : SELECT_TITLE}
          onChange={(event) => declareSpindleBit(event.target.value)}
        >
          {choices.map((choice) => (
            <option key={choice.toolId} value={choice.toolId}>
              {choice.name}
            </option>
          ))}
        </select>
      </label>
      {awaited !== null && (
        <p role="status" aria-label="Bit this job is waiting for" style={hintStyle}>
          {holdHint(awaited, current)}
        </p>
      )}
    </div>
  );
}

/** What the hold says under the selector: which bit the touch-off is recorded
 * for, or why Continue will stay off. */
export function holdHint(awaited: SpindleBit, current: SpindleBit): string {
  return awaited.toolId === current.toolId
    ? `This job is waiting for ${awaited.name}. Zero Z and the probe now record Work Z for it.`
    : `This job is waiting for ${awaited.name}, but ${current.name} is chosen here. Continue ` +
        `stays off while Work Z is recorded for another bit: load ${awaited.name} and choose it here.`;
}

const panelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 3 };
const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' };
// The longest starter bit names are wider than the rail: let the select shrink.
const selectStyle: React.CSSProperties = { minWidth: 0, flex: '1 1 auto' };
const hintStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-text-muted)',
  fontSize: 12,
  lineHeight: 1.3,
};
