// The "Before you start" block above Start job (ADR-689): glasses, focus,
// supervision and fire for a laser; eye and ear protection, clamps and
// supervision for a CNC. It starts open; an experienced operator may fold it,
// and the fold is remembered per machine profile. Nothing here gates Start.

import { useState } from 'react';
import { useStore } from '../../state';
import {
  BEFORE_YOU_START_HEADING,
  beforeYouStartLines,
  readBeforeYouStartFolded,
  writeBeforeYouStartFolded,
} from './before-you-start';
import type { MachineKind } from '../../../core/scene';
import { bannerListStyle, bannerStyle, warnItemSummaryStyle } from './job-review.styles';

export function JobReviewBeforeYouStart(props: { readonly machineKind: MachineKind }): JSX.Element {
  const deviceId = useStore((s) => s.project.device.profileId ?? s.project.device.name);
  // Keyed by profile so switching machines re-reads that machine's choice.
  return <BeforeYouStartBlock key={deviceId} deviceId={deviceId} machineKind={props.machineKind} />;
}

function BeforeYouStartBlock(props: {
  readonly deviceId: string;
  readonly machineKind: MachineKind;
}): JSX.Element {
  const [isOpen, setIsOpen] = useState(() => !readBeforeYouStartFolded(props.deviceId));
  return (
    <section
      aria-label={BEFORE_YOU_START_HEADING}
      className="lf-banner lf-banner--info"
      style={bannerStyle}
    >
      <details
        open={isOpen}
        onToggle={(event) => {
          const open = event.currentTarget.open;
          if (open === isOpen) return;
          setIsOpen(open);
          writeBeforeYouStartFolded(props.deviceId, !open);
        }}
      >
        <summary
          style={warnItemSummaryStyle}
          title={isOpen ? 'Fold for this machine' : 'Show the safety points'}
        >
          {BEFORE_YOU_START_HEADING}
        </summary>
        <ul style={bannerListStyle}>
          {beforeYouStartLines(props.machineKind).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
