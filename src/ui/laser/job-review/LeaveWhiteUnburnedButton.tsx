// One click from Job Review's burning-white row to the knock-out a new import
// gets (rolling audit v10 V2-P2-1, ADR-686 Amendment 2). It is the same
// one-step, undoable rewrite as Tools > Leave Imported White Unburned. Job
// Review rebuilds from the new artwork and the row clears. The row never gates
// Start (PROJECT.md rule 21); this is its in-place fix. A frozen second pass
// replays its reviewed program, so it gets no button.

import { useStore } from '../../state/store';
import { useJobReviewStore } from './job-review-store';

export function LeaveWhiteUnburnedButton(): JSX.Element | null {
  const frozen = useJobReviewStore(
    (store) => store.state.kind === 'open' && store.state.purpose === 'laser-second-pass',
  );
  if (frozen) return null;
  return (
    <button
      type="button"
      onClick={() => useStore.getState().leaveSavedWhiteUnburned()}
      title="Cut solid white SVG shapes out of the fills under them and leave them out. One undo step."
      style={buttonStyle}
    >
      Leave white unburned
    </button>
  );
}

const buttonStyle: React.CSSProperties = { marginLeft: 8 };
