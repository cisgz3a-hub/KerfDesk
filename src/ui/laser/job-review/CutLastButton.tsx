// One click from Job Review's cut-before-engraving warning to Sort cuts last
// (UX audit U3-P2-4, ADR-480 Amendment 2). It is the same one-step, undoable
// rewrite of the saved orders as the All operations header's tool. Job Review
// rebuilds from the new order and the warning clears. The warning never gates
// Start (PROJECT.md rule 21); this is its in-place fix. A frozen second pass
// replays its reviewed program, so it gets no button.

import { useStore } from '../../state/store';
import { useJobReviewStore } from './job-review-store';

export function CutLastButton(): JSX.Element | null {
  const frozen = useJobReviewStore(
    (store) => store.state.kind === 'open' && store.state.purpose === 'laser-second-pass',
  );
  if (frozen) return null;
  return (
    <button
      type="button"
      onClick={() => useStore.getState().sortCutsLast()}
      title="Engrave first and cut last: Line operations move after Fill and Image, weakest first, and Run order puts cutting artwork last. One undo step."
      style={buttonStyle}
    >
      Cut last
    </button>
  );
}

const buttonStyle: React.CSSProperties = { marginLeft: 8 };
