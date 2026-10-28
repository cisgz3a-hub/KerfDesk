// BitFileSequenceNotice — between a set's per-bit files run through Run G-code
// file, the machine panel says which bit ran and what the next one needs, or
// that a stopped file is to be run again with the same bit, and offers the way
// out of the X/Y hold for an operator starting over on new stock (rolling
// audit v4 H3-P2-2, ADR-392 Amendments 4 and 6).

import { Button } from '../kit';
import { bitFileSequenceNotice, END_BIT_SEQUENCE_LABEL } from '../state/bit-file-sequence';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';

export function BitFileSequenceNotice(): JSX.Element | null {
  const notice = useLaserStore(bitFileSequenceNotice);
  const jobActive = useLaserStore((state) => isActiveJob(state.streamer));
  if (notice === null || jobActive) return null;
  return (
    <div
      className="lf-banner lf-banner--warning"
      role="status"
      aria-label="Bit file sequence"
      style={noticeStyle}
    >
      <p style={textStyle}>{notice}</p>
      <Button
        type="button"
        title="Release the X/Y origin hold, for starting over on new stock. Work Z still needs a new zero."
        onClick={() => useLaserStore.setState({ bitFileSequence: null })}
      >
        {END_BIT_SEQUENCE_LABEL}
      </Button>
    </div>
  );
}

const noticeStyle: React.CSSProperties = { fontSize: 12 };
const textStyle: React.CSSProperties = { margin: '0 0 6px' };
